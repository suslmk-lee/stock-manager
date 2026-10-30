package services

import (
	"errors"
	"fmt"
	"math"
	"sync/atomic"
	"testing"
	"time"
)

func daily(now time.Time, closes []float64) []PricePoint {
	// closes[0] oldest ... last = today
	pts := make([]PricePoint, len(closes))
	for i, c := range closes {
		pts[i] = PricePoint{Time: now.AddDate(0, 0, -(len(closes) - 1 - i)).Unix(), Close: c}
	}
	return pts
}

func TestComputePriceStatsWindow(t *testing.T) {
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	pts := []PricePoint{
		{Time: now.AddDate(0, 0, -366).Unix(), Close: 1000}, // excluded
		{Time: now.AddDate(0, 0, -365).Unix(), Close: 50},   // included
		{Time: now.AddDate(0, 0, -10).Unix(), Close: 80},
		{Time: now.Unix(), Close: 70},
	}
	st := ComputePriceStats(pts, now)
	if st.High52w != 80 || st.Low52w != 50 || st.Points != 4 {
		t.Fatalf("got %+v", st)
	}
	if st.MA50 != 0 || st.MA200 != 0 {
		t.Fatalf("MA should be 0: %+v", st)
	}
}

func TestComputePriceStatsUnsortedAndMA(t *testing.T) {
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		name        string
		n           int
		ma50, ma200 float64
	}{
		{"49 points", 49, 0, 0},
		{"50 points", 50, 25.5 + 0, 0}, // closes 1..50 -> avg 25.5
		{"199 points", 199, 175, 0},    // last 50 of 1..199 = 150..199 avg 174.5
		{"200 points", 200, 175.5, 100.5},
	}
	tests[2].ma50 = 174.5
	tests[3].ma50 = 175.5
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			closes := make([]float64, tc.n)
			for i := range closes {
				closes[i] = float64(i + 1)
			}
			pts := daily(now, closes)
			// reverse to test unsorted
			for i, j := 0, len(pts)-1; i < j; i, j = i+1, j-1 {
				pts[i], pts[j] = pts[j], pts[i]
			}
			st := ComputePriceStats(pts, now)
			if math.Abs(st.MA50-tc.ma50) > 1e-9 || math.Abs(st.MA200-tc.ma200) > 1e-9 {
				t.Fatalf("got ma50=%v ma200=%v want %v %v", st.MA50, st.MA200, tc.ma50, tc.ma200)
			}
			if st.High52w != float64(tc.n) || st.Low52w != 1 {
				t.Fatalf("hi/lo %+v", st)
			}
		})
	}
}

func TestComputePriceStatsEmpty(t *testing.T) {
	if st := ComputePriceStats(nil, time.Now()); st != (PriceStats{}) {
		t.Fatalf("got %+v", st)
	}
}

func TestDailyHistoryCache(t *testing.T) {
	s := NewTickerService()
	var calls int32
	cur := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	s.histCache2.now = func() time.Time { return cur }
	var lastTicker atomic.Value
	s.histCache2.fetch = func(tk, r, i string) (*PriceHistory, error) {
		atomic.AddInt32(&calls, 1)
		lastTicker.Store(fmt.Sprintf("%s/%s/%s", tk, r, i))
		if tk == "BAD" {
			return nil, errors.New("boom")
		}
		return &PriceHistory{Symbol: tk}, nil
	}
	for _, tk := range []string{"aapl", "AAPL", " Aapl "} {
		h, err := s.GetDailyHistoryCached(tk)
		if err != nil || h.Symbol != "AAPL" {
			t.Fatalf("%v %v", h, err)
		}
	}
	if calls != 1 {
		t.Fatalf("calls=%d want 1", calls)
	}
	s.GetDailyHistoryCached("msft")
	if calls != 2 {
		t.Fatalf("calls=%d want 2", calls)
	}
	cur = cur.Add(5*time.Hour + 59*time.Minute)
	s.GetDailyHistoryCached("AAPL")
	if calls != 2 {
		t.Fatalf("still cached, calls=%d", calls)
	}
	cur = cur.Add(2 * time.Minute)
	s.GetDailyHistoryCached("AAPL")
	if calls != 3 {
		t.Fatalf("expired, calls=%d", calls)
	}
	if _, err := s.GetFxHistoryCached(); err != nil || lastTicker.Load() != "KRW=X/5y/1d" {
		t.Fatalf("fx: %v %v", err, lastTicker.Load())
	}
	m := s.GetDailyHistoriesCached([]string{"aapl", "msft", "bad", "nvda"})
	if len(m) != 3 || m["BAD"] != nil || m["NVDA"] == nil {
		t.Fatalf("map %v", m)
	}
}
