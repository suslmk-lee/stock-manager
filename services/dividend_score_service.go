package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 배당 점수 · 월별 순위 — 보유 종목만, 매달 1일 기준.
//
//   - 그달 점수는 처음 볼 때 한 번 계산해 저장한다 (1일 0시 직전까지의 배당 이력·종가·보유 수량 기준).
//   - 지난 12개월 중 기록이 없는 달은 거슬러 계산해 '추정'으로 저장한다.
//   - 항목 점수(0~1)만 저장하고, 총점·순위는 볼 때 지금 배점으로 매긴다 (배점을 바꾸면 지난 달도 같은 기준).
//   - 기록 누락: 시장 배당락일에 보유 중이었는데 그 뒤 지급 기간 안에 내 배당 기록이 없는 회차.

const (
	divScoreMonths     = 12
	divRecordWindowUS  = 60  // 미국 주식: 배당락일 뒤 이 기간 안에 들어와야 함 (일)
	divRecordWindowKR  = 130 // 국내 주식: 12월 결산 배당이 4월에 들어오는 경우까지
	divRecordLeadDays  = 10  // 배당락일보다 조금 앞선 기록도 같은 회차로 본다
	divTaxUS           = 0.15
	divTaxKR           = 0.154
	divMissingLookback = 12 // 기록 누락을 찾는 기간 (개월)
)

// ErrDivScoreInput 은 잘못된 입력 (HTTP 400)
type ErrDivScoreInput struct{ msg string }

func (e *ErrDivScoreInput) Error() string { return e.msg }

type DividendScoreService struct {
	db     *gorm.DB
	ticker *TickerService
	mu     sync.Mutex // 거슬러 계산이 겹치지 않게
	// 이번 달 배당이 없다고 확인한 보유 종목 (달이 바뀌면 비운다)
	skipMonth string
	skip      map[uint]bool

	// 시험용 주입 (nil 이면 실제 조회)
	now         func() time.Time
	fetchEvents func(tickers []string) map[string][]DividendEvent
	fetchHist   func(tickers []string) map[string]*PriceHistory
}

func NewDividendScoreService(db *gorm.DB, ticker *TickerService) *DividendScoreService {
	return &DividendScoreService{db: db, ticker: ticker}
}

func (s *DividendScoreService) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *DividendScoreService) events(tickers []string) map[string][]DividendEvent {
	if s.fetchEvents != nil {
		return s.fetchEvents(tickers)
	}
	if s.ticker == nil || len(tickers) == 0 {
		return map[string][]DividendEvent{}
	}
	return s.ticker.GetDividendEventsCachedMany(tickers)
}

func (s *DividendScoreService) histories(tickers []string) map[string]*PriceHistory {
	var raw map[string]*PriceHistory
	switch {
	case s.fetchHist != nil:
		raw = s.fetchHist(tickers)
	case s.ticker != nil && len(tickers) > 0:
		raw = s.ticker.GetDailyHistoriesRangeCached(tickers, "5y")
	}
	out := map[string]*PriceHistory{}
	for k, v := range raw {
		out[strings.ToUpper(k)] = v
	}
	return out
}

// ───────────────────────── 배점 ─────────────────────────

func (s *DividendScoreService) GetSettings() (models.DividendScoreSetting, error) {
	var st models.DividendScoreSetting
	err := s.db.First(&st, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.DefaultDividendScoreSetting(), nil
	}
	if err != nil {
		return st, err
	}
	if st.Version < models.DividendScoreSettingVersion {
		// 주가 성장이 생기기 전 처음 배점(30·25·20·10·15)을 그대로 쓰고 있었으면 새 기본 배점으로.
		// 바꿔 둔 배점은 그대로 두고 주가 성장만 더한다 (열 기본값 15).
		if st.Growth == 30 && st.Stability == 25 && st.Yield == 20 && st.Consistency == 10 && st.Value == 15 {
			def := models.DefaultDividendScoreSetting()
			st.Growth, st.Stability, st.Yield, st.Consistency, st.Value, st.PriceGrowth = def.Growth, def.Stability, def.Yield, def.Consistency, def.Value, def.PriceGrowth
		}
		st.Version = models.DividendScoreSettingVersion
		if err := s.db.Select("*").Save(&st).Error; err != nil {
			return st, err
		}
	}
	return st, nil
}

func (s *DividendScoreService) UpdateSettings(in models.DividendScoreSetting) (models.DividendScoreSetting, error) {
	vals := []int{in.Growth, in.Stability, in.Yield, in.Consistency, in.Value, in.PriceGrowth}
	sum := 0
	for _, v := range vals {
		if v < 0 || v > 100 {
			return in, &ErrDivScoreInput{"배점은 항목마다 0~100 사이여야 합니다"}
		}
		sum += v
	}
	if sum == 0 {
		return in, &ErrDivScoreInput{"배점을 하나 이상 0보다 크게 넣어 주세요"}
	}
	in.ID, in.Version = 1, models.DividendScoreSettingVersion
	// 줄을 먼저 만들어 두고 Save(모든 열 UPDATE)로 저장한다 — INSERT 로 넣으면 0 으로 둔 배점이 열 기본값으로 바뀐다
	var cur models.DividendScoreSetting
	if err := s.db.Where("id = ?", 1).Attrs(models.DefaultDividendScoreSetting()).FirstOrCreate(&cur).Error; err != nil {
		return in, err
	}
	if err := s.db.Save(&in).Error; err != nil {
		return in, err
	}
	return s.GetSettings()
}

func weightsOf(st models.DividendScoreSetting) DivScoreWeights {
	return DivScoreWeights{Growth: float64(st.Growth), Stability: float64(st.Stability), Yield: float64(st.Yield), Consistency: float64(st.Consistency), Value: float64(st.Value), PriceGrowth: float64(st.PriceGrowth)}
}

// ───────────────────────── 입력 모으기 ─────────────────────────

func monthKeyKST(t time.Time) string { return t.In(kst).Format("2006-01") }

func monthStartKST(key string) (time.Time, bool) {
	t, err := time.ParseInLocation("2006-01", key, kst)
	return t, err == nil
}

// recentMonths: 이번 달부터 거꾸로 n 달 (YYYY-MM)
func recentMonths(now time.Time, n int) []string {
	cur := now.In(kst)
	out := make([]string, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, time.Date(cur.Year(), cur.Month()-time.Month(i), 1, 0, 0, 0, 0, kst).Format("2006-01"))
	}
	return out
}

type divScoreAsset struct {
	asset   models.Asset
	qtyAt   func(accountID uint, t time.Time) float64
	acctIDs []uint
	events  []DivPerShare // 주당 배당 (시장 우선, 없으면 내 기록)
	market  []DividendEvent
	source  string
	closes  []PricePoint
	records []models.Dividend
	avgCost float64 // 지금 보유 평균 단가 (종목 통화)
	heldNow float64
	firstTx map[uint]time.Time // 계좌별 이 종목 첫 거래일 — 언제부터 들고 있었는지 아는지 보려고
}

// qty: 그 시각 모든 계좌 보유 수량
func (a *divScoreAsset) qty(t time.Time) float64 {
	sum := 0.0
	for _, id := range a.acctIDs {
		sum += a.qtyAt(id, t)
	}
	return sum
}

// loadAssets: 지금 보유 중이거나 since 이후 거래가 있던 종목의 수량 추적기·배당 이력·종가
func (s *DividendScoreService) loadAssets(since time.Time, withPrices bool) (map[uint]*divScoreAsset, error) {
	var holdings []models.Holding
	if err := s.db.Where("quantity > 0").Find(&holdings).Error; err != nil {
		return nil, err
	}
	var txs []models.Transaction
	if err := s.db.Find(&txs).Error; err != nil {
		return nil, err
	}
	ids := map[uint]bool{}
	for _, h := range holdings {
		ids[h.AssetID] = true
	}
	for _, t := range txs {
		if !t.Date.Before(since) {
			ids[t.AssetID] = true
		}
	}
	if len(ids) == 0 {
		return map[uint]*divScoreAsset{}, nil
	}
	idList := make([]uint, 0, len(ids))
	for id := range ids {
		idList = append(idList, id)
	}
	var assets []models.Asset
	if err := s.db.Unscoped().Where("id IN ?", idList).Find(&assets).Error; err != nil {
		return nil, err
	}
	var divs []models.Dividend
	if err := s.db.Where("asset_id IN ?", idList).Order("date ASC").Find(&divs).Error; err != nil {
		return nil, err
	}

	out := map[uint]*divScoreAsset{}
	tickers := []string{}
	for _, a := range assets {
		tk := strings.ToUpper(strings.TrimSpace(a.Ticker))
		if tk == "" {
			continue
		}
		cur := map[uint]float64{}
		var cost, qty float64
		for _, h := range holdings {
			if h.AssetID == a.ID {
				cur[h.AccountID] += h.Quantity
				cost += h.Quantity * h.AveragePrice
				qty += h.Quantity
			}
		}
		var at []AcctTxn
		accts := map[uint]bool{}
		for id := range cur {
			accts[id] = true
		}
		firstTx := map[uint]time.Time{}
		for _, t := range txs {
			if t.AssetID == a.ID {
				at = append(at, AcctTxn{AccountID: t.AccountID, Type: t.Type, Date: t.Date, Quantity: t.Quantity})
				accts[t.AccountID] = true
				if f, ok := firstTx[t.AccountID]; !ok || t.Date.Before(f) {
					firstTx[t.AccountID] = t.Date
				}
			}
		}
		d := &divScoreAsset{asset: a, qtyAt: QuantityAtFunc(cur, at), heldNow: qty, firstTx: firstTx}
		if qty > 0 {
			d.avgCost = cost / qty
		}
		for id := range accts {
			d.acctIDs = append(d.acctIDs, id)
		}
		sort.Slice(d.acctIDs, func(i, j int) bool { return d.acctIDs[i] < d.acctIDs[j] })
		for _, dv := range divs {
			if dv.AssetID == a.ID {
				d.records = append(d.records, dv)
			}
		}
		out[a.ID] = d
		tickers = append(tickers, tk)
	}

	evs := s.events(tickers)
	var hists map[string]*PriceHistory
	if withPrices {
		hists = s.histories(tickers)
	}
	now := s.clock()
	for _, d := range out {
		tk := strings.ToUpper(strings.TrimSpace(d.asset.Ticker))
		if ev := evs[tk]; len(ev) > 0 {
			d.market = ev
			for _, e := range ev {
				d.events = append(d.events, DivPerShare{Date: time.Unix(e.Time, 0), Amount: e.Amount})
			}
			d.source = "market"
		} else if len(d.records) > 0 {
			recs := make([]DivEvent, 0, len(d.records))
			for _, r := range d.records {
				if r.IsReceived {
					recs = append(recs, DivEvent{AccountID: r.AccountID, Date: r.Date, Amount: r.Amount})
				}
			}
			d.events = DividendPerShareEvents(recs, d.qtyAt, now)
			d.source = "records"
		}
		sort.Slice(d.events, func(i, j int) bool { return d.events[i].Date.Before(d.events[j].Date) })
		if h := hists[tk]; h != nil {
			d.closes = h.Points
		}
	}
	return out, nil
}

// ───────────────────────── 월별 기록 ─────────────────────────

// ensureMonths: window 중 기록이 없는 달을 계산해 저장한다 (이번 달이 아니면 '추정').
// 이번 달은 1일에 보유하던 종목에 더해 지금 보유 중인 종목도 넣는다 — 1일 뒤에 산 종목도 이번 달 순위에 바로 보인다
// (점수는 같은 1일 기준 데이터로). 배당이 없는 보유 종목은 한 번 확인하면 이번 달 동안 다시 계산하지 않는다.
// 예전 공식(divScoreFormula 보다 낮은 버전)으로 저장된 기록은 같은 달·종목을 새 공식으로 다시 계산한다 ('추정' 여부는 그대로).
func (s *DividendScoreService) ensureMonths(window []string) error {
	current := monthKeyKST(s.clock())
	var existing []models.DividendScoreSnapshot
	if err := s.db.Where("month IN ?", window).Find(&existing).Error; err != nil {
		return err
	}
	have := map[string]map[uint]bool{}
	var stale []models.DividendScoreSnapshot
	for _, e := range existing {
		if have[e.Month] == nil {
			have[e.Month] = map[uint]bool{}
		}
		have[e.Month][e.AssetID] = true
		if e.Formula < divScoreFormula {
			stale = append(stale, e)
		}
	}
	var missing []string
	for _, m := range window {
		if len(have[m]) == 0 {
			missing = append(missing, m)
		}
	}
	// 이번 달: 지금 보유 중인데 기록이 없는 종목
	var heldIDs []uint
	if err := s.db.Model(&models.Holding{}).Where("quantity > 0").Distinct("asset_id").Pluck("asset_id", &heldIDs).Error; err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.skipMonth != current {
		s.skipMonth, s.skip = current, map[uint]bool{}
	}
	needCurrent := false
	for _, id := range heldIDs {
		if !have[current][id] && !s.skip[id] {
			needCurrent = true
		}
	}
	if len(missing) == 0 && !needCurrent && len(stale) == 0 {
		return nil
	}

	oldest, _ := monthStartKST(window[len(window)-1])
	assets, err := s.loadAssets(oldest, true)
	if err != nil {
		return err
	}
	todo := append([]string(nil), missing...)
	if needCurrent && len(have[current]) > 0 {
		todo = append(todo, current) // 이번 달 기록은 있지만 빠진 보유 종목만 더한다
	}
	var rows []models.DividendScoreSnapshot
	for _, month := range todo {
		start, ok := monthStartKST(month)
		if !ok {
			continue
		}
		asOf := start.Add(-time.Second)
		for _, a := range assets {
			if have[month][a.asset.ID] {
				continue
			}
			held := a.qty(asOf) > 1e-9 || (month == current && a.heldNow > 0)
			if !held {
				continue
			}
			m, p, ok := computeDivScore(a.events, a.closes, asOf, a.source)
			if !ok {
				if month == current {
					s.skip[a.asset.ID] = true // 배당 없음 — 이번 달 동안 다시 보지 않는다
				}
				continue
			}
			mj, _ := json.Marshal(m)
			rows = append(rows, models.DividendScoreSnapshot{
				Month: month, AssetID: a.asset.ID, Growth: p.Growth, Stability: p.Stability, Yield: p.Yield,
				Consistency: p.Consistency, Value: p.Value, PriceGrowth: p.PriceGrowth, Metrics: string(mj), Estimated: month != current, Formula: divScoreFormula,
			})
		}
	}
	if len(stale) > 0 {
		if err := s.upgradeFormula(stale, assets); err != nil {
			return err
		}
	}
	if len(rows) == 0 {
		return nil // 배당주가 없으면 저장할 것도 없다
	}
	return s.db.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(rows, 200).Error
}

// upgradeFormula: 예전 공식으로 저장된 기록을 새 공식으로 다시 계산해 바꾼다 (지우고 한 번에 다시 넣는다 — 원격 DB 왕복을 줄이려고).
// 그달·종목·'추정' 여부는 그대로 두고 항목 점수·지표만 바뀐다. 지금 계산할 수 없는 기록(배당 이력이 사라짐 등)은 값은 두고 버전만 올린다.
func (s *DividendScoreService) upgradeFormula(stale []models.DividendScoreSnapshot, assets map[uint]*divScoreAsset) error {
	ids := make([]uint, 0, len(stale))
	rows := make([]models.DividendScoreSnapshot, 0, len(stale))
	for _, old := range stale {
		ids = append(ids, old.ID)
		row := old
		row.ID = 0
		row.Formula = divScoreFormula
		if start, ok := monthStartKST(old.Month); ok {
			if a := assets[old.AssetID]; a != nil {
				if m, p, ok := computeDivScore(a.events, a.closes, start.Add(-time.Second), a.source); ok {
					mj, _ := json.Marshal(m)
					row.Growth, row.Stability, row.Yield, row.Consistency, row.Value, row.PriceGrowth, row.Metrics = p.Growth, p.Stability, p.Yield, p.Consistency, p.Value, p.PriceGrowth, string(mj)
				}
			}
		}
		rows = append(rows, row)
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id IN ?", ids).Delete(&models.DividendScoreSnapshot{}).Error; err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(rows, 200).Error
	})
}

// Recompute: 그달 기록을 지우고 다시 계산한다 (거래를 고쳤거나 시세를 못 가져왔던 달). 지난 달은 '추정'이 된다.
func (s *DividendScoreService) Recompute(month string) error {
	window := recentMonths(s.clock(), divScoreMonths)
	ok := false
	for _, m := range window {
		ok = ok || m == month
	}
	if !ok {
		return &ErrDivScoreInput{fmt.Sprintf("최근 %d개월 안의 달만 다시 계산할 수 있습니다", divScoreMonths)}
	}
	if err := s.db.Where("month = ?", month).Delete(&models.DividendScoreSnapshot{}).Error; err != nil {
		return err
	}
	s.mu.Lock()
	s.skipMonth = "" // 배당 없음으로 넘겼던 종목도 다시 본다
	s.mu.Unlock()
	return s.ensureMonths(window)
}

// ───────────────────────── 순위 ─────────────────────────

type DivScoreRow struct {
	AssetID    uint            `json:"asset_id"`
	Asset      models.Asset    `json:"asset"`
	Score      float64         `json:"score"`
	Rank       int             `json:"rank"`
	PrevRank   *int            `json:"prev_rank,omitempty"`
	PrevScore  *float64        `json:"prev_score,omitempty"`
	PrevStatus string          `json:"prev_status,omitempty"`
	Parts      DivScoreParts   `json:"parts"`
	Metrics    DivScoreMetrics `json:"metrics"`
	Estimated  bool            `json:"estimated"`
	// 항목별 순위 (그 항목 점수 순, 같으면 총점 순) — 목록을 항목 기준으로 정렬할 때. 지난달은 그달 종목들 사이의 순위
	PartRank     map[string]int `json:"part_rank"`
	PrevPartRank map[string]int `json:"prev_part_rank,omitempty"`
	// 이번 달만: 내 평균 단가 대비 배당률, 기록 누락 회차 수
	YOCPct       *float64 `json:"yoc_pct,omitempty"`
	MissingCount int      `json:"missing_count"`
}

// MissingDividend 는 내 배당 기록에 없는 회차 (시장 배당락일 기준)
type MissingDividend struct {
	AssetID       uint    `json:"asset_id"`
	Ticker        string  `json:"ticker"`
	AssetName     string  `json:"asset_name"`
	AccountID     uint    `json:"account_id"`
	AccountName   string  `json:"account_name"`
	AccountBroker string  `json:"account_broker"`
	ExDate        string  `json:"ex_date"`
	PerShare      float64 `json:"per_share"`
	Quantity      float64 `json:"quantity"`
	Currency      string  `json:"currency"`
	ExpectedNet   float64 `json:"expected_net"` // 주당 배당 × 수량 × (1 − 세율)
	PayBy         string  `json:"pay_by"`       // 이 날까지는 들어왔어야 함
	Status        string  `json:"status"`       // missing (기간이 지남) | upcoming (아직 들어올 수 있음)
}

type DivScoreRanking struct {
	Month      string                      `json:"month"`
	Months     []string                    `json:"months"` // 볼 수 있는 달 (최근부터)
	Current    bool                        `json:"current"`
	Weights    models.DividendScoreSetting `json:"weights"`
	Rows       []DivScoreRow               `json:"rows"`
	NoDividend []models.Asset              `json:"no_dividend"` // 보유 중이지만 배당이 없는 종목 (이번 달만)
	Missing    []MissingDividend           `json:"missing"`     // 이번 달만
	Prev       []DivScorePrevRow           `json:"prev"`        // 지난달 순위 (화면에서 한국/미국만·항목별로 지난달 순위를 다시 매길 때)
}

// DivScorePrevRow 는 지난달 한 종목의 순위·점수 (지난달 종목 전체, 종합 순위대로)
type DivScorePrevRow struct {
	AssetID uint          `json:"asset_id"`
	Ticker  string        `json:"ticker"`
	Rank    int           `json:"rank"`
	Score   float64       `json:"score"`
	Parts   DivScoreParts `json:"parts"`
}

// rankMonth: 그달 기록에 지금 배점으로 총점·순위를 매긴다
func rankMonth(snaps []models.DividendScoreSnapshot, w DivScoreWeights) []DivScoreRow {
	rows := make([]DivScoreRow, 0, len(snaps))
	for _, sn := range snaps {
		var m DivScoreMetrics
		_ = json.Unmarshal([]byte(sn.Metrics), &m)
		p := DivScoreParts{Growth: sn.Growth, Stability: sn.Stability, Yield: sn.Yield, Consistency: sn.Consistency, Value: sn.Value, PriceGrowth: sn.PriceGrowth}
		rows = append(rows, DivScoreRow{AssetID: sn.AssetID, Score: math.Round(w.total(p)*10) / 10, Parts: p, Metrics: m, Estimated: sn.Estimated})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Score != rows[j].Score {
			return rows[i].Score > rows[j].Score
		}
		return rows[i].AssetID < rows[j].AssetID
	})
	for i := range rows {
		rows[i].Rank = i + 1
	}
	assignPartRanks(rows)
	return rows
}

// divPartKeys: 항목 이름 (화면의 growth·stability·yield·consistency·value 와 같다)
var divPartKeys = []string{"growth", "stability", "yield", "consistency", "value", "price_growth"}

func partValue(p DivScoreParts, key string) float64 {
	switch key {
	case "growth":
		return p.Growth
	case "stability":
		return p.Stability
	case "yield":
		return p.Yield
	case "consistency":
		return p.Consistency
	case "price_growth":
		return p.PriceGrowth
	default:
		return p.Value
	}
}

// assignPartRanks: 항목마다 그 항목 점수가 높은 순서로 순위를 매긴다 (같으면 총점 순위 순). rows 는 총점 순위대로 정렬돼 있어야 한다.
func assignPartRanks(rows []DivScoreRow) {
	for i := range rows {
		rows[i].PartRank = make(map[string]int, len(divPartKeys))
	}
	idx := make([]int, len(rows))
	for _, k := range divPartKeys {
		for i := range idx {
			idx[i] = i
		}
		sort.SliceStable(idx, func(a, b int) bool {
			va, vb := partValue(rows[idx[a]].Parts, k), partValue(rows[idx[b]].Parts, k)
			if math.Abs(va-vb) > 1e-9 {
				return va > vb
			}
			return rows[idx[a]].Rank < rows[idx[b]].Rank
		})
		for pos, i := range idx {
			rows[i].PartRank[k] = pos + 1
		}
	}
}

func prevMonthKey(key string) string {
	t, ok := monthStartKST(key)
	if !ok {
		return ""
	}
	return t.AddDate(0, -1, 0).Format("2006-01")
}

// GetRanking: 그달(기본 이번 달) 순위. 지난달 순위와 비교하고, 이번 달이면 내 배당률·기록 누락도 붙인다.
func (s *DividendScoreService) GetRanking(month string) (*DivScoreRanking, error) {
	now := s.clock()
	window := recentMonths(now, divScoreMonths)
	if month == "" {
		month = window[0]
	}
	valid := false
	for _, m := range window {
		valid = valid || m == month
	}
	if !valid {
		return nil, &ErrDivScoreInput{fmt.Sprintf("최근 %d개월 안의 달만 볼 수 있습니다", divScoreMonths)}
	}
	if err := s.ensureMonths(window); err != nil {
		return nil, err
	}
	st, err := s.GetSettings()
	if err != nil {
		return nil, err
	}
	w := weightsOf(st)
	prev := prevMonthKey(month)
	var snaps []models.DividendScoreSnapshot
	if err := s.db.Where("month IN ?", []string{month, prev}).Find(&snaps).Error; err != nil {
		return nil, err
	}
	var cur, before []models.DividendScoreSnapshot
	for _, sn := range snaps {
		if sn.Month == month {
			cur = append(cur, sn)
		} else {
			before = append(before, sn)
		}
	}
	rows := rankMonth(cur, w)
	prevList := rankMonth(before, w)
	prevRows := map[uint]DivScoreRow{}
	for _, r := range prevList {
		prevRows[r.AssetID] = r
	}

	ids := make([]uint, 0, len(rows)+len(prevList))
	for _, r := range rows {
		ids = append(ids, r.AssetID)
	}
	for _, r := range prevList {
		ids = append(ids, r.AssetID)
	}
	assetByID := map[uint]models.Asset{}
	if len(ids) > 0 {
		var assets []models.Asset
		if err := s.db.Unscoped().Where("id IN ?", ids).Find(&assets).Error; err != nil {
			return nil, err
		}
		for _, a := range assets {
			assetByID[a.ID] = a
		}
	}
	for i := range rows {
		rows[i].Asset = assetByID[rows[i].AssetID]
		if p, ok := prevRows[rows[i].AssetID]; ok {
			rank, score := p.Rank, p.Score
			rows[i].PrevRank, rows[i].PrevScore, rows[i].PrevStatus = &rank, &score, p.Metrics.Status
			rows[i].PrevPartRank = p.PartRank
		}
	}

	prevOut := make([]DivScorePrevRow, 0, len(prevList))
	for _, r := range prevList {
		prevOut = append(prevOut, DivScorePrevRow{AssetID: r.AssetID, Ticker: assetByID[r.AssetID].Ticker, Rank: r.Rank, Score: r.Score, Parts: r.Parts})
	}
	out := &DivScoreRanking{Month: month, Months: window, Current: month == window[0], Weights: st, Rows: rows, NoDividend: []models.Asset{}, Missing: []MissingDividend{}, Prev: prevOut}
	if out.Current {
		if err := s.addCurrentExtras(out); err != nil {
			log.Printf("[DividendScore] 이번 달 부가 정보 실패: %v", err)
		}
	}
	return out, nil
}

// addCurrentExtras: 내 배당률, 배당 없는 보유 종목, 기록 누락
func (s *DividendScoreService) addCurrentExtras(out *DivScoreRanking) error {
	now := s.clock()
	assets, err := s.loadAssets(now, false)
	if err != nil {
		return err
	}
	inRank := map[uint]int{}
	for i, r := range out.Rows {
		inRank[r.AssetID] = i
	}
	var accounts []models.Account
	if err := s.db.Find(&accounts).Error; err != nil {
		return err
	}
	accByID := map[uint]models.Account{}
	for _, a := range accounts {
		accByID[a.ID] = a
	}
	for id, a := range assets {
		if a.heldNow <= 0 {
			continue
		}
		i, ok := inRank[id]
		if !ok {
			out.NoDividend = append(out.NoDividend, a.asset)
			continue
		}
		if a.avgCost > 0 && out.Rows[i].Metrics.TTM > 0 {
			out.Rows[i].YOCPct = fptr(out.Rows[i].Metrics.TTM / a.avgCost * 100)
		}
		miss := missingRecords(a, accByID, now)
		out.Missing = append(out.Missing, miss...)
		for _, m := range miss {
			if m.Status == "missing" {
				out.Rows[i].MissingCount++
			}
		}
	}
	sort.Slice(out.NoDividend, func(i, j int) bool { return out.NoDividend[i].Ticker < out.NoDividend[j].Ticker })
	sort.Slice(out.Missing, func(i, j int) bool {
		if out.Missing[i].ExDate != out.Missing[j].ExDate {
			return out.Missing[i].ExDate > out.Missing[j].ExDate
		}
		return out.Missing[i].Ticker < out.Missing[j].Ticker
	})
	return nil
}

// missingRecords: 최근 12개월 시장 배당락일마다, 그 전날 보유하던 계좌에 지급 기간 안의 내 배당 기록이 있는지 (한 기록은 한 회차에만)
//   - 최근 회차부터 거꾸로, 회차마다 기간 안의 가장 늦은 기록을 짝으로 — 오래된 회차 하나가 비어도 뒤 회차들이 한 칸씩 밀리지 않는다
//     (예전처럼 이른 회차부터 가장 이른 기록을 가져가면, 빈 회차가 다음 회차의 기록을 가져가 결국 마지막 회차가 누락으로 보였다)
//   - 언제 샀는지 모르는 계좌(매수 기록 없이 보유)는 그 계좌의 첫 배당 기록이 받은 회차부터만 본다 — 기록을 시작하기 전 회차를 누락이라 하지 않게
func missingRecords(a *divScoreAsset, accounts map[uint]models.Account, now time.Time) []MissingDividend {
	if len(a.market) == 0 {
		return nil
	}
	kr := isKRTicker(a.asset.Ticker)
	window, tax, ccy := divRecordWindowUS, divTaxUS, tickerCurrency(a.asset.Ticker) // 해외: 종목 통화 (달러·엔화 …)
	if kr {
		window, tax, ccy = divRecordWindowKR, divTaxKR, "KRW"
	} else if ccy == "JPY" {
		tax = divTaxKR // 일본 원천 15.315% — 국내 추가분까지 보통 15.4%
	}
	from := now.AddDate(0, -divMissingLookback, 0)
	market := append([]DividendEvent(nil), a.market...)
	sort.Slice(market, func(i, j int) bool { return market[i].Time < market[j].Time })
	var out []MissingDividend
	for _, acc := range a.acctIDs {
		var recs []time.Time
		for _, r := range a.records {
			if r.AccountID == acc {
				recs = append(recs, r.Date)
			}
		}
		sort.Slice(recs, func(i, j int) bool { return recs[i].Before(recs[j]) })
		start := from
		if s := a.recordStart(acc, recs); s.After(start) {
			start = s
		}
		used := make([]bool, len(recs))
		var accOut []MissingDividend
		for k := len(market) - 1; k >= 0; k-- {
			e := market[k]
			ex := time.Unix(e.Time, 0)
			if ex.Before(start) || ex.After(now) {
				continue
			}
			qty := a.qtyAt(acc, ex.AddDate(0, 0, -1))
			if qty <= 1e-9 {
				continue
			}
			lo, hi := ex.AddDate(0, 0, -divRecordLeadDays), ex.AddDate(0, 0, window)
			matched := false
			for i := len(recs) - 1; i >= 0; i-- {
				if r := recs[i]; !used[i] && !r.Before(lo) && !r.After(hi) {
					used[i], matched = true, true
					break
				}
			}
			if matched {
				continue
			}
			status := "missing"
			if now.Before(hi) {
				status = "upcoming"
			}
			accOut = append(accOut, MissingDividend{
				AssetID: a.asset.ID, Ticker: a.asset.Ticker, AssetName: a.asset.Name, AccountID: acc,
				AccountName: accounts[acc].Name, AccountBroker: accounts[acc].Broker,
				ExDate: ex.In(kst).Format(dateLayout), PerShare: e.Amount, Quantity: qty, Currency: ccy,
				ExpectedNet: math.Round(e.Amount*qty*(1-tax)*100) / 100, PayBy: hi.In(kst).Format(dateLayout), Status: status,
			})
		}
		for k := len(accOut) - 1; k >= 0; k-- { // 회차 순서대로
			out = append(out, accOut[k])
		}
	}
	return out
}

// recordStart: 매수 기록 없이 보유한 계좌(언제 샀는지 모름)면 그 계좌의 첫 배당 기록이 받은 회차의 배당락일 — 그 앞 회차는 따지지 않는다.
// 언제부터 들고 있었는지 알거나(첫 거래 전날 보유 0), 그 계좌에 배당 기록이 아직 없으면 zero.
func (a *divScoreAsset) recordStart(acc uint, recs []time.Time) time.Time {
	if len(recs) == 0 {
		return time.Time{}
	}
	if f, ok := a.firstTx[acc]; ok && a.qtyAt(acc, f.AddDate(0, 0, -1)) <= 1e-9 {
		return time.Time{}
	}
	// 첫 기록이 받은 회차 = 그 기록 날짜(+앞선 기록 허용 일수)까지의 마지막 배당락일
	limit := recs[0].AddDate(0, 0, divRecordLeadDays)
	var start time.Time
	for _, e := range a.market {
		if ex := time.Unix(e.Time, 0); !ex.After(limit) && ex.After(start) {
			start = ex
		}
	}
	return start
}

// ───────────────────────── 종목 상세 ─────────────────────────

type DivScoreHistoryPoint struct {
	Month     string  `json:"month"`
	Score     float64 `json:"score"`
	Rank      int     `json:"rank"`
	Of        int     `json:"of"` // 그달 순위 종목 수
	Status    string  `json:"status"`
	Estimated bool    `json:"estimated"`
}

type DivYearDPS struct {
	Year    int     `json:"year"`
	Regular float64 `json:"regular"` // 정기 배당 합 (주당)
	Special float64 `json:"special"` // 특별배당 합 (주당)
	Count   int     `json:"count"`
	Partial bool    `json:"partial"` // 올해 (진행 중)
}

type DivPayment struct {
	Date    string  `json:"date"`
	Amount  float64 `json:"amount"`
	Special bool    `json:"special"`
}

type DivScoreDetail struct {
	AssetID  uint                   `json:"asset_id"`
	Asset    models.Asset           `json:"asset"`
	Source   string                 `json:"source"`
	Currency string                 `json:"currency"`
	History  []DivScoreHistoryPoint `json:"history"` // 오래된 달부터
	Years    []DivYearDPS           `json:"years"`
	Payments []DivPayment           `json:"payments"` // 최근 3년, 최근 것부터
	Position *DivScorePosition      `json:"position,omitempty"` // 지금 보유 (없으면 보유하지 않는 종목)
}

// DivScorePosition 은 이 종목의 지금 보유 — 계좌별 수량·평단과 지금 보유 기간에 받은 배당 (금액은 종목 통화, 배당은 기록 통화별)
type DivScorePosition struct {
	Quantity float64                   `json:"quantity"`
	AvgPrice float64                   `json:"avg_price"`       // 수량 가중 평균 매수가
	Cost     float64                   `json:"cost"`            // 원금 = Σ 수량 × 평단
	Since    string                    `json:"since,omitempty"` // 지금 보유를 시작한 날 (계좌 중 가장 이른, YYYY-MM-DD)
	Received []DivReceived             `json:"received"`        // 지금 보유 기간에 받은 배당 (세후)
	Accounts []DivScorePositionAccount `json:"accounts"`        // 평가 원금이 큰 계좌부터
}

// DivReceived 는 받은 배당 합계 (세후 = 금액 − 세금), 기록 통화별
type DivReceived struct {
	Currency string  `json:"currency"`
	Total    float64 `json:"total"`
	Last12m  float64 `json:"last_12m"`
	Count    int     `json:"count"`
}

type DivScorePositionAccount struct {
	AccountID   uint    `json:"account_id"`
	Name        string  `json:"name"`
	Broker      string  `json:"broker"`
	AccountType string  `json:"account_type"`
	Quantity    float64 `json:"quantity"`
	AvgPrice    float64 `json:"avg_price"`
	Since       string  `json:"since,omitempty"`
}

// position: 지금 보유 계좌별 수량·평단, 보유를 시작한 날(수량이 0 에서 늘어난 마지막 날), 그 뒤 그 계좌에서 받은 배당
func (s *DividendScoreService) position(assetID uint, now time.Time) (*DivScorePosition, error) {
	var holdings []models.Holding
	if err := s.db.Where("asset_id = ? AND quantity > 0", assetID).Find(&holdings).Error; err != nil {
		return nil, err
	}
	if len(holdings) == 0 {
		return nil, nil
	}
	byAcc := map[uint]*DivScorePositionAccount{}
	ids := []uint{}
	for _, h := range holdings {
		r := byAcc[h.AccountID]
		if r == nil {
			r = &DivScorePositionAccount{AccountID: h.AccountID}
			byAcc[h.AccountID] = r
			ids = append(ids, h.AccountID)
		}
		// 같은 계좌에 줄이 둘이면 수량 가중으로 합친다
		cost := r.Quantity*r.AvgPrice + h.Quantity*h.AveragePrice
		r.Quantity += h.Quantity
		if r.Quantity > 0 {
			r.AvgPrice = cost / r.Quantity
		}
	}
	var accounts []models.Account
	if err := s.db.Unscoped().Where("id IN ?", ids).Find(&accounts).Error; err != nil {
		return nil, err
	}
	for _, a := range accounts {
		if r := byAcc[a.ID]; r != nil {
			r.Name, r.Broker, r.AccountType = a.Name, a.Broker, string(a.AccountType)
		}
	}
	// 보유 시작: 매매를 날짜순으로 따라가며 수량이 0 에서 늘어난 마지막 날
	var txs []models.Transaction
	if err := s.db.Where("asset_id = ? AND account_id IN ?", assetID, ids).Order("date ASC, id ASC").Find(&txs).Error; err != nil {
		return nil, err
	}
	qty := map[uint]float64{}
	since := map[uint]time.Time{}
	for _, t := range txs {
		before := qty[t.AccountID]
		switch t.Type {
		case models.TransactionTypeBuy:
			qty[t.AccountID] += t.Quantity
		case models.TransactionTypeSell:
			qty[t.AccountID] -= t.Quantity
		}
		if before <= 1e-9 && qty[t.AccountID] > 1e-9 {
			since[t.AccountID] = t.Date
		}
	}
	var divs []models.Dividend
	if err := s.db.Where("asset_id = ? AND account_id IN ? AND is_received = ?", assetID, ids, true).Find(&divs).Error; err != nil {
		return nil, err
	}
	got := map[string]*DivReceived{}
	yearAgo := now.AddDate(-1, 0, 0)
	for _, d := range divs {
		if st, ok := since[d.AccountID]; ok && d.Date.Before(st) {
			continue // 지금 보유 전(예전에 팔기 전)에 받은 배당
		}
		c := strings.ToUpper(d.Currency)
		r := got[c]
		if r == nil {
			r = &DivReceived{Currency: c}
			got[c] = r
		}
		net := d.Amount - d.Tax
		r.Total += net
		r.Count++
		if d.Date.After(yearAgo) {
			r.Last12m += net
		}
	}

	out := &DivScorePosition{Received: []DivReceived{}, Accounts: []DivScorePositionAccount{}}
	var first time.Time
	for _, id := range ids {
		r := byAcc[id]
		if st, ok := since[id]; ok {
			r.Since = st.In(kst).Format(dateLayout)
			if first.IsZero() || st.Before(first) {
				first = st
			}
		}
		out.Quantity += r.Quantity
		out.Cost += r.Quantity * r.AvgPrice
		out.Accounts = append(out.Accounts, *r)
	}
	if out.Quantity > 0 {
		out.AvgPrice = out.Cost / out.Quantity
	}
	if !first.IsZero() {
		out.Since = first.In(kst).Format(dateLayout)
	}
	sort.SliceStable(out.Accounts, func(i, j int) bool {
		return out.Accounts[i].Quantity*out.Accounts[i].AvgPrice > out.Accounts[j].Quantity*out.Accounts[j].AvgPrice
	})
	for _, r := range got {
		out.Received = append(out.Received, *r)
	}
	sort.Slice(out.Received, func(i, j int) bool { return out.Received[i].Currency < out.Received[j].Currency })
	return out, nil
}

// GetDetail: 한 종목의 월별 점수·순위 흐름, 연도별 주당 배당, 최근 3년 회차
func (s *DividendScoreService) GetDetail(assetID uint) (*DivScoreDetail, error) {
	now := s.clock()
	window := recentMonths(now, divScoreMonths)
	if err := s.ensureMonths(window); err != nil {
		return nil, err
	}
	st, err := s.GetSettings()
	if err != nil {
		return nil, err
	}
	w := weightsOf(st)
	var snaps []models.DividendScoreSnapshot
	if err := s.db.Where("month IN ?", window).Find(&snaps).Error; err != nil {
		return nil, err
	}
	byMonth := map[string][]models.DividendScoreSnapshot{}
	for _, sn := range snaps {
		byMonth[sn.Month] = append(byMonth[sn.Month], sn)
	}
	out := &DivScoreDetail{AssetID: assetID, History: []DivScoreHistoryPoint{}, Years: []DivYearDPS{}, Payments: []DivPayment{}}
	for i := len(window) - 1; i >= 0; i-- {
		rows := rankMonth(byMonth[window[i]], w)
		for _, r := range rows {
			if r.AssetID == assetID {
				out.History = append(out.History, DivScoreHistoryPoint{Month: window[i], Score: r.Score, Rank: r.Rank, Of: len(rows), Status: r.Metrics.Status, Estimated: r.Estimated})
			}
		}
	}

	if out.Position, err = s.position(assetID, now); err != nil {
		return nil, err
	}

	assets, err := s.loadAssets(now, false)
	if err != nil {
		return nil, err
	}
	a := assets[assetID]
	if a == nil {
		var asset models.Asset
		if err := s.db.Unscoped().First(&asset, assetID).Error; err != nil {
			return nil, &ErrDivScoreInput{"종목을 찾을 수 없습니다"}
		}
		out.Asset = asset
		return out, nil
	}
	out.Asset, out.Source, out.Currency = a.asset, a.source, tickerCurrency(a.asset.Ticker)
	special := markSpecials(a.events)
	years := map[int]*DivYearDPS{}
	cur := now.In(kst).Year()
	for i, e := range a.events {
		y := e.Date.In(kst).Year()
		if y < cur-4 {
			continue // 시장 이력은 5년 치라 그 첫 해는 일부만 있다
		}
		row := years[y]
		if row == nil {
			row = &DivYearDPS{Year: y, Partial: y == cur}
			years[y] = row
		}
		if special[i] {
			row.Special += e.Amount
		} else {
			row.Regular += e.Amount
		}
		row.Count++
	}
	for _, y := range years {
		out.Years = append(out.Years, *y)
	}
	sort.Slice(out.Years, func(i, j int) bool { return out.Years[i].Year < out.Years[j].Year })
	for i := len(a.events) - 1; i >= 0; i-- {
		e := a.events[i]
		if e.Date.Before(now.AddDate(-3, 0, 0)) {
			break
		}
		out.Payments = append(out.Payments, DivPayment{Date: e.Date.In(kst).Format(dateLayout), Amount: e.Amount, Special: special[i]})
	}
	return out, nil
}
