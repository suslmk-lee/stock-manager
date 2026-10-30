package services

import (
	"sort"
	"time"

	"stock-manager/models"
)

// AcctTxn 은 계좌별 수량 역추적에 쓰는 최소 거래 정보다.
type AcctTxn struct {
	AccountID uint
	Type      models.TransactionType // Buy / Sell
	Date      time.Time
	Quantity  float64
}

func endOfKSTDay(t time.Time) time.Time {
	k := t.In(kst)
	return time.Date(k.Year(), k.Month(), k.Day(), 0, 0, 0, 0, kst).AddDate(0, 0, 1)
}

// QuantityAtFunc 는 현재 수량에서 거꾸로 되돌려 특정 일(KST)의 종료 시점 보유 수량을 반환하는 함수를 만든다.
// qty(t) = current − Σbuys(date > endOfDay(t)) + Σsells(date > endOfDay(t)), 0 미만은 0으로 보정.
func QuantityAtFunc(currentQty map[uint]float64, txns []AcctTxn) func(accountID uint, t time.Time) float64 {
	return func(accountID uint, t time.Time) float64 {
		cutoff := endOfKSTDay(t) // 이 시각 이후(다음날 0시~) 거래는 아직 발생하지 않은 것
		qty := currentQty[accountID]
		for _, tx := range txns {
			if tx.AccountID != accountID || tx.Date.Before(cutoff) {
				continue
			}
			switch tx.Type {
			case models.TransactionTypeBuy:
				qty -= tx.Quantity
			case models.TransactionTypeSell:
				qty += tx.Quantity
			}
		}
		if qty < 0 {
			return 0
		}
		return qty
	}
}

// DivEvent 는 배당 지급 1건(세전)이다.
type DivEvent struct {
	AccountID uint
	Date      time.Time
	Amount    float64 // GROSS (pre-tax), 해당 통화
}

// DividendTrend 는 최근 12개월 대비 직전 12개월 주당배당 추세다.
type DividendTrend struct {
	DPS12m, DPSPrev12m float64
	ChangePct          float64
	Payments12m        int
	PaymentsPrev12m    int
	OK                 bool
}

// DividendTrendOf 는 (now−365d, now] 와 (now−730d, now−365d] 구간의 주당배당을 비교한다.
// 같은 KST 일자에 여러 계좌로 지급된 배당은 하나의 이벤트(Σ금액 / Σ수량)로 취급한다.
func DividendTrendOf(divs []DivEvent, qtyAt func(uint, time.Time) float64, now time.Time) DividendTrend {
	type group struct {
		date   time.Time
		amount float64
		qty    float64
		accts  map[uint]bool
	}
	groups := map[string]*group{}
	for _, d := range divs {
		if d.Date.After(now) {
			continue
		}
		q := qtyAt(d.AccountID, d.Date)
		if q <= 0 {
			continue
		}
		key := d.Date.In(kst).Format("2006-01-02")
		g := groups[key]
		if g == nil {
			g = &group{date: d.Date, accts: map[uint]bool{}}
			groups[key] = g
		}
		g.amount += d.Amount
		if !g.accts[d.AccountID] {
			g.accts[d.AccountID] = true
			g.qty += q
		}
	}
	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	b1 := now.AddDate(0, 0, -365)
	b2 := now.AddDate(0, 0, -730)
	var tr DividendTrend
	for _, k := range keys {
		g := groups[k]
		per := g.amount / g.qty
		switch {
		case g.date.After(b1):
			tr.DPS12m += per
			tr.Payments12m++
		case g.date.After(b2):
			tr.DPSPrev12m += per
			tr.PaymentsPrev12m++
		}
	}
	if tr.Payments12m >= 1 && tr.PaymentsPrev12m >= 1 && tr.DPSPrev12m > 0 {
		tr.OK = true
		tr.ChangePct = (tr.DPS12m/tr.DPSPrev12m - 1) * 100
	}
	return tr
}
