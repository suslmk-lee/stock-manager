package services

import (
	"math"
	"testing"
	"time"
)

// 매일 종가: from 부터 to 까지 f(경과 일수)
func dsCloses(from, to time.Time, f func(day int) float64) []PricePoint {
	var out []PricePoint
	for d, i := from, 0; !d.After(to); d, i = d.AddDate(0, 0, 1), i+1 {
		out = append(out, PricePoint{Time: d.Unix(), Close: f(i)})
	}
	return out
}

// 주가 성장: 꾸준히 오른 종목 > 제자리 > 빠지는 종목, 시세가 1년이 안 되면 중간 아래(0.3)
func TestDivScorePriceGrowth(t *testing.T) {
	asOf := dsDay("2026-11-13").Add(12 * time.Hour)
	events := quarterly(dsDay("2022-12-10"), 16, 1.0, 0.05)
	from := dsDay("2022-01-03")

	// 해마다 12%씩 매끄럽게 오름
	rise := dsCloses(from, asOf, func(d int) float64 { return 100 * math.Pow(1.12, float64(d)/365.25) })
	mr, pr, _ := computeDivScore(events, rise, asOf, "market")
	if mr.PriceCagr3y == nil || math.Abs(*mr.PriceCagr3y-12) > 0.3 || mr.UpMonths == nil || *mr.UpMonths != 1 || mr.UpMonthsN < 24 ||
		mr.MaxDrawdown == nil || *mr.MaxDrawdown != 0 || mr.PriceYears != 3 {
		t.Fatalf("상승 지표 = %+v", mr)
	}
	if pr.PriceGrowth < 0.9 {
		t.Fatalf("꾸준히 오른 종목은 높아야 한다: %v", pr.PriceGrowth)
	}

	// 제자리 (오른 달 없음, 낙폭 없음)
	_, pf, _ := computeDivScore(events, dsFlatCloses(from, asOf, 100), asOf, "market")
	// 해마다 8%씩 빠짐
	fall := dsCloses(from, asOf, func(d int) float64 { return 100 * math.Pow(0.92, float64(d)/365.25) })
	mfall, pd, _ := computeDivScore(events, fall, asOf, "market")
	if !(pr.PriceGrowth > pf.PriceGrowth && pf.PriceGrowth > pd.PriceGrowth) || pd.PriceGrowth > 0.2 {
		t.Fatalf("상승 %v > 제자리 %v > 하락 %v 이어야 한다 (%+v)", pr.PriceGrowth, pf.PriceGrowth, pd.PriceGrowth, mfall)
	}
	if mfall.MaxDrawdown == nil || *mfall.MaxDrawdown > -20 || *mfall.UpMonths != 0 {
		t.Fatalf("하락 지표 = %+v", mfall)
	}

	// 2년 오르다 최근 1년 빠짐 → 꾸준히 오른 종목보다 낮다 (최근 1년·낙폭이 반영)
	turn := dsCloses(from, asOf, func(d int) float64 {
		peakDay := int(asOf.AddDate(-1, 0, 0).Sub(from).Hours() / 24)
		if d <= peakDay {
			return 100 * math.Pow(1.12, float64(d)/365.25)
		}
		return 100 * math.Pow(1.12, float64(peakDay)/365.25) * math.Pow(0.9, float64(d-peakDay)/365.25)
	})
	mt, pt, _ := computeDivScore(events, turn, asOf, "market")
	if mt.PriceChg1y == nil || *mt.PriceChg1y > -9 || pt.PriceGrowth >= pr.PriceGrowth-0.2 {
		t.Fatalf("최근 1년 빠진 종목 = %v (꾸준히 오른 종목 %v) %+v", pt.PriceGrowth, pr.PriceGrowth, mt)
	}

	// 시세 8개월 → 계산하지 않고 0.3
	short := dsCloses(asOf.AddDate(0, -8, 0), asOf, func(d int) float64 { return 50 + float64(d)*0.1 })
	ms, ps, _ := computeDivScore(events, short, asOf, "market")
	if ms.PriceCagr3y != nil || ps.PriceGrowth != 0.3 {
		t.Fatalf("시세가 짧으면 중간 아래 = %v %+v", ps.PriceGrowth, ms)
	}
}
