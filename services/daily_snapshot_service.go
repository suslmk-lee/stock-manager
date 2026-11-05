package services

import (
	"fmt"
	"log"
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

	// 외부 의존성 (테스트에서 교체)
	now           func() time.Time
	fetchPrices   func(tickers []string) map[string]*CurrentPrice
	fetchFxNow    func() float64
	fetchFxHist   func() *PriceHistory
	fetchHistorys func(tickers []string, rangeStr string) map[string]*PriceHistory

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
	}
	return s
}

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

// dividendsCumKRW 는 upTo(KST 일) 이하 누적 세후 배당 (지급일 환율).
func dividendsCumKRW(divs []dsDiv, fxAt func(time.Time) float64, fxNow float64, upTo int64) float64 {
	var sum float64
	for _, d := range divs {
		if kstDay(d.Date) > upTo {
			continue
		}
		v := d.Net
		if strings.ToUpper(strings.TrimSpace(d.Currency)) != "KRW" {
			v *= fxOrNow(fxAt, fxNow, d.Date)
		}
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
	fxNow := s.currentFx()

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
		fx := 1.0
		if currency != "KRW" {
			fx = fxNow
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
		var fxAt func(time.Time) float64
		if s.fetchFxHist != nil {
			fxAt = NewFxLookup(s.fetchFxHist(), fxNow)
		}
		row.DividendsCumKRW = dividendsCumKRW(divs, fxAt, fxNow, kstDay(now))
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
	fxNow := s.currentFx()
	var fxAt func(time.Time) float64
	if s.fetchFxHist != nil {
		fxAt = NewFxLookup(s.fetchFxHist(), fxNow)
	}

	assets, posRows := estimateDailySnapshots(missing, positions, txns, divs, prices, fxAt, fxNow)
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
	return buildSeries(rows, rangeStr, interval), nil
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
