package services

import (
	"math"
	"sort"
	"time"
)

// RSI / MFI 오실레이터 순수 계산 모음.
// 입력은 오늘 실시간 가격이 아닌 일봉 이력(시간 오름차순)이며, 이력의 마지막 봉이 "현재" 값이다.

const (
	defaultRsiPeriod       = 14
	defaultMfiPeriod       = 14
	defaultOscLookbackDays = 10
	oscMaxPeriod           = 50
	oscMaxLookback         = 60
)

// RSISeries 는 Wilder RSI 를 계산한다. closes[period:] 각 시점의 값을 돌려주며(길이 n-period),
// 종가가 period+1 개 미만이면 nil 이다. 처음 period 개 변화량의 단순평균으로 시작해 Wilder 평활을 쓴다.
// 평균 하락이 0 이면 100, 상승·하락이 모두 0 이면 50 이다.
func RSISeries(closes []float64, period int) []float64 {
	n := len(closes)
	if period < 1 || n <= period {
		return nil
	}
	var gain, loss float64
	for i := 1; i <= period; i++ {
		d := closes[i] - closes[i-1]
		if d > 0 {
			gain += d
		} else {
			loss -= d
		}
	}
	avgG, avgL := gain/float64(period), loss/float64(period)
	rsi := func() float64 {
		switch {
		case avgL == 0 && avgG == 0:
			return 50
		case avgL == 0:
			return 100
		}
		return 100 - 100/(1+avgG/avgL)
	}
	out := make([]float64, 0, n-period)
	out = append(out, rsi())
	for i := period + 1; i < n; i++ {
		d := closes[i] - closes[i-1]
		g, l := 0.0, 0.0
		if d > 0 {
			g = d
		} else {
			l = -d
		}
		avgG = (avgG*float64(period-1) + g) / float64(period)
		avgL = (avgL*float64(period-1) + l) / float64(period)
		out = append(out, rsi())
	}
	return out
}

// MFISeries 는 MFI(자금흐름지수)를 계산한다. 전형가격 (고+저+종)/3 × 거래량이 원자금흐름이고,
// 전형가격이 전봉보다 오르면 양(+), 내리면 음(-) 흐름이다. 최근 period 개 흐름의 합으로
// 100 − 100/(1+양/음) 을 구한다. 돌려주는 값은 pts[period:] 각 시점이며(길이 n-period),
// 창 안의 자금흐름 합이 0(거래량 없음)이면 그 시점은 NaN(계산 불가)이다.
func MFISeries(pts []PricePoint, period int) []float64 {
	n := len(pts)
	if period < 1 || n <= period {
		return nil
	}
	tp := make([]float64, n)
	for i, p := range pts {
		tp[i] = (p.High + p.Low + p.Close) / 3
	}
	out := make([]float64, 0, n-period)
	for i := period; i < n; i++ {
		var pos, neg float64
		for j := i - period + 1; j <= i; j++ {
			flow := tp[j] * pts[j].Volume
			switch {
			case tp[j] > tp[j-1]:
				pos += flow
			case tp[j] < tp[j-1]:
				neg += flow
			}
		}
		switch {
		case pos == 0 && neg == 0:
			out = append(out, math.NaN())
		case neg == 0:
			out = append(out, 100)
		default:
			out = append(out, 100-100/(1+pos/neg))
		}
	}
	return out
}

// OscStats 는 시리즈의 마지막 값(현재)과 마지막 lookback 개 중 최솟값이다.
// 마지막 값이 NaN 이거나 시리즈가 비어 있으면 ok=false 다. 창 안의 NaN 은 최솟값에서 제외한다.
func OscStats(series []float64, lookback int) (cur, min float64, ok bool) {
	if len(series) == 0 {
		return 0, 0, false
	}
	cur = series[len(series)-1]
	if math.IsNaN(cur) || math.IsInf(cur, 0) {
		return 0, 0, false
	}
	if lookback < 1 {
		lookback = defaultOscLookbackDays
	}
	start := len(series) - lookback
	if start < 0 {
		start = 0
	}
	min = cur
	for _, v := range series[start:] {
		if !math.IsNaN(v) && !math.IsInf(v, 0) && v < min {
			min = v
		}
	}
	return cur, min, true
}

// RSIOf 는 이력 종가(now 이하, 시간 오름차순)로 RSI 현재값과 lookback 구간 최솟값을 구한다.
func RSIOf(points []PricePoint, period, lookback int, now time.Time) (cur, min float64, ok bool) {
	if period < 1 {
		period = defaultRsiPeriod
	}
	return OscStats(RSISeries(validCloses(points, now), period), lookback)
}

// MFIOf 는 고가·저가·종가·거래량이 모두 있는 봉만으로 MFI 현재값과 lookback 구간 최솟값을 구한다.
// 거래량이 없거나 0 이면 계산 불가(ok=false)다.
func MFIOf(points []PricePoint, period, lookback int, now time.Time) (cur, min float64, ok bool) {
	if period < 1 {
		period = defaultMfiPeriod
	}
	valid := make([]PricePoint, 0, len(points))
	for _, p := range points {
		if p.Close > 0 && p.High > 0 && p.Low > 0 && p.Volume > 0 && finite(p.Close) && p.Time <= now.Unix() {
			valid = append(valid, p)
		}
	}
	sort.Slice(valid, func(i, j int) bool { return valid[i].Time < valid[j].Time })
	return OscStats(MFISeries(valid, period), lookback)
}

// computeOscMetrics 는 RSI/MFI 지표를 item 에 채운다 (규칙이 꺼져 있어도 채운다).
// 이력의 마지막 종가를 "현재"로 쓰며 오늘 실시간 가격은 쓰지 않는다. 기간은 규칙 값, 없으면 14/14/10 이다.
func computeOscMetrics(item *SignalItem, in SignalAssetInput, now time.Time) {
	if len(in.History) == 0 {
		return
	}
	r := in.Rule
	rp, mp, lb := r.RsiPeriod, r.MfiPeriod, r.OscLookbackDays
	if rp <= 0 {
		rp = defaultRsiPeriod
	}
	if mp <= 0 {
		mp = defaultMfiPeriod
	}
	if lb <= 0 {
		lb = defaultOscLookbackDays
	}
	if cur, min, ok := RSIOf(in.History, rp, lb, now); ok {
		item.RSI, item.RSIMin = cur, min
	}
	if cur, min, ok := MFIOf(in.History, mp, lb, now); ok {
		item.MFI, item.MFIMin = cur, min
	}
}

// oscReboundMet 은 "과매도 반등" 판정이다: 최근 구간 최솟값이 기준 이하였고 현재는 기준을 넘었다.
func oscReboundMet(cur, min, level float64) bool {
	return cur > 0 && min <= level && cur > level
}
