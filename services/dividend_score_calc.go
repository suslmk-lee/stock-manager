package services

import (
	"math"
	"sort"
	"time"
)

// 배당 점수 — 보유 종목의 주당 배당 이력(시장, 없으면 내 기록)과 일별 종가로 asOf 시점의 지표와 항목 점수(0~1)를 계산한다.
// 순수 함수 모음이다 (네트워크·DB 없음).
//
//   배당 성장(30)   3년 연평균 증가율 60% + 최근 1년 증가율 40% — 배당수익률이 2% 아래면 줄인다 (작은 배당의 큰 증가율 보정)
//   배당 안정성(25) 삭감 없이 이어진 해 50% + 최근 3년 삭감 횟수 30% + 회차별 금액 변동 20%
//   수익률 매력(20) 지금 배당수익률 70% + 최근 2년 평균 대비 30% (1년 새 배당이 30% 넘게 바뀌었으면 평균 대비는 중간값)
//   지급 꾸준함(10) 지급 주기 50% + 최근 3년 빠진 회차 50% (지금 회차가 늦으면 절반)
//   가격·가치(15)   52주 범위에서의 위치 60% + 200일 이동평균 대비 40% (낮을수록 높은 점수)
// 특별배당(직전 회차들 중앙값의 2배 초과)은 성장·안정성 계산에서 뺀다.

const (
	divStatusUp     = "up"     // 증가 (최근 12개월 주당 배당 +3% 이상)
	divStatusFlat   = "flat"   // 유지
	divStatusDown   = "down"   // 감소 (−3% 이하)
	divStatusMissed = "missed" // 누락 (주기상 나와야 할 회차가 나오지 않음)
	divStatusNew    = "new"    // 이력 부족 (2년 미만)

	divChangeBand   = 0.03 // 증가·감소로 볼 변화 폭
	divCutBand      = 0.03 // 삭감으로 볼 감소 폭
	divSpecialRatio = 2.0  // 특별배당: 직전 회차 중앙값의 이 배수 초과
	divHistoryTol   = 45 * 24 * time.Hour
)

// DivScoreMetrics 는 화면에 보여 줄 지표다 (금액은 종목 통화, 비율은 %).
type DivScoreMetrics struct {
	Source        string   `json:"source"`                 // market (시장 배당 이력) | records (내 배당 기록)
	TTM           float64  `json:"ttm"`                    // 최근 12개월 주당 배당 (특별배당 제외)
	Growth1y      *float64 `json:"growth_1y,omitempty"`    // 최근 12개월 ÷ 직전 12개월 − 1 (%)
	Cagr3y        *float64 `json:"cagr_3y,omitempty"`      // 3년 연평균 증가율 (%)
	NoCutYears    int      `json:"no_cut_years"`           // 삭감 없이 이어진 해 (최대 4)
	IncreaseYears int      `json:"increase_years"`         // 연속 증가한 해
	Cuts3y        int      `json:"cuts_3y"`                // 최근 3년 중 삭감한 해
	Missed3y      int      `json:"missed_3y"`              // 최근 3년 빠진 회차
	MissedNow     bool     `json:"missed_now"`             // 지금 회차가 주기보다 늦음
	CV            *float64 `json:"cv,omitempty"`           // 최근 2년 회차별 금액 변동계수
	Cycle         string   `json:"cycle,omitempty"`        // 월 · 격월 · 분기 · 반기 · 연 · 불규칙
	Payments12m   int      `json:"payments_12m"`           // 최근 12개월 지급 횟수
	Specials12m   int      `json:"specials_12m"`           // 최근 12개월 특별배당 횟수
	LastPayment   string   `json:"last_payment,omitempty"` // 마지막 배당일 (YYYY-MM-DD, 시장 이력이면 배당락일)
	NextExpected  string   `json:"next_expected,omitempty"`
	Price         float64  `json:"price,omitempty"`
	YieldPct      *float64 `json:"yield_pct,omitempty"`     // 지금 배당수익률
	AvgYieldPct   *float64 `json:"avg_yield_pct,omitempty"` // 최근 24개월 월말 평균
	Pos52         *float64 `json:"pos_52,omitempty"`        // 52주 범위에서의 위치 (0 = 최저, 1 = 최고)
	MAGapPct      *float64 `json:"ma_gap_pct,omitempty"`    // 200일 이동평균 대비 (%)
	HistoryYears  float64  `json:"history_years"`           // 배당 이력 길이 (년)
	Status        string   `json:"status"`
}

// DivScoreParts 는 항목별 점수 (0~1)
type DivScoreParts struct {
	Growth      float64 `json:"growth"`
	Stability   float64 `json:"stability"`
	Yield       float64 `json:"yield"`
	Consistency float64 `json:"consistency"`
	Value       float64 `json:"value"`
}

// piecewise: 점 (x, y) 를 잇는 꺾은선. 범위 밖은 끝 값.
func piecewise(x float64, pts [][2]float64) float64 {
	if x <= pts[0][0] {
		return pts[0][1]
	}
	for i := 1; i < len(pts); i++ {
		if x <= pts[i][0] {
			a, b := pts[i-1], pts[i]
			return a[1] + (b[1]-a[1])*(x-a[0])/(b[0]-a[0])
		}
	}
	return pts[len(pts)-1][1]
}

func fptr(v float64) *float64 { return &v }

// markSpecials: 일회성으로 크게 나온 회차만 특별배당으로 본다. 모두 맞아야 한다:
//   - 직전 회차(최대 8개) 중앙값의 2배 초과 (직전 3회 이상일 때만)
//   - 1년 전·1년 뒤(±45일)에 비슷한 회차(절반 이상)가 없다 — 국내 결산 배당처럼 해마다 크게 나오는 회차는 정기
//   - 바로 앞·뒤 회차가 절반 아래다 — 배당을 크게 올린 뒤 그 수준이 이어지면 정기 (뒤 회차가 아직 없으면 앞 회차로만)
func markSpecials(events []DivPerShare) []bool {
	special := make([]bool, len(events))
	near := func(t time.Time, amount float64) bool {
		for _, o := range events {
			if math.Abs(o.Date.Sub(t).Hours()/24) <= 45 && o.Amount >= amount*0.5 {
				return true
			}
		}
		return false
	}
	for i, e := range events {
		if i < 3 {
			continue
		}
		w := make([]float64, 0, 8)
		for j := max(0, i-8); j < i; j++ {
			w = append(w, events[j].Amount)
		}
		sort.Float64s(w)
		med := w[len(w)/2]
		if len(w)%2 == 0 {
			med = (w[len(w)/2-1] + w[len(w)/2]) / 2
		}
		if med <= 0 || e.Amount <= med*divSpecialRatio {
			continue
		}
		if near(e.Date.AddDate(-1, 0, 0), e.Amount) || near(e.Date.AddDate(1, 0, 0), e.Amount) {
			continue // 해마다 나오는 큰 회차
		}
		if events[i-1].Amount >= e.Amount*0.5 || (i+1 < len(events) && events[i+1].Amount >= e.Amount*0.5) {
			continue // 오른 수준이 이어짐
		}
		special[i] = true
	}
	return special
}

// cycleOf: 최근 12개월 지급 횟수로 본 주기
func divCycleOf(n int) string {
	switch {
	case n <= 0:
		return ""
	case n >= 10:
		return "월"
	case n >= 7:
		return "불규칙"
	case n == 6:
		return "격월"
	case n >= 3:
		return "분기"
	case n == 2:
		return "반기"
	default:
		return "연"
	}
}

var divCycleScore = map[string]float64{"월": 1, "격월": 0.85, "분기": 0.8, "반기": 0.5, "연": 0.4, "불규칙": 0.3}

// computeDivScore: asOf 시점의 지표와 항목 점수. 최근 2년 안에 배당이 없으면 ok=false (배당주가 아님).
// events 는 날짜 오름차순 주당 배당, closes 는 일별 종가 (asOf 이후 값은 무시한다).
func computeDivScore(events []DivPerShare, closes []PricePoint, asOf time.Time, source string) (DivScoreMetrics, DivScoreParts, bool) {
	m := DivScoreMetrics{Source: source}
	var parts DivScoreParts

	// asOf 이전 회차만
	var evs []DivPerShare
	for _, e := range events {
		if !e.Date.After(asOf) && e.Amount > 0 && finite(e.Amount) {
			evs = append(evs, e)
		}
	}
	if len(evs) == 0 || evs[len(evs)-1].Date.Before(asOf.AddDate(-2, 0, 0)) {
		return m, parts, false
	}
	special := markSpecials(evs)
	var reg []DivPerShare
	for i, e := range evs {
		if special[i] {
			if e.Date.After(asOf.AddDate(-1, 0, 0)) {
				m.Specials12m++
			}
			continue
		}
		reg = append(reg, e)
	}
	if len(reg) == 0 {
		return m, parts, false
	}
	first := reg[0].Date
	m.HistoryYears = math.Round(asOf.Sub(first).Hours()/24/365.25*10) / 10
	m.TTM = dps12Between(reg, asOf) // 배당수익률용: asOf 까지 12개월

	// 해마다 비교할 1년 창은 마지막 정기 회차를 기준으로, 앞뒤로 회차 간격의 절반만큼 여유를 둔다.
	// asOf 에 맞춘 12개월 창은 배당락일이 해마다 며칠~몇 주씩 밀리면 한 해에 5회·다음 해에 3~4회가 잡혀 증감이 크게 틀어진다.
	anchor := reg[len(reg)-1].Date
	var recentGaps []float64
	for i := max(1, len(reg)-8); i < len(reg); i++ {
		recentGaps = append(recentGaps, reg[i].Date.Sub(reg[i-1].Date).Hours()/24)
	}
	slackDays := 45.0
	if len(recentGaps) > 0 {
		sort.Float64s(recentGaps)
		slackDays = math.Min(math.Max(recentGaps[len(recentGaps)/2]/2, 10), 182)
	}
	slack := time.Duration(slackDays*24) * time.Hour
	covers := func(years int) bool { return !first.After(anchor.AddDate(-years, 0, 0).Add(slack + divHistoryTol)) }
	// 창 = (마지막 회차 + 간격 절반 − 1년, 마지막 회차 + 간격 절반] — 해마다 앞뒤로 간격 절반까지 밀린 회차는 같은 해로 본다
	ttm := func(yearsBack int) float64 {
		end := anchor.AddDate(-yearsBack, 0, 0).Add(slack)
		start := end.AddDate(-1, 0, 0)
		sum := 0.0
		for _, e := range reg {
			if e.Date.After(start) && !e.Date.After(end) {
				sum += e.Amount
			}
		}
		return sum
	}

	if cur, prev := ttm(0), ttm(1); covers(2) && prev > 0 && cur > 0 {
		m.Growth1y = fptr((cur/prev - 1) * 100)
	}
	if cur, prev := ttm(0), ttm(3); covers(4) && prev > 0 && cur > 0 {
		m.Cagr3y = fptr((math.Pow(cur/prev, 1.0/3) - 1) * 100)
	}
	// 삭감 없이 이어진 해 · 연속 증가 · 최근 3년 삭감
	for k := 0; k < 4 && covers(k+2); k++ {
		cur, prev := ttm(k), ttm(k+1)
		if prev <= 0 || cur < prev*(1-divCutBand) {
			break
		}
		m.NoCutYears++
	}
	for k := 0; k < 4 && covers(k+2); k++ {
		cur, prev := ttm(k), ttm(k+1)
		if prev <= 0 || cur <= prev*1.001 {
			break
		}
		m.IncreaseYears++
	}
	for k := 0; k < 3 && covers(k+2); k++ {
		if cur, prev := ttm(k), ttm(k+1); prev > 0 && cur < prev*(1-divCutBand) {
			m.Cuts3y++
		}
	}

	// 주기 · 빠진 회차
	var last12 []DivPerShare
	for _, e := range reg {
		if e.Date.After(asOf.AddDate(-1, 0, 0)) {
			last12 = append(last12, e)
		}
	}
	m.Payments12m = len(last12)
	m.Cycle = divCycleOf(m.Payments12m)
	lastDate := reg[len(reg)-1].Date
	m.LastPayment = lastDate.In(kst).Format(dateLayout)
	if m.Payments12m > 0 && m.Cycle != "불규칙" {
		interval := 365.0 / float64(m.Payments12m)
		since := asOf.Sub(lastDate).Hours() / 24
		m.MissedNow = since > interval*1.6+20
		next := lastDate.AddDate(0, 0, int(math.Round(interval)))
		for !next.After(asOf) {
			next = next.AddDate(0, 0, int(math.Round(interval)))
		}
		if !m.MissedNow {
			m.NextExpected = next.In(kst).Format(dateLayout)
		}
	} else if m.Payments12m == 0 {
		m.MissedNow = true // 최근 12개월 배당 없음 (2년 안에는 있었음)
	}
	// 최근 3년 회차 간격 중 중앙값의 1.7배를 넘는 간격 = 빠진 회차
	var gaps []float64
	var window []DivPerShare
	for _, e := range reg {
		if e.Date.After(asOf.AddDate(-3, 0, 0)) {
			window = append(window, e)
		}
	}
	for i := 1; i < len(window); i++ {
		gaps = append(gaps, window[i].Date.Sub(window[i-1].Date).Hours()/24)
	}
	if len(gaps) >= 3 {
		sorted := append([]float64(nil), gaps...)
		sort.Float64s(sorted)
		med := sorted[len(sorted)/2]
		for _, g := range gaps {
			if med > 0 && g > med*1.7 {
				m.Missed3y += int(math.Round(g/med)) - 1
			}
		}
	}
	// 회차별 금액 변동 (최근 2년)
	var amts []float64
	for _, e := range reg {
		if e.Date.After(asOf.AddDate(-2, 0, 0)) {
			amts = append(amts, e.Amount)
		}
	}
	if len(amts) >= 3 {
		mean, sq := 0.0, 0.0
		for _, a := range amts {
			mean += a
		}
		mean /= float64(len(amts))
		for _, a := range amts {
			sq += (a - mean) * (a - mean)
		}
		if mean > 0 {
			m.CV = fptr(math.Sqrt(sq/float64(len(amts)-1)) / mean)
		}
	}

	// 가격: asOf 이하 종가
	var px []PricePoint
	for _, p := range closes {
		if p.Close > 0 && finite(p.Close) && p.Time <= asOf.Unix() {
			px = append(px, p)
		}
	}
	sort.Slice(px, func(i, j int) bool { return px[i].Time < px[j].Time })
	if n := len(px); n > 0 && asOf.Unix()-px[n-1].Time <= 10*86400 {
		price := px[n-1].Close
		m.Price = price
		if m.TTM > 0 {
			m.YieldPct = fptr(m.TTM / price * 100)
		}
		if yc := YieldCompressionOf(reg, px, price, asOf); yc.OK {
			m.AvgYieldPct = fptr(yc.AvgPct)
		}
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, p := range px {
			if p.Time > asOf.AddDate(-1, 0, 0).Unix() {
				lo, hi = math.Min(lo, p.Close), math.Max(hi, p.Close)
			}
		}
		if hi > lo {
			m.Pos52 = fptr((price - lo) / (hi - lo))
		}
		if n >= 200 {
			sum := 0.0
			for _, p := range px[n-200:] {
				sum += p.Close
			}
			m.MAGapPct = fptr((price/(sum/200) - 1) * 100)
		}
	}

	// 상태
	switch {
	case m.MissedNow:
		m.Status = divStatusMissed
	case m.Growth1y == nil:
		m.Status = divStatusNew
	case *m.Growth1y >= divChangeBand*100:
		m.Status = divStatusUp
	case *m.Growth1y <= -divChangeBand*100:
		m.Status = divStatusDown
	default:
		m.Status = divStatusFlat
	}

	// ── 항목 점수 ──
	growthCurve := [][2]float64{{-10, 0}, {0, 0.3}, {5, 0.6}, {10, 0.85}, {15, 1}}
	// 배당수익률이 낮으면 성장 점수를 줄인다 (0.3% 배당을 25배 올린 것보다 3% 배당을 꾸준히 올리는 쪽이 배당 투자에 맞다)
	yieldFactor := 0.8
	if m.YieldPct != nil {
		yieldFactor = piecewise(*m.YieldPct, [][2]float64{{0, 0.3}, {1, 0.6}, {2, 1}})
	}
	switch {
	case m.Cagr3y != nil && m.Growth1y != nil:
		parts.Growth = (0.6*piecewise(*m.Cagr3y, growthCurve) + 0.4*piecewise(*m.Growth1y, growthCurve)) * yieldFactor
	case m.Growth1y != nil:
		parts.Growth = 0.9 * piecewise(*m.Growth1y, growthCurve) * yieldFactor
	default:
		parts.Growth = 0.3 // 이력 부족
	}

	cuts := map[int]float64{0: 1, 1: 0.4}[m.Cuts3y]
	cvScore := 0.5
	if m.CV != nil {
		cvScore = piecewise(*m.CV, [][2]float64{{0.1, 1}, {0.5, 0}})
	}
	parts.Stability = 0.5*float64(min(m.NoCutYears, 4))/4 + 0.3*cuts + 0.2*cvScore

	yieldLevel := 0.0
	if m.YieldPct != nil {
		yieldLevel = piecewise(*m.YieldPct, [][2]float64{{0, 0}, {2, 0.4}, {4, 0.8}, {6, 1}})
	}
	// 평균 대비는 주가가 싸졌는지를 보려는 것 — 배당 자체가 크게 바뀐 해에는 그 변화가 섞이므로 중간값
	vsAvg := 0.5
	bigChange := m.Growth1y != nil && math.Abs(*m.Growth1y) > 30
	if m.YieldPct != nil && m.AvgYieldPct != nil && *m.AvgYieldPct > 0 && !bigChange {
		vsAvg = piecewise(*m.YieldPct / *m.AvgYieldPct, [][2]float64{{0.8, 0}, {1, 0.5}, {1.2, 1}})
	}
	parts.Yield = 0.7*yieldLevel + 0.3*vsAvg

	missed := map[int]float64{0: 1, 1: 0.5}[m.Missed3y]
	parts.Consistency = 0.5*divCycleScore[m.Cycle] + 0.5*missed
	if m.MissedNow {
		parts.Consistency *= 0.5
	}

	pos, ma := 0.5, 0.5
	if m.Pos52 != nil {
		pos = piecewise(*m.Pos52, [][2]float64{{0, 1}, {0.5, 0.6}, {1, 0.2}})
	}
	if m.MAGapPct != nil {
		ma = piecewise(*m.MAGapPct, [][2]float64{{-15, 1}, {0, 0.5}, {15, 0}})
	}
	parts.Value = 0.6*pos + 0.4*ma
	return m, parts, true
}

// DivScoreWeights 는 배점 (합이 100 이 아니어도 비율로 쓴다)
type DivScoreWeights struct {
	Growth, Stability, Yield, Consistency, Value float64
}

// total: 항목 점수 × 배점 ÷ 배점 합 × 100 (0~100)
func (w DivScoreWeights) total(p DivScoreParts) float64 {
	sum := w.Growth + w.Stability + w.Yield + w.Consistency + w.Value
	if sum <= 0 {
		return 0
	}
	return (p.Growth*w.Growth + p.Stability*w.Stability + p.Yield*w.Yield + p.Consistency*w.Consistency + p.Value*w.Value) / sum * 100
}
