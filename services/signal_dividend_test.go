package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

func kd(y int, m time.Month, d, h int) time.Time { return time.Date(y, m, d, h, 0, 0, 0, kst) }

func TestQuantityAtFunc(t *testing.T) {
	cur := map[uint]float64{1: 10}
	txns := []AcctTxn{
		{1, models.TransactionTypeBuy, kd(2026, 3, 10, 10), 5},   // after t
		{1, models.TransactionTypeSell, kd(2026, 4, 1, 10), 2},   // after t
		{1, models.TransactionTypeBuy, kd(2026, 2, 1, 23), 3},    // same day as t (end of day) -> held
		{1, models.TransactionTypeBuy, kd(2026, 1, 1, 10), 1000}, // before t, ignored
		{2, models.TransactionTypeSell, kd(2026, 3, 1, 10), 4},   // account 2 missing from current
	}
	f := QuantityAtFunc(cur, txns)
	tests := []struct {
		name string
		acct uint
		at   time.Time
		want float64
	}{
		{"replay buys and sells", 1, kd(2026, 2, 1, 9), 10 - 5 + 2},
		{"buy on day t counts", 1, kd(2026, 2, 1, 0), 7},
		{"day before the buy-day txn", 1, kd(2026, 1, 31, 12), 7 - 3},
		{"after all txns", 1, kd(2026, 5, 1, 0), 10},
		{"missing account starts at 0 plus sells", 2, kd(2026, 2, 1, 0), 4},
		{"missing account clamped", 3, kd(2026, 2, 1, 0), 0},
		{"UTC input mapped to KST day", 1, time.Date(2026, 1, 31, 16, 0, 0, 0, time.UTC), 7}, // = Feb 1 01:00 KST
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := f(tc.acct, tc.at); got != tc.want {
				t.Errorf("got %v want %v", got, tc.want)
			}
		})
	}
	// clamp negative
	g := QuantityAtFunc(map[uint]float64{1: 1}, []AcctTxn{{1, models.TransactionTypeBuy, kd(2026, 3, 1, 0), 5}})
	if got := g(1, kd(2026, 2, 1, 0)); got != 0 {
		t.Errorf("clamp: %v", got)
	}
}

func constQty(q float64) func(uint, time.Time) float64 {
	return func(uint, time.Time) float64 { return q }
}

func TestDividendTrendOf(t *testing.T) {
	now := kd(2026, 6, 1, 12)
	ago := func(days int) time.Time { return now.AddDate(0, 0, -days) }
	tests := []struct {
		name   string
		divs   []DivEvent
		qty    func(uint, time.Time) float64
		wantOK bool
		dps    float64
		prev   float64
		pct    float64
		n, np  int
	}{
		{"growth", []DivEvent{{1, ago(30), 120}, {1, ago(400), 100}}, constQty(100), true, 1.2, 1.0, 20, 1, 1},
		{"cut", []DivEvent{{1, ago(30), 50}, {1, ago(200), 50}, {1, ago(400), 100}, {1, ago(500), 100}}, constQty(100), true, 1.0, 2.0, -50, 2, 2},
		{"qty doubled is not growth", []DivEvent{{1, ago(30), 200}, {1, ago(400), 100}},
			func(_ uint, t time.Time) float64 {
				if t.After(ago(365)) {
					return 200
				}
				return 100
			}, true, 1.0, 1.0, 0, 1, 1},
		{"same-day multi-account dedupe", []DivEvent{{1, ago(30), 100}, {2, ago(30), 50}, {1, ago(400), 100}, {2, ago(400), 50}},
			func(a uint, _ time.Time) float64 {
				if a == 1 {
					return 100
				}
				return 50
			}, true, 1.0, 1.0, 0, 1, 1},
		{"insufficient prev", []DivEvent{{1, ago(30), 100}}, constQty(100), false, 1.0, 0, 0, 1, 0},
		{"insufficient recent", []DivEvent{{1, ago(400), 100}}, constQty(100), false, 0, 1.0, 0, 0, 1},
		{"future ignored", []DivEvent{{1, now.AddDate(0, 0, 5), 999}, {1, ago(30), 100}}, constQty(100), false, 1.0, 0, 0, 1, 0},
		{"zero qty skipped", []DivEvent{{1, ago(30), 100}, {1, ago(400), 100}}, constQty(0), false, 0, 0, 0, 0, 0},
		{"beyond 730d ignored", []DivEvent{{1, ago(30), 100}, {1, ago(400), 100}, {1, ago(800), 100}}, constQty(100), true, 1.0, 1.0, 0, 1, 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := DividendTrendOf(tc.divs, tc.qty, now)
			if r.OK != tc.wantOK || r.Payments12m != tc.n || r.PaymentsPrev12m != tc.np ||
				math.Abs(r.DPS12m-tc.dps) > 1e-9 || math.Abs(r.DPSPrev12m-tc.prev) > 1e-9 || math.Abs(r.ChangePct-tc.pct) > 1e-9 {
				t.Errorf("got %+v", r)
			}
		})
	}
}
