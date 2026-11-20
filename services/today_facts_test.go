package services

import (
	"testing"
	"time"

	"stock-manager/models"
)

func TestMarketIndex(t *testing.T) {
	for tk, want := range map[string]string{"000270.KS": "^KS11", "028300.KQ": "^KQ11", "NVDA": "^GSPC", "7203.T": "", "FUND:XZU9SMKB": ""} {
		if got, _ := marketIndex(tk); got != want {
			t.Errorf("%s → %q, want %q", tk, got, want)
		}
	}
}

// 하루 −7% 넘게, 그날 지수보다 5%p 넘게 더 빠진 날만 (가장 크게 빠진 날 하나). 시장과 같이 빠진 날·63거래일 전은 뺀다.
func TestBigDropFact(t *testing.T) {
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	stock := &PriceHistory{}
	index := &PriceHistory{}
	price, lvl := 100.0, 1000.0
	for d := 0; d < 120; d++ {
		ts := start.AddDate(0, 0, d).Unix()
		switch d {
		case 30: // 63거래일보다 전 — 안 셈
			price *= 0.80
		case 90: // 시장과 같이 −8% (지수 −6%) — 지수보다 2%p 만 더 빠짐
			price *= 0.92
			lvl *= 0.94
		case 100: // 실적 충격: −11.7%, 지수 −3.5%
			price *= 0.883
			lvl *= 0.965
		case 110: // −7.5%, 지수 +0.5% (덜 빠짐)
			price *= 0.925
			lvl *= 1.005
		}
		stock.Points = append(stock.Points, PricePoint{Time: ts, Close: price})
		index.Points = append(index.Points, PricePoint{Time: ts, Close: lvl})
	}
	if got := bigDropFact(stock, index, "코스피"); got != "9/9 하루 -11.7% (그날 코스피 -3.5%)" {
		t.Fatalf("got %q", got)
	}
	// 지수 이력이 없으면 비교할 수 없어 안 보여 줌
	if got := bigDropFact(stock, &PriceHistory{}, "코스피"); got != "" {
		t.Fatalf("no index → %q", got)
	}
}

func TestValuationFact(t *testing.T) {
	if got := valuationFact(nil); got != "" {
		t.Fatalf("empty → %q", got)
	}
	// 기아: PER 4.88 · PBR 0.53 · 추정 EPS 17,800 / 지난 EPS 18,004
	kia := []models.FundamentalSnapshot{{Date: "2026-11-20", PER: 4.88, PBR: 0.53, EPS: 18004, ForwardEPS: 17800}}
	if got := valuationFact(kia); got != "PER 4.9 · PBR 0.53 · 추정 EPS 지난 실적보다 -1%" {
		t.Fatalf("got %q", got)
	}
	// 두 달 넘게 쌓이면 그동안 바뀐 추정 (두 달이 안 된 기록은 비교에 안 씀)
	hist := []models.FundamentalSnapshot{
		{Date: "2026-08-20", ForwardEPS: 20000},
		{Date: "2026-09-25", ForwardEPS: 19000},
		{Date: "2026-11-20", PER: 4.88, EPS: 18004, ForwardEPS: 17800},
	}
	if got := valuationFact(hist); got != "PER 4.9 · 추정 EPS 지난 실적보다 -1% · 3달 새 추정 EPS -11%" {
		t.Fatalf("got %q", got)
	}
	// 적자(EPS ≤ 0)·ETF 처럼 값이 없으면 있는 것만
	if got := valuationFact([]models.FundamentalSnapshot{{Date: "2026-11-20", PBR: 1.2, EPS: -50, ForwardEPS: 10}}); got != "PBR 1.20" {
		t.Fatalf("got %q", got)
	}
}
