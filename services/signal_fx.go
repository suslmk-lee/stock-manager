package services

import (
	"math"
	"sort"
	"time"

	"stock-manager/models"
)

// NewFxLookup returns USD→KRW for a date: close of the latest daily bar whose exchange-local
// date (ts+gmtoffset) is on or before the date's KST calendar day. Before the first bar, the
// first bar is used. With no points, fallback is always returned.
func NewFxLookup(h *PriceHistory, fallback float64) func(t time.Time) float64 {
	if h == nil || len(h.Points) == 0 {
		return func(time.Time) float64 { return fallback }
	}
	type bar struct {
		day   int64 // local days since epoch
		close float64
	}
	bars := make([]bar, 0, len(h.Points))
	for _, p := range h.Points {
		if p.Close > 0 && !math.IsNaN(p.Close) && !math.IsInf(p.Close, 0) {
			bars = append(bars, bar{floorDiv(p.Time+h.GmtOffset, 86400), p.Close})
		}
	}
	if len(bars) == 0 {
		return func(time.Time) float64 { return fallback }
	}
	sort.SliceStable(bars, func(i, j int) bool { return bars[i].day < bars[j].day })
	return func(t time.Time) float64 {
		d := floorDiv(t.Unix()+9*3600, 86400) // KST calendar day
		i := sort.Search(len(bars), func(i int) bool { return bars[i].day > d })
		if i == 0 {
			return bars[0].close
		}
		return bars[i-1].close
	}
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}

// FxTxn is one buy/sell in local currency.
type FxTxn struct {
	Type     models.TransactionType
	Date     time.Time
	Quantity float64
	Price    float64 // local currency
	Fee      float64 // local currency (added to cost on buys)
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// ReplayKRWCost replays transactions with the moving-average method in KRW and reconciles with
// the current holding (seeded residual costed at avgPriceLocal*fxNow; mismatch scaled down).
func ReplayKRWCost(txns []FxTxn, currentQty, avgPriceLocal float64, currency string, fxAt func(time.Time) float64, fxNow float64) (costKRW, coveredQty float64) {
	if !finite(currentQty) || currentQty < 0 {
		currentQty = 0
	}
	if !finite(avgPriceLocal) || avgPriceLocal < 0 {
		avgPriceLocal = 0
	}
	if currency == "KRW" {
		return currentQty * avgPriceLocal, currentQty
	}
	if fxAt == nil {
		fxAt = func(time.Time) float64 { return fxNow }
	}
	sorted := append([]FxTxn(nil), txns...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Date.Before(sorted[j].Date) })

	var qty, cost float64
	for _, tx := range sorted {
		if !finite(tx.Quantity) || tx.Quantity <= 0 {
			continue
		}
		switch tx.Type {
		case models.TransactionTypeBuy:
			fx := fxAt(tx.Date)
			if !finite(fx) || fx <= 0 {
				fx = fxNow
			}
			c := (tx.Quantity*tx.Price + tx.Fee) * fx
			if !finite(c) {
				continue
			}
			qty += tx.Quantity
			cost += c
		case models.TransactionTypeSell:
			if qty <= 0 {
				continue
			}
			sq := math.Min(tx.Quantity, qty)
			cost -= cost * sq / qty
			qty -= sq
			if qty < 1e-9 {
				qty, cost = 0, 0
			}
		}
	}
	const eps = 1e-6
	switch {
	case math.Abs(qty-currentQty) <= eps:
		return cost, currentQty
	case currentQty > qty:
		return cost + (currentQty-qty)*avgPriceLocal*fxNow, math.Max(qty, 0)
	default: // currentQty < qty, so qty > 0
		return cost * currentQty / qty, currentQty
	}
}
