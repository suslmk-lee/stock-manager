package services

import "time"

// 장기 이평 하회 후 반등 / 200일선 회복 / 52주 고점 대비 하락 후 반등에 쓰는 순수 계산 모음.
// 입력 종가는 오늘 실시간 가격을 제외한 일봉 종가(시간 오름차순)이고, price 는 오늘 현재가다.

const (
	defaultBelowMALookbackDays   = 60
	defaultBelowMAMaxAbovePct    = 3
	defaultBelowMAReclaimDays    = 10
	defaultFromHighLookbackDays  = 60
	defaultFromHighReboundPct    = 5
	defaultFromHighStillBelowPct = -10

	trendMAWindow   = 200 // 장기 이평 종가 개수
	trendMA20Window = 20  // 단기 이평 종가 개수
	trendMA20Gap    = 5   // 단기 이평 상승 비교 간격(종가 개수)
	trendHighWindow = 252 // 52주 고점 롤링 종가 개수
)

// 규칙의 모드 값. 빈 값(검증 전 설정)은 엔진에서 레거시 "below" 로 취급한다.
const (
	trendModeBelow   = "below"
	trendModeRebound = "rebound"
	trendModeReclaim = "reclaim"
)

// TrendMetrics 는 하회 후 반등 판단에 쓰는 지표다. *OK 가 false 면 해당 지표는 계산 불가(0)다.
type TrendMetrics struct {
	// 200일 이평 (종가 200개 이상 필요)
	Price        float64 // 계산에 쓴 오늘 현재가
	MAOK         bool
	MinDevPct    float64 // 최근 lookback 개 종가의 (종가/해당 시점 MA200 − 1)×100 최솟값
	MA20         float64 // 마지막 20개 종가 평균 (오늘 현재가 제외)
	MA20Rising   bool    // MA20 > 종가 5개 전 시점의 MA20
	ReclaimDays  int     // 가장 최근 MA200 상향 돌파 이후 종가 개수 (현재 MA200 이하이거나 돌파 없음이면 0)
	PriceAboveMA bool    // 현재가 > 현재 MA200 (마지막 200개 종가 평균)

	// 52주 고점 대비
	HighOK     bool
	DeepestPct float64 // 최근 lookback 개 종가의 (종가/롤링 252 종가 고점 − 1)×100 최솟값
	LowSince   float64 // 최근 lookback 개 종가 최저가
	FromLowPct float64 // (현재가/LowSince − 1)×100
}

// TrendOf 는 종가 이력과 현재가로 하회 후 반등 지표를 계산한다. 순수 함수다.
// maLookback/highLookback 이 1 미만이면 기본값(60)을 쓴다.
//   - MA20 은 오늘 현재가를 제외한 마지막 20개 종가 평균(item.ma20 과 같다)이고,
//     MA20Rising 은 이를 종가 5개 전 시점에 끝나는 20개 종가 평균과 비교한다.
//   - 52주 고점은 각 시점까지의 최근 252개 종가 최댓값이며, 이력이 모자라면 있는 만큼만 쓴다.
func TrendOf(closes []float64, price float64, maLookback, highLookback int) TrendMetrics {
	tm := TrendMetrics{Price: price}
	n := len(closes)
	if !finite(price) || price <= 0 || n == 0 {
		return tm
	}
	if maLookback < 1 {
		maLookback = defaultBelowMALookbackDays
	}
	if highLookback < 1 {
		highLookback = defaultFromHighLookbackDays
	}

	// 누적합 (ps[i] = closes[0..i-1] 합)
	ps := make([]float64, n+1)
	for i, c := range closes {
		ps[i+1] = ps[i] + c
	}
	avgEnding := func(end, w int) float64 { // 종가 인덱스 end(포함)로 끝나는 w개 평균
		return (ps[end+1] - ps[end+1-w]) / float64(w)
	}

	if n >= trendMAWindow {
		first := n - maLookback
		if first < trendMAWindow-1 {
			first = trendMAWindow - 1
		}
		minDev := 0.0
		lastBelow := -1
		for t := first; t < n; t++ {
			dev := (closes[t]/avgEnding(t, trendMAWindow) - 1) * 100
			if t == first || dev < minDev {
				minDev = dev
			}
		}
		for t := n - 1; t >= trendMAWindow-1; t-- {
			if closes[t] < avgEnding(t, trendMAWindow) {
				lastBelow = t
				break
			}
		}
		ma200 := avgEnding(n-1, trendMAWindow)
		tm.PriceAboveMA = price > ma200
		if tm.PriceAboveMA && lastBelow >= 0 {
			tm.ReclaimDays = n - lastBelow
		}
		tm.MinDevPct = minDev
		tm.MA20 = avgEnding(n-1, trendMA20Window)
		tm.MA20Rising = tm.MA20 > avgEnding(n-1-trendMA20Gap, trendMA20Window)
		tm.MAOK = true
	}

	if n >= reboundMAWindow {
		first := n - highLookback
		if first < 0 {
			first = 0
		}
		deepest, low := 0.0, 0.0
		for t := first; t < n; t++ {
			hs := t - trendHighWindow + 1
			if hs < 0 {
				hs = 0
			}
			hi := closes[hs]
			for _, c := range closes[hs : t+1] {
				if c > hi {
					hi = c
				}
			}
			dev := (closes[t]/hi - 1) * 100
			if t == first || dev < deepest {
				deepest = dev
			}
			if t == first || closes[t] < low {
				low = closes[t]
			}
		}
		tm.DeepestPct, tm.LowSince = deepest, low
		tm.FromLowPct = (price/low - 1) * 100
		tm.HighOK = true
	}
	return tm
}

// BelowMAMet 은 below_ma 매수 조건(rebound / reclaim 모드) 충족 여부다. "below" 모드는 엔진에서 직접 판단한다.
func BelowMAMet(tm TrendMetrics, mode string, price, vsMA200Pct, belowPct, maxAbovePct float64, reclaimDays int) bool {
	if !tm.MAOK || tm.MinDevPct > belowPct {
		return false
	}
	switch mode {
	case trendModeRebound:
		return price >= tm.MA20 && tm.MA20Rising && vsMA200Pct <= maxAbovePct
	case trendModeReclaim:
		return tm.PriceAboveMA && tm.ReclaimDays >= 1 && tm.ReclaimDays <= reclaimDays
	}
	return false
}

// FromHighReboundMet 은 from_high 매수 조건(rebound 모드) 충족 여부다.
func FromHighReboundMet(tm TrendMetrics, price, fromHighPct, fromHighCur, reboundPct, stillBelowPct float64) bool {
	return tm.HighOK && tm.DeepestPct <= fromHighPct &&
		price >= tm.LowSince*(1+reboundPct/100) && fromHighCur <= stillBelowPct
}

// computeTrendMetrics 는 하회 후 반등 지표를 item 에 채운다 (규칙이 꺼져 있어도 채운다).
func computeTrendMetrics(item *SignalItem, in SignalAssetInput, now time.Time) {
	if len(in.History) == 0 {
		return
	}
	r := in.Rule
	maLb, hiLb := r.BelowMALookbackDays, r.FromHighLookbackDays
	if maLb <= 0 {
		maLb = defaultBelowMALookbackDays
	}
	if hiLb <= 0 {
		hiLb = defaultFromHighLookbackDays
	}
	tm := TrendOf(validCloses(in.History, now), in.Price, maLb, hiLb)
	item.trend = tm
	if tm.MAOK {
		item.MA200MinDevPct, item.MA20Rising, item.MA200ReclaimDaysAgo = tm.MinDevPct, tm.MA20Rising, tm.ReclaimDays
	}
	if tm.HighOK {
		item.FromHighDeepestPct, item.FromLowReboundPct = tm.DeepestPct, tm.FromLowPct
	}
}
