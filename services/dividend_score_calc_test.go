package services

import (
	"fmt"
	"math"
	"testing"
	"time"
)

// 분기 배당 이벤트: start 부터 n 회, 해마다 growth 만큼 늘어난다
func quarterly(start time.Time, n int, first, growth float64) []DivPerShare {
	var out []DivPerShare
	for i := 0; i < n; i++ {
		year := i / 4
		out = append(out, DivPerShare{Date: start.AddDate(0, 3*i, 0), Amount: first * math.Pow(1+growth, float64(year))})
	}
	return out
}

// 매일 같은 가격 (주말 포함, 시험용)
func dsFlatCloses(from, to time.Time, price float64) []PricePoint {
	var out []PricePoint
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		out = append(out, PricePoint{Time: d.Unix(), Close: price})
	}
	return out
}

func dsDay(s string) time.Time {
	t, _ := time.ParseInLocation(dateLayout, s, kst)
	return t
}

// 해마다 10% 늘어난 분기 배당: 증가 상태, 성장률 ≈10%, 삭감 없음, 주기 분기, 다음 회차 예상
func TestDivScoreGrowingQuarterly(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	events := quarterly(dsDay("2021-12-15"), 20, 0.5, 0.10) // 2021-12 ~ 2026-09
	closes := dsFlatCloses(dsDay("2024-01-01"), asOf, 30)
	m, p, ok := computeDivScore(events, closes, asOf, "market")
	if !ok {
		t.Fatal("ok=false")
	}
	if m.Status != divStatusUp || m.Growth1y == nil || math.Abs(*m.Growth1y-10) > 0.5 || m.Cagr3y == nil || math.Abs(*m.Cagr3y-10) > 0.5 {
		t.Fatalf("growth = %+v", m)
	}
	if m.Cycle != "분기" || m.Payments12m != 4 || m.Cuts3y != 0 || m.NoCutYears < 3 || m.IncreaseYears < 3 || m.MissedNow || m.NextExpected == "" {
		t.Fatalf("stability = %+v", m)
	}
	if m.YieldPct == nil || m.AvgYieldPct == nil || m.Pos52 != nil {
		// 값이 변하지 않는 종가라 52주 위치는 계산하지 않는다 (최고 = 최저)
		t.Fatalf("yield = %+v", m)
	}
	if p.Growth < 0.8 || p.Stability < 0.8 {
		t.Fatalf("parts = %+v", p)
	}
	w := DivScoreWeights{30, 25, 20, 10, 15}
	if s := w.total(p); s <= 0 || s > 100 {
		t.Fatalf("total = %v", s)
	}
}

// 배당을 줄이면 감소, 한 회차를 건너뛰면 빠진 회차로 센다
func TestDivScoreCutAndMissed(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	events := quarterly(dsDay("2022-12-15"), 12, 1.0, 0) // 2022-12 ~ 2025-09, 매년 같음
	events = append(events,
		DivPerShare{Date: dsDay("2026-03-15"), Amount: 0.7}, // 2025-12 회차 건너뜀 + 삭감
		DivPerShare{Date: dsDay("2026-06-15"), Amount: 0.7},
		DivPerShare{Date: dsDay("2026-09-15"), Amount: 0.7},
	)
	m, p, ok := computeDivScore(events, nil, asOf, "market")
	if !ok {
		t.Fatal("ok=false")
	}
	if m.Status != divStatusDown || m.Cuts3y < 1 || m.Missed3y < 1 || m.NoCutYears != 0 {
		t.Fatalf("metrics = %+v (growth %v)", m, *m.Growth1y)
	}
	if p.Stability > 0.6 || p.Consistency > 0.75 {
		t.Fatalf("parts = %+v", p)
	}
}

// 주기보다 오래 배당이 없으면 누락
func TestDivScoreMissedNow(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	events := quarterly(dsDay("2023-03-15"), 11, 1.0, 0) // 마지막 2025-09-15 → 1년 넘게 없음
	m, _, ok := computeDivScore(events, nil, asOf, "market")
	if !ok || m.Status != divStatusMissed || !m.MissedNow || m.NextExpected != "" {
		t.Fatalf("ok %v metrics = %+v", ok, m)
	}
	// 2년 넘게 없으면 배당주로 보지 않는다
	if _, _, ok := computeDivScore(quarterly(dsDay("2020-01-15"), 8, 1, 0), nil, asOf, "market"); ok {
		t.Fatal("2년 넘게 배당이 없으면 ok=false")
	}
}

// 특별배당은 성장 계산에서 빼고 따로 센다
func TestDivScoreSpecialExcluded(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	events := quarterly(dsDay("2023-12-10"), 12, 1.0, 0)
	events = append(events, DivPerShare{Date: dsDay("2026-08-20"), Amount: 5}) // 특별배당
	sortDivs(events)
	m, _, _ := computeDivScore(events, nil, asOf, "market")
	if m.Specials12m != 1 || m.Growth1y == nil || math.Abs(*m.Growth1y) > 0.5 || m.Status != divStatusFlat {
		t.Fatalf("metrics = %+v", m)
	}
}

func sortDivs(e []DivPerShare) {
	for i := 1; i < len(e); i++ {
		for j := i; j > 0 && e[j].Date.Before(e[j-1].Date); j-- {
			e[j], e[j-1] = e[j-1], e[j]
		}
	}
}

// 이력이 2년이 안 되면 '신규', 성장 점수는 중간 아래
func TestDivScoreNewHistory(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	events := quarterly(dsDay("2025-12-15"), 4, 1.0, 0)
	m, p, ok := computeDivScore(events, nil, asOf, "records")
	if !ok || m.Status != divStatusNew || m.Growth1y != nil || p.Growth != 0.3 || m.Source != "records" {
		t.Fatalf("ok %v %+v %+v", ok, m, p)
	}
}

// 배점은 비율로 쓴다 (합이 100 이 아니어도)
func TestDivScoreWeights(t *testing.T) {
	p := DivScoreParts{Growth: 1, Stability: 0, Yield: 0, Consistency: 0, Value: 0}
	if s := (DivScoreWeights{30, 25, 20, 10, 15}).total(p); math.Abs(s-30) > 1e-9 {
		t.Fatalf("total = %v", s)
	}
	if s := (DivScoreWeights{60, 50, 40, 20, 30}).total(p); math.Abs(s-30) > 1e-9 {
		t.Fatalf("scaled = %v", s)
	}
	if s := (DivScoreWeights{}).total(p); s != 0 {
		t.Fatalf("zero = %v", s)
	}
}

// 52주 위치·200일선: 최저 근처면 가격·가치 점수가 높다
func TestDivScoreValue(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	events := quarterly(dsDay("2023-12-10"), 12, 1.0, 0)
	var closes []PricePoint
	d := dsDay("2025-06-01")
	for i := 0; !d.After(asOf); i++ {
		price := 100.0
		if d.After(dsDay("2026-10-01")) {
			price = 80 // 최근 하락
		}
		closes = append(closes, PricePoint{Time: d.Unix(), Close: price})
		d = d.AddDate(0, 0, 1)
	}
	m, p, _ := computeDivScore(events, closes, asOf, "market")
	if m.Pos52 == nil || *m.Pos52 != 0 || m.MAGapPct == nil || *m.MAGapPct >= 0 || p.Value < 0.8 {
		t.Fatalf("value metrics = %+v parts %+v", m, p)
	}
}

// 국내 결산 배당: 분기 375원 + 해마다 2월에 크게 → 특별배당이 아니라 정기, 분기 주기
func TestDivScoreKoreanYearEnd(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	var events []DivPerShare
	for _, y := range []int{2022, 2023, 2024, 2025, 2026} {
		ys := func(md string) time.Time { return dsDay(fmt.Sprintf("%d-%s", y, md)) }
		events = append(events,
			DivPerShare{Date: ys("02-26"), Amount: 1200 + float64(y-2022)*150},
			DivPerShare{Date: ys("05-28"), Amount: 375},
			DivPerShare{Date: ys("08-28"), Amount: 375},
		)
		if y < 2026 {
			events = append(events, DivPerShare{Date: ys("11-27"), Amount: 375})
		}
	}
	m, _, ok := computeDivScore(events, nil, asOf, "market")
	if !ok || m.Specials12m != 0 || m.Cycle != "분기" || m.Growth1y == nil || *m.Growth1y <= 0 || *m.Growth1y > 10 {
		t.Fatalf("ok %v metrics = %+v growth %v", ok, m, m.Growth1y)
	}
}

// 배당을 크게 올린 뒤 그 수준이 이어지면 정기 (NVDA 0.01 → 0.25)
func TestDivScoreSustainedHike(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	events := quarterly(dsDay("2023-12-05"), 10, 0.01, 0) // ~2026-03
	events = append(events, DivPerShare{Date: dsDay("2026-06-04"), Amount: 0.25}, DivPerShare{Date: dsDay("2026-09-10"), Amount: 0.25})
	m, _, ok := computeDivScore(events, nil, asOf, "market")
	if !ok || m.Specials12m != 0 || m.Status != divStatusUp || m.Growth1y == nil || *m.Growth1y < 1000 {
		t.Fatalf("ok %v metrics = %+v", ok, m)
	}
}

// 배당락일이 해마다 몇 주씩 밀려도 (10월 → 12월) 같은 금액이면 삭감이 아니다
func TestDivScoreExDateDrift(t *testing.T) {
	asOf := dsDay("2026-10-01").Add(-time.Second)
	var events []DivPerShare
	for _, d := range []string{
		"2022-10-11", "2023-01-13", "2023-04-14", "2023-06-13", "2023-10-11", "2023-12-27",
		"2024-04-12", "2024-06-13", "2024-09-27", "2024-12-27",
		"2025-04-14", "2025-06-13", "2025-09-26", "2025-12-29",
		"2026-04-14", "2026-06-12", "2026-09-30",
	} {
		events = append(events, DivPerShare{Date: dsDay(d), Amount: 1.7})
	}
	m, _, ok := computeDivScore(events, nil, asOf, "market")
	if !ok || m.Status != divStatusFlat || m.Cuts3y != 0 || m.NoCutYears < 3 || m.Growth1y == nil || math.Abs(*m.Growth1y) > 0.5 {
		t.Fatalf("ok %v metrics = %+v growth %v", ok, m, m.Growth1y)
	}
}

// 올해 회차가 작년보다 하루 이르게 나와도 (09-24 → 09-23) 같은 해 4회끼리 비교한다
func TestDivScoreOneDayEarlier(t *testing.T) {
	asOf := dsDay("2026-11-01").Add(-time.Second)
	var events []DivPerShare
	for _, d := range []string{
		"2023-12-06", "2024-03-20", "2024-06-26", "2024-09-25", "2024-12-11",
		"2025-03-26", "2025-06-25", "2025-09-24", "2025-12-10",
		"2026-03-25", "2026-06-24", "2026-09-23",
	} {
		events = append(events, DivPerShare{Date: dsDay(d), Amount: 0.26})
	}
	m, _, _ := computeDivScore(events, nil, asOf, "market")
	if m.Growth1y == nil || math.Abs(*m.Growth1y) > 0.5 || m.Status != divStatusFlat {
		t.Fatalf("metrics = %+v growth %v", m, m.Growth1y)
	}
}
