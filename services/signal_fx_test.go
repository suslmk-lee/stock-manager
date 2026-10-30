package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func TestFxLookup(t *testing.T) {
	// US-market style bars (gmtoffset -4h, bar at 09:30 local = 13:30 UTC)
	us := func(y int, m time.Month, d int) int64 { return time.Date(y, m, d, 13, 30, 0, 0, time.UTC).Unix() }
	h := &PriceHistory{GmtOffset: -4 * 3600, Points: []PricePoint{
		{Time: us(2026, 5, 7), Close: 1300},  // Thu
		{Time: us(2026, 5, 8), Close: 1310},  // Fri
		{Time: us(2026, 5, 11), Close: 1320}, // Mon
	}}
	f := NewFxLookup(h, 1400)
	kstDay := func(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 10, 0, 0, 0, kst) }
	tests := []struct {
		name string
		at   time.Time
		want float64
	}{
		{"weekend -> Friday", kstDay(2026, 5, 9), 1310},
		{"sunday -> Friday", kstDay(2026, 5, 10), 1310},
		{"exact monday", kstDay(2026, 5, 11), 1320},
		{"before first", kstDay(2026, 1, 1), 1300},
		{"after last", kstDay(2026, 12, 1), 1320},
	}
	for _, tc := range tests {
		if got := f(tc.at); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestFxLookupGmtOffset(t *testing.T) {
	// KST bar at 2026-05-08 00:00 KST = 2026-05-07 15:00 UTC; local date May 8.
	h := &PriceHistory{GmtOffset: 9 * 3600, Points: []PricePoint{
		{Time: time.Date(2026, 5, 7, 15, 0, 0, 0, time.UTC).Unix(), Close: 1310},
		{Time: time.Date(2026, 5, 6, 15, 0, 0, 0, time.UTC).Unix(), Close: 1300},
	}}
	f := NewFxLookup(h, 1)
	if got := f(time.Date(2026, 5, 8, 9, 0, 0, 0, kst)); got != 1310 {
		t.Errorf("May 8 KST got %v", got)
	}
	if got := f(time.Date(2026, 5, 7, 23, 0, 0, 0, kst)); got != 1300 {
		t.Errorf("May 7 KST got %v", got)
	}
}

func TestFxLookupEmpty(t *testing.T) {
	if got := NewFxLookup(&PriceHistory{}, 1234)(time.Now()); got != 1234 {
		t.Fatal(got)
	}
	if got := NewFxLookup(nil, 1234)(time.Now()); got != 1234 {
		t.Fatal(got)
	}
}

func TestReplayKRWCost(t *testing.T) {
	d := func(day int) time.Time { return time.Date(2026, 1, day, 0, 0, 0, 0, kst) }
	fx := func(tm time.Time) float64 {
		if tm.Before(d(10)) {
			return 1000
		}
		return 1200
	}
	buy := func(day int, q, p, fee float64) FxTxn {
		return FxTxn{Type: models.TransactionTypeBuy, Date: d(day), Quantity: q, Price: p, Fee: fee}
	}
	sell := func(day int, q, p float64) FxTxn {
		return FxTxn{Type: models.TransactionTypeSell, Date: d(day), Quantity: q, Price: p}
	}
	tests := []struct {
		name        string
		txns        []FxTxn
		qty, avg    float64
		currency    string
		wantCost    float64
		wantCovered float64
	}{
		{"two buys weighted", []FxTxn{buy(1, 10, 10, 0), buy(11, 10, 10, 0)}, 20, 10, "USD", 100*1000 + 100*1200, 20},
		{"unsorted input", []FxTxn{buy(11, 10, 10, 0), buy(1, 10, 10, 0)}, 20, 10, "USD", 220000, 20},
		{"buy sell buy", []FxTxn{buy(1, 10, 10, 0), sell(5, 5, 20), buy(11, 5, 10, 0)}, 10, 10, "USD", 50*1000 + 50*1200, 10},
		{"fee on buy", []FxTxn{buy(1, 10, 10, 5)}, 10, 10.5, "USD", 105 * 1000, 10},
		{"seeded residual", []FxTxn{buy(1, 10, 10, 0)}, 15, 12, "USD", 100*1000 + 5*12*1300, 10},
		{"no txns seeded", nil, 4, 10, "USD", 4 * 10 * 1300, 0},
		{"mismatch scale", []FxTxn{buy(1, 10, 10, 0)}, 4, 10, "USD", 100 * 1000 * 0.4, 4},
		{"KRW shortcut", []FxTxn{buy(1, 10, 10, 0)}, 7, 5000, "KRW", 35000, 7},
		{"sell more than held ignored", []FxTxn{sell(1, 5, 10), buy(2, 2, 10, 0)}, 2, 10, "USD", 20000, 2},
		{"NaN guard", nil, math.NaN(), math.NaN(), "USD", 0, 0},
		{"negative qty", nil, -3, 10, "USD", 0, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c, q := ReplayKRWCost(tc.txns, tc.qty, tc.avg, tc.currency, fx, 1300)
			if !near(c, tc.wantCost) || !near(q, tc.wantCovered) {
				t.Fatalf("got (%v,%v) want (%v,%v)", c, q, tc.wantCost, tc.wantCovered)
			}
		})
	}
}
