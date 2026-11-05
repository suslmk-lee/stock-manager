package services

import (
	"sort"
	"time"
)

// 단기 가격 흐름(반등 확인, 단기 급락)에 쓰는 순수 계산 모음.

const (
	reboundMAWindow  = 20 // 반등 확인에 쓰는 단기 이평 종가 개수
	reboundMinCloses = 5  // 반등 계산에 필요한 최소 종가 개수 (규칙의 최소 조회 기간과 같다)
)

// validCloses 는 now 이하 시각의 유효한 종가를 시간 오름차순으로 돌려준다.
func validCloses(points []PricePoint, now time.Time) []float64 {
	valid := make([]PricePoint, 0, len(points))
	for _, p := range points {
		if p.Close > 0 && finite(p.Close) && p.Time <= now.Unix() {
			valid = append(valid, p)
		}
	}
	sort.Slice(valid, func(i, j int) bool { return valid[i].Time < valid[j].Time })
	out := make([]float64, len(valid))
	for i, p := range valid {
		out[i] = p.Close
	}
	return out
}

// Rebound 는 최근 저점 대비 현재가 위치와 20일 이평이다.
type Rebound struct {
	RecentLow  float64 // 최근 lookback 개 종가의 최저가 (오늘 실시간 가격 제외)
	FromLowPct float64 // (현재가/최저가 − 1) × 100
	MA20       float64 // 최근 20개 종가 평균 (20개 미만이면 0)
	OK         bool    // 종가가 reboundMinCloses 개 이상이고 현재가 > 0
}

// ReboundOf 는 이력 종가의 마지막 lookback 개 중 최저가와 비교한 반등 폭과 마지막 20개 종가 평균을 구한다.
// 종가가 lookback 개보다 적으면 있는 만큼만 쓴다. 순수 함수다.
func ReboundOf(points []PricePoint, price float64, lookback int, now time.Time) Rebound {
	var rb Rebound
	closes := validCloses(points, now)
	if len(closes) < reboundMinCloses || !finite(price) || price <= 0 || lookback < 1 {
		return rb
	}
	win := closes
	if len(win) > lookback {
		win = win[len(win)-lookback:]
	}
	low := win[0]
	for _, c := range win {
		if c < low {
			low = c
		}
	}
	rb.RecentLow = low
	rb.FromLowPct = (price/low - 1) * 100
	if len(closes) >= reboundMAWindow {
		var s float64
		for _, c := range closes[len(closes)-reboundMAWindow:] {
			s += c
		}
		rb.MA20 = s / reboundMAWindow
	}
	rb.OK = true
	return rb
}

// ReboundConfirmed 는 반등 확인 여부다: 저점 대비 반등 폭 이상이거나 (옵션) 현재가가 20일 이평 이상.
func ReboundConfirmed(rb Rebound, price, fromLowPct float64, maEnabled bool) bool {
	if !rb.OK {
		return false
	}
	return rb.FromLowPct >= fromLowPct || (maEnabled && rb.MA20 > 0 && price >= rb.MA20)
}

// ShortChangeOf 는 현재가와 N거래일 전 종가(이력의 len−N 번째, 오늘 실시간 가격 제외) 대비 변화율(%)이다.
// 이력이 N개 미만이면 계산 불가(false). 순수 함수다.
func ShortChangeOf(points []PricePoint, price float64, days int, now time.Time) (float64, bool) {
	closes := validCloses(points, now)
	if days < 1 || len(closes) < days || !finite(price) || price <= 0 {
		return 0, false
	}
	base := closes[len(closes)-days]
	return (price/base - 1) * 100, true
}

// computeShortTermMetrics 는 반등/단기 변화 지표를 item 에 채운다 (규칙이 꺼져 있어도 채운다).
// 조회 기간은 규칙 값을 쓰고, 없으면(0) 20 거래일을 쓴다.
func computeShortTermMetrics(item *SignalItem, in SignalAssetInput, now time.Time) {
	if len(in.History) == 0 {
		return
	}
	r := in.Rule
	lookback := r.ReboundLookbackDays
	if lookback <= 0 {
		lookback = defaultReboundLookbackDays
	}
	fromLow := r.ReboundFromLowPct
	if fromLow <= 0 {
		fromLow = defaultReboundFromLowPct
	}
	if rb := ReboundOf(in.History, in.Price, lookback, now); rb.OK {
		item.RecentLowPrice, item.FromRecentLowPct, item.MA20 = rb.RecentLow, rb.FromLowPct, rb.MA20
		item.ReboundLookbackDays = lookback
		item.ReboundConfirmed = ReboundConfirmed(rb, in.Price, fromLow, r.ReboundMAEnabled)
	}
	days := r.ShortDropDays
	if days <= 0 {
		days = defaultShortDropDays
	}
	if chg, ok := ShortChangeOf(in.History, in.Price, days, now); ok {
		item.ShortChangePct, item.ShortChangeDays = chg, days
	}
}
