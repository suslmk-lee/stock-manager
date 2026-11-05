package services

import (
	"math"
	"sort"
	"time"
)

// 배당수익률 압축(④)과 변동성 대비 이평 괴리(⑤)에 쓰는 순수 계산 모음.

const (
	yieldMonths          = 24 // 평균 수익률을 구하는 월말 개수
	yieldMinPoints       = 6  // 평균을 신뢰하려면 필요한 월말 지점 수
	yieldHistoryTolDays  = 45 // 첫 배당일보다 이만큼 앞선 구간까지는 이력으로 인정
	yieldPriceMaxGapDays = 10 // 월말 종가는 월말 이전 이 기간 안의 값이어야 한다

	volWindow     = 252 // 변동성에 쓰는 최근 종가 수
	volMinReturns = 120 // 필요한 최소 일간 수익률 개수
)

// DividendPerShareEvents 는 사용자 배당 기록을 (지급 당시 보유 수량으로 나눠) 주당 배당 이벤트로 바꾼다.
// 같은 KST 일자에 여러 계좌로 지급된 배당은 하나의 이벤트(Σ금액 / Σ수량)로 취급한다 (DividendTrendOf 와 동일).
func DividendPerShareEvents(divs []DivEvent, qtyAt func(uint, time.Time) float64, now time.Time) []DivPerShare {
	type group struct {
		date   time.Time
		amount float64
		qty    float64
		accts  map[uint]bool
	}
	groups := map[string]*group{}
	for _, d := range divs {
		if d.Date.After(now) {
			continue
		}
		q := qtyAt(d.AccountID, d.Date)
		if q <= 0 {
			continue
		}
		key := d.Date.In(kst).Format("2006-01-02")
		g := groups[key]
		if g == nil {
			g = &group{date: d.Date, accts: map[uint]bool{}}
			groups[key] = g
		}
		g.amount += d.Amount
		if !g.accts[d.AccountID] {
			g.accts[d.AccountID] = true
			g.qty += q
		}
	}
	out := make([]DivPerShare, 0, len(groups))
	for _, g := range groups {
		out = append(out, DivPerShare{Date: g.date, Amount: g.amount / g.qty})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date.Before(out[j].Date) })
	return out
}

// DivPerShare 는 주당 배당 1건(세전, 종목 통화)이다.
type DivPerShare struct {
	Date   time.Time
	Amount float64
}

// YieldCompression 은 현재 배당수익률과 최근 24개월 평균 수익률의 비교 결과다.
type YieldCompression struct {
	AvgPct     float64 // 월말 수익률 평균 (%)
	CurrentPct float64 // 현재 trailing 12개월 수익률 (%)
	VsAvgPct   float64 // (현재/평균 − 1) × 100, 음수 = 압축
	Points     int     // 평균에 쓴 월말 지점 수
	OK         bool    // Points >= yieldMinPoints 이고 평균 > 0
}

// dps12Between 은 (end−12개월, end] 구간 주당 배당 합이다.
func dps12Between(events []DivPerShare, end time.Time) float64 {
	start := end.AddDate(-1, 0, 0)
	sum := 0.0
	for _, e := range events {
		if e.Date.After(start) && !e.Date.After(end) {
			sum += e.Amount
		}
	}
	return sum
}

// YieldCompressionOf 는 최근 24개월 월말마다 (12개월 주당배당 ÷ 월말 종가) 수익률을 구해 평균내고,
// 현재 수익률(trailing 12개월 배당 ÷ 현재가)과 비교한다. 순수 함수다.
//   - 월말 M 의 12개월 창이 첫 배당일(−45일)보다 앞서 시작하면 이력 부족으로 건너뛴다.
//   - 월말 종가는 M 이전 10일 안의 마지막 종가여야 하며, 둘 다 > 0 일 때만 지점으로 센다.
func YieldCompressionOf(events []DivPerShare, closes []PricePoint, curPrice float64, now time.Time) YieldCompression {
	var yc YieldCompression
	if len(events) == 0 || len(closes) == 0 || !finite(curPrice) || curPrice <= 0 {
		return yc
	}
	first := events[0].Date
	for _, e := range events {
		if e.Date.Before(first) {
			first = e.Date
		}
	}
	valid := make([]PricePoint, 0, len(closes))
	for _, p := range closes {
		if p.Close > 0 && finite(p.Close) {
			valid = append(valid, p)
		}
	}
	sort.Slice(valid, func(i, j int) bool { return valid[i].Time < valid[j].Time })
	if len(valid) == 0 {
		return yc
	}
	tol := time.Duration(yieldHistoryTolDays) * 24 * time.Hour
	nk := now.In(kst)
	var sum float64
	for k := 0; k < yieldMonths; k++ {
		// k=0 은 직전 달 말일, k=23 은 24개월 전 말일 (KST 23:59:59)
		m := time.Date(nk.Year(), nk.Month()-time.Month(k), 1, 0, 0, 0, 0, kst).Add(-time.Second)
		if m.After(now) {
			continue
		}
		if m.AddDate(-1, 0, 0).Before(first.Add(-tol)) {
			continue // 12개월 창이 배당 이력보다 앞선다
		}
		// m 이하의 마지막 종가
		idx := sort.Search(len(valid), func(i int) bool { return valid[i].Time > m.Unix() }) - 1
		if idx < 0 || m.Unix()-valid[idx].Time > int64(yieldPriceMaxGapDays)*86400 {
			continue
		}
		price := valid[idx].Close
		dps := dps12Between(events, m)
		if dps <= 0 || price <= 0 {
			continue
		}
		sum += dps / price * 100
		yc.Points++
	}
	if yc.Points == 0 {
		return yc
	}
	yc.AvgPct = sum / float64(yc.Points)
	yc.CurrentPct = dps12Between(events, now) / curPrice * 100
	if yc.Points >= yieldMinPoints && yc.AvgPct > 0 {
		yc.OK = true
		yc.VsAvgPct = (yc.CurrentPct/yc.AvgPct - 1) * 100
	}
	return yc
}

// computeYieldMetrics 는 배당수익률 압축 지표를 item 에 채운다.
// 시장(Yahoo) 배당 이벤트를 우선 쓰고, 없으면 사용자 배당 기록(당시 보유 수량으로 나눈 주당 배당)으로 대체한다.
func computeYieldMetrics(item *SignalItem, in SignalAssetInput, qtyAt func(uint, time.Time) float64, now time.Time) {
	var events []DivPerShare
	source := ""
	if len(in.DivEvents) > 0 {
		for _, e := range in.DivEvents {
			events = append(events, DivPerShare{Date: time.Unix(e.Time, 0), Amount: e.Amount})
		}
		source = "market"
	} else if len(in.Dividends) > 0 {
		recs := make([]DivEvent, 0, len(in.Dividends))
		for _, d := range in.Dividends {
			recs = append(recs, DivEvent{AccountID: d.AccountID, Date: d.Date, Amount: d.Amount})
		}
		events = DividendPerShareEvents(recs, qtyAt, now)
		source = "records"
	}
	if len(events) == 0 {
		return
	}
	yc := YieldCompressionOf(events, in.History, in.Price, now)
	if yc.Points == 0 {
		return
	}
	item.DividendYieldSource = source
	item.DividendYieldPoints = yc.Points
	item.DividendYieldAvgPct = yc.AvgPct
	if yc.OK {
		item.DividendYieldVsAvgPct = yc.VsAvgPct
	}
}

// AnnualVolatility 는 최근 252개 종가의 일간 로그수익률 표본표준편차 × √252 (소수, 0.234 = 23.4%)를 구한다.
// 수익률이 120개 미만이거나 계산 불가면 0, false.
func AnnualVolatility(points []PricePoint, now time.Time) (float64, bool) {
	valid := make([]PricePoint, 0, len(points))
	for _, p := range points {
		if p.Close > 0 && finite(p.Close) && p.Time <= now.Unix() {
			valid = append(valid, p)
		}
	}
	sort.Slice(valid, func(i, j int) bool { return valid[i].Time < valid[j].Time })
	if len(valid) > volWindow {
		valid = valid[len(valid)-volWindow:]
	}
	n := len(valid) - 1
	if n < volMinReturns {
		return 0, false
	}
	rets := make([]float64, 0, n)
	var mean float64
	for i := 1; i < len(valid); i++ {
		r := math.Log(valid[i].Close / valid[i-1].Close)
		rets = append(rets, r)
		mean += r
	}
	mean /= float64(n)
	var ss float64
	for _, r := range rets {
		ss += (r - mean) * (r - mean)
	}
	vol := math.Sqrt(ss/float64(n-1)) * math.Sqrt(252)
	if !finite(vol) || vol <= 0 {
		return 0, false
	}
	return vol, true
}

// computeVolMetrics 는 연변동성(%)과 변동성 대비 200일 이평 괴리(σ)를 item 에 채운다.
func computeVolMetrics(item *SignalItem, in SignalAssetInput, now time.Time) {
	if len(in.History) == 0 || item.MA200 <= 0 {
		return
	}
	vol, ok := AnnualVolatility(in.History, now)
	if !ok {
		return
	}
	item.VolatilityPct = vol * 100
	item.MA200Sigma = (in.Price/item.MA200 - 1) / vol
}
