package services

import (
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DefaultBackfillDays 백필 기본 기간(일).
const DefaultBackfillDays = 730

// DailyPoint 차트용 시계열 한 점.
type DailyPoint struct {
	Date            string  `json:"date"`
	TotalKRW        float64 `json:"total_krw"`
	CostKRW         float64 `json:"cost_krw"`
	LiquidKRW       float64 `json:"liquid_krw"`
	RestrictedKRW   float64 `json:"restricted_krw"`
	DividendsCumKRW float64 `json:"dividends_cum_krw"`
	UsdKrw          float64 `json:"usd_krw"`
	Estimated       bool    `json:"estimated"`
	// 예수금 (원화 + 달러 × 그날 환율). TotalKRW·LiquidKRW·RestrictedKRW 에 이미 더해져 있다.
	CashKRW float64 `json:"cash_krw"`
}

// DailySeries 는 GetSeries 응답.
type DailySeries struct {
	Range          string       `json:"range"`
	Interval       string       `json:"interval"`
	Points         []DailyPoint `json:"points"`
	FirstDate      string       `json:"first_date"`
	LastRealDate   string       `json:"last_real_date"`
	RealCount      int          `json:"real_count"`
	EstimatedCount int          `json:"estimated_count"`
}

// DailySnapshotService 는 일별 총자산 수집/백필/조회를 담당한다.
type DailySnapshotService struct {
	db     *gorm.DB
	ticker *TickerService
	fund   *FundamentalsService // 일별 펀더멘털 저장 (nil 이면 건너뜀)
	cash   *CashService         // 조회할 때 예수금을 더한다 (nil 이면 주식만)

	// 외부 의존성 (테스트에서 교체)
	now           func() time.Time
	fetchPrices   func(tickers []string) map[string]*CurrentPrice
	fetchFxNow    func() float64
	fetchFxHist   func() *PriceHistory
	fetchHistorys func(tickers []string, rangeStr string) map[string]*PriceHistory
	// 달러·원화가 아닌 통화(엔화 등)의 원화 환율 — 지금 · 날짜별 (nil 이면 그런 종목은 평가에서 뺀다)
	fxNowFor func(ccy string) float64
	fxAtFor  func(ccy string, fallback float64) func(time.Time) float64

	running atomic.Bool // 백필 중복 실행 방지
	capMu   sync.Mutex  // 캡처 직렬화
}

func NewDailySnapshotService(db *gorm.DB, ticker *TickerService) *DailySnapshotService {
	s := &DailySnapshotService{db: db, ticker: ticker, now: time.Now}
	if ticker != nil {
		s.fetchPrices = ticker.GetCurrentPrices
		s.fetchFxNow = func() float64 {
			m := ticker.GetCurrentPrices([]string{"KRW=X"})
			if p := m["KRW=X"]; p != nil && finite(p.Price) && p.Price > 0 {
				return p.Price
			}
			return 0
		}
		s.fetchFxHist = func() *PriceHistory {
			h, err := ticker.GetFxHistoryCached()
			if err != nil {
				return nil
			}
			return h
		}
		s.fetchHistorys = ticker.GetDailyHistoriesRangeCached
		s.fxNowFor = ticker.FxRateNow
		s.fxAtFor = ticker.FxLookupFor
	}
	return s
}

// fxBook: 이번 계산에 쓸 통화별 환율 (달러는 지금까지처럼 currentFx·환율 히스토리, withHist 면 날짜별도)
func (s *DailySnapshotService) fxBook(withHist bool) *fxBook {
	usdNow := s.currentFx()
	var usdAt func(time.Time) float64
	if withHist && s.fetchFxHist != nil {
		usdAt = NewFxLookup(s.fetchFxHist(), usdNow)
	}
	var atFor func(string, float64) func(time.Time) float64
	if withHist {
		atFor = s.fxAtFor
	}
	return newFxBook(usdNow, usdAt, s.fxNowFor, atFor)
}

// SetCash: 시계열 조회에 예수금을 더한다.
func (s *DailySnapshotService) SetCash(c *CashService) { s.cash = c }

func (s *DailySnapshotService) today() string { return kstDateString(s.now()) }

// lastKnownFx 는 저장된 가장 최근 환율 (없으면 0).
func (s *DailySnapshotService) lastKnownFx() float64 {
	var row models.DailyAssetSnapshot
	if err := s.db.Where("usd_krw > 0").Order("date DESC").Limit(1).Find(&row).Error; err == nil {
		return row.UsdKrw
	}
	return 0
}

// currentFx: 실시간 → 환율 히스토리 마지막 값 → 저장된 마지막 값.
func (s *DailySnapshotService) currentFx() float64 {
	if s.fetchFxNow != nil {
		if v := s.fetchFxNow(); v > 0 {
			return v
		}
	}
	if s.fetchFxHist != nil {
		if h := s.fetchFxHist(); h != nil {
			if v := NewFxLookup(h, 0)(s.now()); v > 0 {
				return v
			}
		}
	}
	return s.lastKnownFx()
}

// loadDividends 는 수령 완료 배당(세후)을 읽는다.
func (s *DailySnapshotService) loadDividends() ([]dsDiv, error) {
	var ds []models.Dividend
	if err := s.db.Where("is_received = ?", true).Find(&ds).Error; err != nil {
		return nil, err
	}
	out := make([]dsDiv, 0, len(ds))
	for _, d := range ds {
		out = append(out, dsDiv{Date: d.Date, Net: d.Amount - d.Tax, Currency: d.Currency})
	}
	return out, nil
}

// dividendsCumKRW 는 upTo(KST 일) 이하 누적 세후 배당 (지급일 그 통화 환율).
func dividendsCumKRW(divs []dsDiv, fx *fxBook, upTo int64) float64 {
	var sum float64
	for _, d := range divs {
		if kstDay(d.Date) > upTo {
			continue
		}
		v := d.Net * fx.at(d.Currency, d.Date)
		if finite(v) {
			sum += v
		}
	}
	return sum
}

// CaptureToday 는 현재 보유/시세로 오늘(KST) 스냅샷을 저장한다. 같은 날짜의 기존 행(추정 포함)은 교체된다.
func (s *DailySnapshotService) CaptureToday(source string) (*models.DailyAssetSnapshot, error) {
	s.capMu.Lock()
	defer s.capMu.Unlock()

	now := s.now()
	date := kstDateString(now)

	var holdings []models.Holding
	if err := s.db.Preload("Account").Preload("Asset").Where("quantity > 0").Find(&holdings).Error; err != nil {
		return nil, fmt.Errorf("보유 종목 조회 실패: %w", err)
	}

	tickerSet := map[string]bool{}
	for _, h := range holdings {
		if t := strings.ToUpper(strings.TrimSpace(h.Asset.Ticker)); t != "" {
			tickerSet[t] = true
		}
	}
	tickers := make([]string, 0, len(tickerSet))
	for t := range tickerSet {
		tickers = append(tickers, t)
	}
	sort.Strings(tickers)
	var priceMap map[string]*CurrentPrice
	if len(tickers) > 0 && s.fetchPrices != nil {
		priceMap = s.fetchPrices(tickers)
	}
	book := s.fxBook(false) // 오늘 평가는 지금 환율
	fxNow := book.usdNow

	row := models.DailyAssetSnapshot{Date: date, UsdKrw: fxNow, Source: source, CapturedAt: now}
	var posRows []models.DailyPositionSnapshot
	for _, h := range holdings {
		tk := strings.ToUpper(strings.TrimSpace(h.Asset.Ticker))
		price, currency := 0.0, ""
		if p := priceMap[tk]; p != nil && finite(p.Price) && p.Price > 0 {
			price, currency = p.Price, p.Currency
		} else {
			// 시세 실패: 가장 최근 저장 가격 이월
			var last models.DailyPositionSnapshot
			if err := s.db.Where("asset_id = ? AND price > 0", h.AssetID).Order("date DESC").Limit(1).Find(&last).Error; err == nil && last.Price > 0 {
				price, currency = last.Price, last.Currency
			}
			log.Printf("[DailySnapshot] 시세 조회 실패 %s: 이월 가격 %.4f 사용", tk, price)
		}
		currency = currencyFor(tk, currency)
		fx := book.now(currency) // 그 통화의 지금 환율 (원화 1, 엔화면 엔/원)
		if fx <= 0 {
			log.Printf("[DailySnapshot] %s 환율(%s)을 몰라 평가에서 뺍니다", tk, currency)
		}
		value := h.Quantity * price * fx
		cost := h.Quantity * h.AveragePrice * fx
		if !finite(value) {
			value = 0
		}
		if !finite(cost) {
			cost = 0
		}
		row.TotalKRW += value
		row.CostKRW += cost
		if h.Account.AccountType.IsWithdrawalRestricted() {
			row.RestrictedKRW += value
		} else {
			row.LiquidKRW += value
		}
		posRows = append(posRows, models.DailyPositionSnapshot{
			Date: date, AccountID: h.AccountID, AssetID: h.AssetID, Quantity: h.Quantity,
			Price: price, Currency: currency, FxRate: fx, ValueKRW: value, CostKRW: cost,
		})
	}

	// 배당 누적 (지급일 환율 — 히스토리 조회 실패 시 현재 환율)
	if divs, err := s.loadDividends(); err != nil {
		log.Printf("[DailySnapshot] 배당 조회 실패: %v", err)
	} else if len(divs) > 0 {
		row.DividendsCumKRW = dividendsCumKRW(divs, s.fxBook(true), kstDay(now))
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("date = ?", date).Delete(&models.DailyPositionSnapshot{}).Error; err != nil {
			return err
		}
		if err := tx.Where("date = ?", date).Delete(&models.DailyAssetSnapshot{}).Error; err != nil {
			return err
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if len(posRows) > 0 {
			return tx.CreateInBatches(posRows, 200).Error
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("일별 스냅샷 저장 실패: %w", err)
	}
	log.Printf("[DailySnapshot] %s 캡처 완료 (%s): 총 %.0f원, 포지션 %d개", date, source, row.TotalKRW, len(posRows))
	s.captureFundamentals(date, holdings) // 실패해도 캡처는 성공으로 본다
	return &row, nil
}

// EnsureToday 는 오늘 실측(비추정) 행이 없을 때만 캡처한다. 새로 캡처했으면 true.
func (s *DailySnapshotService) EnsureToday(source string) (bool, error) {
	var n int64
	if err := s.db.Model(&models.DailyAssetSnapshot{}).
		Where("date = ? AND estimated = ?", s.today(), false).Count(&n).Error; err != nil {
		return false, err
	}
	if n > 0 {
		return false, nil
	}
	if _, err := s.CaptureToday(source); err != nil {
		return false, err
	}
	return true, nil
}

func (s *DailySnapshotService) EnsureTodayAsync() {
	go func() {
		if _, err := s.EnsureToday("startup"); err != nil {
			log.Printf("[DailySnapshot] EnsureToday 오류: %v", err)
		}
	}()
}

// BackfillAsync 는 백그라운드에서 Backfill 을 실행한다 (이미 실행 중이면 무시). 시작했으면 true.
func (s *DailySnapshotService) BackfillAsync(days int) bool {
	if s.running.Load() {
		return false
	}
	go func() {
		n, err := s.Backfill(days)
		if err != nil {
			log.Printf("[DailySnapshot] 백필 오류: %v", err)
		} else if n > 0 {
			log.Printf("[DailySnapshot] 백필 %d일 추가", n)
		}
	}()
	return true
}

// Backfill 은 [오늘-days, 어제] 중 행이 없는 날짜를 추정해 채운다. 실측 행은 건드리지 않는다.
// 반환값은 삽입된 일수. 다른 백필이 진행 중이면 0.
func (s *DailySnapshotService) Backfill(days int) (int, error) {
	if !s.running.CompareAndSwap(false, true) {
		return 0, nil
	}
	defer s.running.Store(false)
	if err := s.repairForeignFx(); err != nil {
		log.Printf("[DailySnapshot] 외화 환율 바로잡기 실패: %v", err)
	}

	if days <= 0 {
		days = DefaultBackfillDays
	}
	todayT, err := parseKSTDate(s.today())
	if err != nil {
		return 0, err
	}
	var have []string
	if err := s.db.Model(&models.DailyAssetSnapshot{}).
		Where("date >= ?", todayT.AddDate(0, 0, -days).Format(dateLayout)).Pluck("date", &have).Error; err != nil {
		return 0, err
	}
	haveSet := make(map[string]bool, len(have))
	for _, d := range have {
		haveSet[d] = true
	}
	var missing []string
	for i := days; i >= 1; i-- {
		d := todayT.AddDate(0, 0, -i).Format(dateLayout)
		if !haveSet[d] {
			missing = append(missing, d)
		}
	}
	if len(missing) == 0 {
		return 0, nil
	}

	positions, txns, tickers, err := s.loadEstimateInputs()
	if err != nil {
		return 0, err
	}
	if len(positions) == 0 {
		return 0, nil
	}
	divs, err := s.loadDividends()
	if err != nil {
		return 0, err
	}

	rangeStr := "2y"
	if days > 730 {
		rangeStr = "5y"
	}
	if s.fetchHistorys == nil {
		return 0, fmt.Errorf("시세 조회기가 없습니다")
	}
	hists := s.fetchHistorys(tickers, rangeStr)
	prices := map[string]*dailyPrices{}
	for tk, h := range hists {
		if h != nil && len(h.Points) > 0 {
			prices[strings.ToUpper(tk)] = buildDailyPrices(tk, h)
		}
	}
	assets, posRows := estimateDailySnapshots(missing, positions, txns, divs, prices, s.fxBook(true))
	if len(assets) == 0 {
		return 0, nil
	}
	now := s.now()
	for i := range assets {
		assets[i].CapturedAt = now
	}

	inserted := 0
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// 동시에 실측이 들어온 날짜는 건드리지 않도록 충돌 시 무시
		res := tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(assets, 200)
		if res.Error != nil {
			return res.Error
		}
		inserted = len(assets)
		if len(posRows) > 0 {
			return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(posRows, 300).Error
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("백필 저장 실패: %w", err)
	}
	return inserted, nil
}

// loadEstimateInputs 는 (활성 계좌의) 포지션/거래/티커를 읽는다.
func (s *DailySnapshotService) loadEstimateInputs() ([]dsPos, []dsTxn, []string, error) {
	var accounts []models.Account
	if err := s.db.Find(&accounts).Error; err != nil {
		return nil, nil, nil, err
	}
	restricted := map[uint]bool{}
	for _, a := range accounts {
		restricted[a.ID] = a.AccountType.IsWithdrawalRestricted()
	}
	var holdings []models.Holding
	if err := s.db.Where("quantity > 0").Find(&holdings).Error; err != nil {
		return nil, nil, nil, err
	}
	var txs []models.Transaction
	if err := s.db.Find(&txs).Error; err != nil {
		return nil, nil, nil, err
	}

	type agg struct{ qty, costLocal float64 }
	byPair := map[dsPairKey]*agg{}
	var order []dsPairKey
	touch := func(k dsPairKey) *agg {
		a := byPair[k]
		if a == nil {
			a = &agg{}
			byPair[k] = a
			order = append(order, k)
		}
		return a
	}
	for _, h := range holdings {
		a := touch(dsPairKey{h.AccountID, h.AssetID})
		a.qty += h.Quantity
		a.costLocal += h.Quantity * h.AveragePrice
	}
	dts := make([]dsTxn, 0, len(txs))
	for _, t := range txs {
		if _, ok := restricted[t.AccountID]; !ok {
			continue
		}
		touch(dsPairKey{t.AccountID, t.AssetID})
		dts = append(dts, dsTxn{t.AccountID, t.AssetID, t.Type, t.Date, t.Quantity, t.Price, t.Fee})
	}

	assetIDs := map[uint]bool{}
	for _, k := range order {
		if _, ok := restricted[k.acc]; ok {
			assetIDs[k.asset] = true
		}
	}
	ids := make([]uint, 0, len(assetIDs))
	for id := range assetIDs {
		ids = append(ids, id)
	}
	tickerByAsset := map[uint]string{}
	if len(ids) > 0 {
		var assets []models.Asset
		if err := s.db.Unscoped().Select("id", "ticker").Where("id IN ?", ids).Find(&assets).Error; err != nil {
			return nil, nil, nil, err
		}
		for _, a := range assets {
			tickerByAsset[a.ID] = a.Ticker
		}
	}
	var positions []dsPos
	tickerSet := map[string]bool{}
	for _, k := range order {
		res, ok := restricted[k.acc]
		if !ok {
			continue
		}
		tk := strings.TrimSpace(strings.ToUpper(tickerByAsset[k.asset]))
		if tk == "" {
			continue
		}
		a := byPair[k]
		avg := 0.0
		if a.qty > 0 {
			avg = a.costLocal / a.qty
		}
		positions = append(positions, dsPos{k.acc, k.asset, tk, res, a.qty, avg})
		tickerSet[tk] = true
	}
	tickers := make([]string, 0, len(tickerSet))
	for t := range tickerSet {
		tickers = append(tickers, t)
	}
	sort.Strings(tickers)
	return positions, dts, tickers, nil
}

// ---- 시계열 조회 ----

func rangeStart(today time.Time, rangeStr string) (string, bool) {
	switch rangeStr {
	case "1m":
		return today.AddDate(0, -1, 0).Format(dateLayout), true
	case "3m":
		return today.AddDate(0, -3, 0).Format(dateLayout), true
	case "6m":
		return today.AddDate(0, -6, 0).Format(dateLayout), true
	case "1y":
		return today.AddDate(-1, 0, 0).Format(dateLayout), true
	case "2y":
		return today.AddDate(-2, 0, 0).Format(dateLayout), true
	}
	return "", false
}

// GetSeries 는 차트용 일/주 시계열을 반환한다. rangeStr: 1m|3m|6m|1y|2y|all, interval: auto|day|week.
func (s *DailySnapshotService) GetSeries(rangeStr, interval string) (*DailySeries, error) {
	rangeStr = strings.ToLower(strings.TrimSpace(rangeStr))
	switch rangeStr {
	case "1m", "3m", "6m", "1y", "2y", "all":
	case "":
		rangeStr = "1y"
	default:
		return nil, fmt.Errorf("지원하지 않는 range: %s", rangeStr)
	}
	interval = strings.ToLower(strings.TrimSpace(interval))
	switch interval {
	case "day", "week":
	case "", "auto":
		if rangeStr == "1m" || rangeStr == "3m" {
			interval = "day"
		} else {
			interval = "week"
		}
	default:
		return nil, fmt.Errorf("지원하지 않는 interval: %s", interval)
	}

	q := s.db.Model(&models.DailyAssetSnapshot{})
	if start, ok := rangeStart(func() time.Time { t, _ := parseKSTDate(s.today()); return t }(), rangeStr); ok {
		q = q.Where("date >= ?", start)
	}
	var rows []models.DailyAssetSnapshot
	if err := q.Order("date ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := buildSeries(rows, rangeStr, interval)
	if s.cash != nil && len(out.Points) > 0 {
		// 예수금은 저장하지 않고 조회할 때 원장에서 계산한다 (잔액 맞추기·입금 기록이 지난 날짜에도 바로 반영되도록)
		addCashToSeries(out.Points, s.cash.Timelines(), s.currentFx)
	}
	return out, nil
}

// addCashToSeries: 각 점에 그날 예수금을 더한다 (달러는 그날 환율, 없으면 현재 환율). 인출 가능/제한도 계좌를 따른다.
func addCashToSeries(points []DailyPoint, tls []CashTimeline, fallbackFx func() float64) {
	if len(tls) == 0 {
		return
	}
	fxNow := -1.0
	for i := range points {
		p := &points[i]
		for j := range tls {
			krw, usd, ok := tls[j].At(p.Date)
			if !ok {
				continue
			}
			v := krw
			if usd != 0 {
				fx := p.UsdKrw
				if fx <= 0 {
					if fxNow < 0 {
						fxNow = 0
						if fallbackFx != nil {
							fxNow = fallbackFx()
						}
					}
					fx = fxNow
				}
				v += usd * fx
			}
			if !finite(v) || v == 0 {
				continue
			}
			p.CashKRW += v
			p.TotalKRW += v
			if tls[j].Restricted {
				p.RestrictedKRW += v
			} else {
				p.LiquidKRW += v
			}
		}
	}
}

func sanitizeF(v float64) float64 {
	if !finite(v) {
		return 0
	}
	return v
}

// buildSeries 는 정렬된 행에서 (필요 시 주 단위로 줄여) 응답을 만든다 (순수 함수).
func buildSeries(rows []models.DailyAssetSnapshot, rangeStr, interval string) *DailySeries {
	pick := rows
	if interval == "week" {
		pick = nil
		lastKey := ""
		for _, r := range rows {
			key := r.Date
			if t, err := parseKSTDate(r.Date); err == nil {
				y, w := t.ISOWeek()
				key = fmt.Sprintf("%d-%02d", y, w)
			}
			if key == lastKey && len(pick) > 0 {
				pick[len(pick)-1] = r // 같은 주의 마지막 점으로 교체
			} else {
				pick = append(pick, r)
				lastKey = key
			}
		}
	}
	out := &DailySeries{Range: rangeStr, Interval: interval, Points: make([]DailyPoint, 0, len(pick))}
	for _, r := range pick {
		out.Points = append(out.Points, DailyPoint{
			Date: r.Date, TotalKRW: sanitizeF(r.TotalKRW), CostKRW: sanitizeF(r.CostKRW),
			LiquidKRW: sanitizeF(r.LiquidKRW), RestrictedKRW: sanitizeF(r.RestrictedKRW),
			DividendsCumKRW: sanitizeF(r.DividendsCumKRW), UsdKrw: sanitizeF(r.UsdKrw), Estimated: r.Estimated,
		})
		if r.Estimated {
			out.EstimatedCount++
		} else {
			out.RealCount++
			out.LastRealDate = r.Date
		}
	}
	if len(out.Points) > 0 {
		out.FirstDate = out.Points[0].Date
	}
	return out
}

// repairForeignFx: 원화·달러가 아닌 종목(엔화 등)을 예전에 달러 환율로 평가해 저장한 일별 기록을 바로잡는다.
// 그날 그 통화 환율과 저장된 환율이 5% 넘게 다른 포지션만 고친다 — 평가·원가를 환율 비율만큼 바꾸고 그날 합계도 차이만큼 고친다.
// 한 번 고치면 저장 환율이 맞아 다시 건드리지 않는다 (백필 때마다 불러도 된다).
func (s *DailySnapshotService) repairForeignFx() error {
	var rows []models.DailyPositionSnapshot
	if err := s.db.Where("currency NOT IN ? AND currency <> ? AND fx_rate > 0", []string{"KRW", "USD"}, "").Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	book := s.fxBook(true)
	type fix struct {
		pos  models.DailyPositionSnapshot
		rate float64
	}
	byDate := map[string][]fix{}
	for _, r := range rows {
		t, err := parseKSTDate(r.Date)
		if err != nil {
			continue
		}
		want := book.at(r.Currency, t)
		if want <= 0 || math.Abs(r.FxRate-want)/want <= 0.05 {
			continue
		}
		byDate[r.Date] = append(byDate[r.Date], fix{r, want})
	}
	if len(byDate) == 0 {
		return nil
	}
	var accounts []models.Account
	if err := s.db.Find(&accounts).Error; err != nil {
		return err
	}
	restricted := map[uint]bool{}
	for _, a := range accounts {
		restricted[a.ID] = a.AccountType.IsWithdrawalRestricted()
	}
	fixed := 0
	for date, list := range byDate {
		err := s.db.Transaction(func(tx *gorm.DB) error {
			var dv, dc, dRestricted, dLiquid float64
			for _, f := range list {
				ratio := f.rate / f.pos.FxRate
				value, cost := f.pos.ValueKRW*ratio, f.pos.CostKRW*ratio
				if !finite(value) || !finite(cost) {
					continue
				}
				if err := tx.Model(&models.DailyPositionSnapshot{}).Where("id = ?", f.pos.ID).
					Updates(map[string]interface{}{"fx_rate": f.rate, "value_krw": value, "cost_krw": cost}).Error; err != nil {
					return err
				}
				dv += value - f.pos.ValueKRW
				dc += cost - f.pos.CostKRW
				if restricted[f.pos.AccountID] {
					dRestricted += value - f.pos.ValueKRW
				} else {
					dLiquid += value - f.pos.ValueKRW
				}
			}
			return tx.Model(&models.DailyAssetSnapshot{}).Where("date = ?", date).Updates(map[string]interface{}{
				"total_krw":      gorm.Expr("total_krw + ?", dv),
				"cost_krw":       gorm.Expr("cost_krw + ?", dc),
				"restricted_krw": gorm.Expr("restricted_krw + ?", dRestricted),
				"liquid_krw":     gorm.Expr("liquid_krw + ?", dLiquid),
			}).Error
		})
		if err != nil {
			return err
		}
		fixed++
	}
	log.Printf("[DailySnapshot] 외화 종목 환율을 바로잡은 날 %d일", fixed)
	return nil
}
