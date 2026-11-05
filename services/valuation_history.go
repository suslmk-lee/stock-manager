package services

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

// PER/PBR 을 "자기 과거 평균" 과 비교하기 위한 월말 밸류에이션 이력.
//   - 월말 종가: 월봉(range 5y, interval 1mo) 의 해당 월 봉 종가 (진행 중인 이번 달은 제외)
//   - 월말 EPS/BPS: 해당 월말 − 보고 지연(45일) 이전에 끝난 가장 최근 기간 값 (미래 정보 사용 방지)
//   - EPS: 분기 EPS 가 연속 4개 있으면 TTM(합), 그 외 구간은 연간 EPS. 같은 기간 종료일이면 TTM 이 우선.
//     (네이버는 분기 5개/연간 3개, Yahoo 는 분기 5개/연간 4개 정도만 주므로 오래된 달은 연간 EPS 로 채워진다)
//   - PER = 종가/EPS (EPS > 0 일 때만), PBR = 종가/BPS (BPS > 0 일 때만)
//   - 지점이 6개 미만이면 저장된 FundamentalSnapshot(일별)을 월말로 모은 이력으로 대체한다.

const (
	valuationMaxMonths     = 60 // 캐시하는 최대 월 수 (규칙 기간의 상한과 같다)
	valuationMinPoints     = 6  // 평균을 신뢰하려면 필요한 월말 지점 수
	valuationLagDays       = 45 // 결산 후 공시까지의 지연
	valuationMaxStaleDays  = 550
	valuationTTL           = 12 * time.Hour
	defaultValuationMonths = 36

	valuationSourceComputed  = "computed"
	valuationSourceSnapshots = "snapshots"
)

// ValuationPoint 는 한 달(월말 기준)의 PER 또는 PBR 이다.
type ValuationPoint struct {
	Month string  `json:"month"` // YYYY-MM (KST)
	Value float64 `json:"value"`
}

// ValuationSeries 는 종목의 월말 PER/PBR 이력(최대 60개월, 오래된 달부터)이다.
type ValuationSeries struct {
	PER       []ValuationPoint
	PBR       []ValuationPoint
	PERSource string // "computed" | "snapshots" ("" = 이력 없음)
	PBRSource string
}

// Source 는 항목에 표시할 출처다 (PER 의 출처를 우선, 없으면 PBR).
func (v *ValuationSeries) Source() string {
	if v == nil {
		return ""
	}
	if v.PERSource != "" {
		return v.PERSource
	}
	return v.PBRSource
}

// ---- 순수 계산 ----

func valMonthKey(t time.Time) string { return t.In(kst).Format("2006-01") }

// ttmEPS 는 분기 EPS 로부터 TTM(연속 4개 분기 합)을 만든다. 분기 간격이 75~110일이 아니면 연속으로 보지 않는다.
func ttmEPS(q []PeriodValue) []PeriodValue {
	q = append([]PeriodValue(nil), q...)
	sortPeriods(q)
	var out []PeriodValue
	for i := 3; i < len(q); i++ {
		ok := true
		sum := 0.0
		for j := i - 3; j <= i; j++ {
			sum += q[j].Value
			if j > i-3 {
				gap := q[j].End.Sub(q[j-1].End).Hours() / 24
				if gap < 75 || gap > 110 {
					ok = false
				}
			}
		}
		if ok {
			out = append(out, PeriodValue{End: q[i].End, Value: sum})
		}
	}
	return out
}

// mergePeriods 는 base 에 prefer 를 합친다. 종료일이 7일 이내로 겹치면 prefer 가 base 를 대체한다.
func mergePeriods(base, prefer []PeriodValue) []PeriodValue {
	out := make([]PeriodValue, 0, len(base)+len(prefer))
	for _, b := range base {
		dup := false
		for _, p := range prefer {
			if d := b.End.Sub(p.End).Hours() / 24; d >= -7 && d <= 7 {
				dup = true
				break
			}
		}
		if !dup {
			out = append(out, b)
		}
	}
	out = append(out, prefer...)
	sortPeriods(out)
	return out
}

// epsSeries 는 월말 조회에 쓸 EPS 지점(TTM 우선, 연간 보완)이다.
func epsSeries(h *FundamentalHistory) []PeriodValue {
	return mergePeriods(h.AnnualEPS, ttmEPS(h.QuarterlyEPS))
}

// bpsSeries 는 월말 조회에 쓸 BPS 지점(분기 우선, 연간 보완)이다.
func bpsSeries(h *FundamentalHistory) []PeriodValue {
	return mergePeriods(h.AnnualBPS, h.QuarterlyBPS)
}

// asOfPeriod 는 monthEnd − 보고 지연 이전에 끝난 가장 최근 값이다. 너무 오래된 값(550일 초과)은 쓰지 않는다.
func asOfPeriod(points []PeriodValue, monthEnd time.Time) (float64, bool) {
	cut := monthEnd.AddDate(0, 0, -valuationLagDays)
	idx := sort.Search(len(points), func(i int) bool { return points[i].End.After(cut) }) - 1
	if idx < 0 {
		return 0, false
	}
	if monthEnd.Sub(points[idx].End).Hours()/24 > valuationMaxStaleDays {
		return 0, false
	}
	return points[idx].Value, true
}

// monthWindow 는 now 직전 완료된 달 months 개의 (키, 월 시작, 다음 달 시작)을 오래된 순으로 돌려준다.
func monthWindow(now time.Time, months int) (keys []string, firsts []time.Time) {
	nk := now.In(kst)
	for k := months; k >= 1; k-- {
		first := time.Date(nk.Year(), nk.Month()-time.Month(k), 1, 0, 0, 0, 0, kst)
		keys = append(keys, first.Format("2006-01"))
		firsts = append(firsts, first)
	}
	return
}

// BuildValuationSeries 는 월봉 종가와 EPS/BPS 이력으로 최근 months 개월(완료된 달)의 월말 PER/PBR 을 만든다. 순수 함수다.
func BuildValuationSeries(prices []PricePoint, h *FundamentalHistory, now time.Time, months int) (per, pbr []ValuationPoint) {
	if h == nil || len(prices) == 0 {
		return nil, nil
	}
	if months < 1 || months > valuationMaxMonths {
		months = valuationMaxMonths
	}
	sorted := make([]PricePoint, 0, len(prices))
	for _, p := range prices {
		if p.Close > 0 && finite(p.Close) {
			sorted = append(sorted, p)
		}
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Time < sorted[j].Time })
	closeOf := map[string]float64{}
	for _, p := range sorted {
		closeOf[valMonthKey(time.Unix(p.Time, 0))] = p.Close // 같은 달이면 마지막 값
	}
	eps, bps := epsSeries(h), bpsSeries(h)
	keys, firsts := monthWindow(now, months)
	for i, key := range keys {
		price, ok := closeOf[key]
		if !ok {
			continue
		}
		monthEnd := firsts[i].AddDate(0, 1, 0).Add(-time.Second)
		if v, ok := asOfPeriod(eps, monthEnd); ok && v > 0 {
			per = append(per, ValuationPoint{key, price / v})
		}
		if v, ok := asOfPeriod(bps, monthEnd); ok && v > 0 {
			pbr = append(pbr, ValuationPoint{key, price / v})
		}
	}
	return per, pbr
}

// SnapshotValuationSeries 는 일별 펀더멘털 스냅샷을 월별 마지막 값으로 모은다 (완료된 최근 months 개월). 순수 함수다.
func SnapshotValuationSeries(snaps []models.FundamentalSnapshot, now time.Time, months int) (per, pbr []ValuationPoint) {
	if months < 1 || months > valuationMaxMonths {
		months = valuationMaxMonths
	}
	keys, _ := monthWindow(now, months)
	inWindow := map[string]bool{}
	for _, k := range keys {
		inWindow[k] = true
	}
	sorted := append([]models.FundamentalSnapshot(nil), snaps...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Date < sorted[j].Date })
	lastPER, lastPBR := map[string]float64{}, map[string]float64{}
	for _, s := range sorted {
		if len(s.Date) < 7 || !inWindow[s.Date[:7]] {
			continue
		}
		if s.PER > 0 && finite(s.PER) {
			lastPER[s.Date[:7]] = s.PER
		}
		if s.PBR > 0 && finite(s.PBR) {
			lastPBR[s.Date[:7]] = s.PBR
		}
	}
	for _, k := range keys {
		if v, ok := lastPER[k]; ok {
			per = append(per, ValuationPoint{k, v})
		}
		if v, ok := lastPBR[k]; ok {
			pbr = append(pbr, ValuationPoint{k, v})
		}
	}
	return per, pbr
}

// valuationWindowPoints 는 최근 window 개월(완료된 달)에 속한 양수 지점만 남긴다.
func valuationWindowPoints(points []ValuationPoint, window int, now time.Time) []ValuationPoint {
	keys, _ := monthWindow(now, window)
	if len(keys) == 0 {
		return nil
	}
	from := keys[0]
	var out []ValuationPoint
	for _, p := range points {
		if p.Month >= from && p.Month <= keys[len(keys)-1] && p.Value > 0 && finite(p.Value) {
			out = append(out, p)
		}
	}
	return out
}

// ValuationAverage 는 최근 window 개월 지점의 평균과 지점 수다. 지점이 6개 미만이면 ok=false (평균은 참고용으로 돌려준다).
func ValuationAverage(points []ValuationPoint, window int, now time.Time) (avg float64, n int, ok bool) {
	pts := valuationWindowPoints(points, window, now)
	if len(pts) == 0 {
		return 0, 0, false
	}
	sum := 0.0
	for _, p := range pts {
		sum += p.Value
	}
	return sum / float64(len(pts)), len(pts), len(pts) >= valuationMinPoints
}

// computeValuationMetrics 는 PER/PBR 의 과거 평균 대비 지표를 item 에 채운다.
// 현재 값은 실시간 PER/PBR(없으면 마지막 월말 값)이다.
func computeValuationMetrics(item *SignalItem, vs *ValuationSeries, window int, now time.Time) {
	if vs == nil {
		return
	}
	if window == 0 {
		window = defaultValuationMonths
	}
	one := func(points []ValuationPoint, live float64, avgOut, vsOut *float64, nOut *int) bool {
		avg, n, ok := ValuationAverage(points, window, now)
		if n == 0 {
			return false
		}
		*nOut = n
		if ok && avg > 0 {
			cur := live
			if !(cur > 0) {
				pts := valuationWindowPoints(points, window, now)
				cur = pts[len(pts)-1].Value
			}
			*avgOut = avg
			*vsOut = (cur/avg - 1) * 100
		}
		return true
	}
	a := one(vs.PER, item.PER, &item.PERAvg, &item.PERVsAvgPct, &item.PERPoints)
	b := one(vs.PBR, item.PBR, &item.PBRAvg, &item.PBRVsAvgPct, &item.PBRPoints)
	if a || b {
		item.ValuationSource = vs.Source()
		item.ValuationWindowMonths = window
	}
}

// validateValuationRules 는 11단계(PER/PBR 평균 대비) 규칙을 검증하고 비어 있는 값(0)을 기본값으로 채운다.
func validateValuationRules(r *models.SignalRuleConfig) error {
	def := models.DefaultSignalRuleConfig()
	if r.ValuationWindowMonths == 0 {
		r.ValuationWindowMonths = def.ValuationWindowMonths
	}
	if r.ValuationWindowMonths < 12 || r.ValuationWindowMonths > valuationMaxMonths {
		return &ErrInvalidSignalRule{"valuation_window_months must be 12..60"}
	}
	for _, c := range []struct {
		name string
		v    *float64
		def  float64
		max  float64
	}{
		{"per_avg_buy_pct", &r.PerAvgBuyPct, def.PerAvgBuyPct, 90},
		{"per_avg_sell_pct", &r.PerAvgSellPct, def.PerAvgSellPct, 500},
		{"pbr_avg_buy_pct", &r.PbrAvgBuyPct, def.PbrAvgBuyPct, 90},
		{"pbr_avg_sell_pct", &r.PbrAvgSellPct, def.PbrAvgSellPct, 500},
	} {
		if math.IsNaN(*c.v) || math.IsInf(*c.v, 0) {
			return &ErrInvalidSignalRule{c.name + " must be a finite number"}
		}
		if *c.v == 0 {
			*c.v = c.def
		}
		if *c.v < 0 || *c.v > c.max {
			return &ErrInvalidSignalRule{fmt.Sprintf("%s must be in (0, %g]", c.name, c.max)}
		}
	}
	return nil
}

// ---- 서비스 (캐시 + 조회) ----

type valuationEntry struct {
	s         *ValuationSeries
	fetchedAt time.Time
}

// ValuationService 는 종목별 월말 PER/PBR 이력을 12시간 캐시로 제공한다.
// 빈 결과는 캐시하고, 오류는 캐시하지 않는다.
type ValuationService struct {
	ticker *TickerService
	fund   *FundamentalsService
	db     *gorm.DB

	mu      sync.Mutex
	entries map[string]valuationEntry

	// 테스트 훅 (운영에서는 nil)
	fetchPrices   func(ticker string) (*PriceHistory, error)
	fetchHistory  func(ticker string) (*FundamentalHistory, error)
	loadSnapshots func(ticker string) ([]models.FundamentalSnapshot, error)
	now           func() time.Time
}

// NewValuationService 는 서비스를 만든다. db 가 nil 이면 스냅샷 대체를 쓰지 않는다.
func NewValuationService(db *gorm.DB, ticker *TickerService, fund *FundamentalsService) *ValuationService {
	return &ValuationService{db: db, ticker: ticker, fund: fund, entries: map[string]valuationEntry{}}
}

func (s *ValuationService) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *ValuationService) prices(ticker string) (*PriceHistory, error) {
	if s.fetchPrices != nil {
		return s.fetchPrices(ticker)
	}
	if s.ticker == nil {
		return nil, fmt.Errorf("ticker service unavailable")
	}
	return s.ticker.cachedHistory(ticker, "5y", "1mo")
}

func (s *ValuationService) history(ticker string) (*FundamentalHistory, error) {
	if s.fetchHistory != nil {
		return s.fetchHistory(ticker)
	}
	if s.fund == nil {
		return nil, fmt.Errorf("fundamentals service unavailable")
	}
	return s.fund.GetHistory(ticker)
}

func (s *ValuationService) snapshots(ticker string, now time.Time) ([]models.FundamentalSnapshot, error) {
	if s.loadSnapshots != nil {
		return s.loadSnapshots(ticker)
	}
	if s.db == nil {
		return nil, nil
	}
	var rows []models.FundamentalSnapshot
	from := now.In(kst).AddDate(0, -valuationMaxMonths-1, 0).Format("2006-01-02")
	err := s.db.Where("ticker = ? AND date >= ?", ticker, from).Order("date").Find(&rows).Error
	return rows, err
}

// Get 은 캐시를 우선해 월말 PER/PBR 이력을 돌려준다. 오류는 캐시하지 않는다.
func (s *ValuationService) Get(ticker string) (*ValuationSeries, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if ticker == "" {
		return nil, fmt.Errorf("ticker symbol is required")
	}
	now := s.clock()
	s.mu.Lock()
	if e, ok := s.entries[ticker]; ok && now.Sub(e.fetchedAt) <= valuationTTL {
		s.mu.Unlock()
		return e.s, nil
	}
	s.mu.Unlock()

	series := &ValuationSeries{}
	var fetchErr error
	ph, err := s.prices(ticker)
	if err != nil {
		fetchErr = err
	}
	var fh *FundamentalHistory
	if fetchErr == nil {
		if fh, err = s.history(ticker); err != nil {
			fetchErr = err
		}
	}
	if fetchErr == nil && ph != nil && fh != nil && !(fh.Currency != "" && ph.Currency != "" && !strings.EqualFold(fh.Currency, ph.Currency)) {
		series.PER, series.PBR = BuildValuationSeries(ph.Points, fh, now, valuationMaxMonths)
		if len(series.PER) > 0 {
			series.PERSource = valuationSourceComputed
		}
		if len(series.PBR) > 0 {
			series.PBRSource = valuationSourceComputed
		}
	}

	// 지점이 6개 미만이면 저장된 일별 스냅샷(월말 집계)으로 대체한다.
	if len(series.PER) < valuationMinPoints || len(series.PBR) < valuationMinPoints {
		if snaps, serr := s.snapshots(ticker, now); serr == nil && len(snaps) > 0 {
			sp, sb := SnapshotValuationSeries(snaps, now, valuationMaxMonths)
			if len(series.PER) < valuationMinPoints && len(sp) >= valuationMinPoints {
				series.PER, series.PERSource = sp, valuationSourceSnapshots
			}
			if len(series.PBR) < valuationMinPoints && len(sb) >= valuationMinPoints {
				series.PBR, series.PBRSource = sb, valuationSourceSnapshots
			}
		}
	}
	if fetchErr != nil {
		// 조회 실패: 스냅샷으로 쓸 만한 값이 있으면 돌려주되 캐시하지 않는다.
		if series.PERSource == valuationSourceSnapshots || series.PBRSource == valuationSourceSnapshots {
			return series, nil
		}
		return nil, fetchErr
	}
	s.mu.Lock()
	if s.entries == nil {
		s.entries = map[string]valuationEntry{}
	}
	s.entries[ticker] = valuationEntry{series, now}
	s.mu.Unlock()
	return series, nil
}

// GetMany 는 여러 종목을 동시에(최대 5개) 조회한다. 실패한 종목은 결과에서 빠진다.
func (s *ValuationService) GetMany(tickers []string) map[string]*ValuationSeries {
	out := map[string]*ValuationSeries{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 5)
	seen := map[string]bool{}
	for _, t := range tickers {
		k := strings.ToUpper(strings.TrimSpace(t))
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		wg.Add(1)
		sem <- struct{}{}
		go func(k string) {
			defer wg.Done()
			defer func() { <-sem }()
			if v, err := s.Get(k); err == nil && v != nil {
				mu.Lock()
				out[k] = v
				mu.Unlock()
			}
		}(k)
	}
	wg.Wait()
	return out
}
