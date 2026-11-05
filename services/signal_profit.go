package services

import (
	"math"
	"sort"
	"strconv"
	"time"

	"stock-manager/models"
)

// 익절 규칙(트레일링 / 연환산 / 비중 쏠림)과 분할 매도 제안에 쓰는 순수 계산 모음.

const (
	annualizedCapPct = 10000.0 // 연환산 수익률 상한 (단기 보유 시 폭주 방지)
	kstOffsetSec     = 9 * 3600
)

// heldLot 은 현재 보유 중인 매수분(로트) 하나다.
type heldLot struct {
	Date time.Time
	Qty  float64
}

// kstDayIndex 는 시각의 KST 달력 일자(에포크 기준 일수)를 돌려준다.
func kstDayIndex(t time.Time) int64 {
	return floorDiv(t.Unix()+kstOffsetSec, 86400)
}

// heldLotsFIFO 는 거래를 계좌별로 FIFO 재생(매수는 로트 추가, 매도는 오래된 로트부터 소진)해
// 현재 보유 로트를 구한다. 계좌의 남은 로트 합이 현재 보유 수량보다 크면 오래된 쪽부터 덜어내고,
// 거래로 설명되지 않는 수량은 로트에 포함하지 않는다. 보유하지 않는 계좌는 무시한다.
func heldLotsFIFO(txns []SignalTxnInput, holdings []SignalHoldingInput) []heldLot {
	held := map[uint]float64{}
	for _, h := range holdings {
		held[h.AccountID] += h.Quantity
	}
	byAcc := map[uint][]SignalTxnInput{}
	for _, tx := range txns {
		if _, ok := held[tx.AccountID]; ok && finite(tx.Quantity) && tx.Quantity > 0 {
			byAcc[tx.AccountID] = append(byAcc[tx.AccountID], tx)
		}
	}
	var out []heldLot
	for acc, list := range byAcc {
		sort.SliceStable(list, func(i, j int) bool { return list[i].Date.Before(list[j].Date) })
		var lots []heldLot
		for _, tx := range list {
			switch tx.Type {
			case models.TransactionTypeBuy:
				lots = append(lots, heldLot{tx.Date, tx.Quantity})
			case models.TransactionTypeSell:
				rem := tx.Quantity
				for len(lots) > 0 && rem > 1e-9 {
					if lots[0].Qty > rem+1e-9 {
						lots[0].Qty -= rem
						rem = 0
					} else {
						rem -= lots[0].Qty
						lots = lots[1:]
					}
				}
			}
		}
		var total float64
		for _, l := range lots {
			total += l.Qty
		}
		excess := total - held[acc]
		for excess > 1e-9 && len(lots) > 0 {
			if lots[0].Qty > excess+1e-9 {
				lots[0].Qty -= excess
				excess = 0
			} else {
				excess -= lots[0].Qty
				lots = lots[1:]
			}
		}
		out = append(out, lots...)
	}
	return out
}

// weightedHoldingDays 는 로트 수량 가중 평균 보유일(KST 달력 일 기준)이다. 로트가 없으면 0.
func weightedHoldingDays(lots []heldLot, now time.Time) float64 {
	today := kstDayIndex(now)
	var qty, sum float64
	for _, l := range lots {
		d := float64(today - kstDayIndex(l.Date))
		if d < 0 {
			d = 0
		}
		qty += l.Qty
		sum += l.Qty * d
	}
	if qty <= 0 {
		return 0
	}
	return sum / qty
}

// firstBuyDate 는 현재 보유 로트 중 가장 이른 매수일이다. 없으면 (zero, false).
func firstBuyDate(lots []heldLot) (time.Time, bool) {
	var first time.Time
	for _, l := range lots {
		if first.IsZero() || l.Date.Before(first) {
			first = l.Date
		}
	}
	return first, !first.IsZero()
}

// peakCloseSince 는 since(KST 그날 0시) 이후 일봉 종가의 최고가와 그 날짜(YYYY-MM-DD)를 돌려준다.
// since 가 zero 이면 전체 구간. 조건에 맞는 봉이 없으면 (0, "").
func peakCloseSince(points []PricePoint, since time.Time, now time.Time) (float64, string) {
	var from int64 = math.MinInt64
	if !since.IsZero() {
		from = kstDayIndex(since)*86400 - kstOffsetSec
	}
	var peak float64
	var peakT int64
	for _, p := range points {
		if !finite(p.Close) || p.Close <= 0 || p.Time < from || p.Time > now.Unix() {
			continue
		}
		if p.Close > peak {
			peak, peakT = p.Close, p.Time
		}
	}
	if peak <= 0 {
		return 0, ""
	}
	return peak, time.Unix(peakT, 0).In(time.FixedZone("KST", kstOffsetSec)).Format("2006-01-02")
}

// annualizedReturnPct 는 보유 기간 수익률을 1년 기준으로 환산한다 (복리).
// 보유일 <= 0 이면 0, 수익률 <= -100% 이면 -100, 결과는 [-100, annualizedCapPct] 로 제한한다.
func annualizedReturnPct(retPct, days float64) float64 {
	if !finite(retPct) || !finite(days) || days <= 0 {
		return 0
	}
	if retPct <= -100 {
		return -100
	}
	v := (math.Pow(1+retPct/100, 365/days) - 1) * 100
	if math.IsNaN(v) {
		return 0
	}
	if math.IsInf(v, 1) || v > annualizedCapPct {
		return annualizedCapPct
	}
	if v < -100 {
		return -100
	}
	return v
}

// 매도 체크 중 "이익 실현 성격" 코드. 이 코드만 충족된 SELL 은 일부 매도를 제안할 수 있다.
var profitSellCodes = map[string]bool{
	"take_profit": true, "trailing_stop": true, "annualized_return": true,
	"weight_drift": true, "above_ma": true, "dividend_payback": true,
	"yield_compression": true, "vol_overheat": true,
}

// applySellSuggestion 은 SELL 판정된 종목에 분할 매도/리밸런싱 수량을 채운다.
// 손실/위험 신호(손절·폭락·배당 삭감·저수익률 등)가 하나라도 충족되면 제안하지 않는다.
func applySellSuggestion(it *SignalItem, r models.SignalRuleConfig, totalMV float64) {
	it.SuggestedSellQty, it.SuggestedSellKRW, it.SuggestedSellKind = 0, 0, ""
	if it.Action != SignalSell || it.Quantity <= 0 || it.MarketValueKRW <= 0 {
		return
	}
	met, driftMet := 0, false
	for _, c := range it.SellChecks {
		if !c.Met {
			continue
		}
		if !profitSellCodes[c.Code] {
			return
		}
		met++
		if c.Code == "weight_drift" {
			driftMet = true
		}
	}
	if met == 0 {
		return
	}
	priceKRW := it.MarketValueKRW / it.Quantity
	partialQty := func() float64 {
		if !r.PartialEnabled || r.PartialPct <= 0 {
			return 0
		}
		return math.Floor(it.Quantity * r.PartialPct / 100)
	}

	var qty float64
	kind := ""
	if driftMet {
		qty = math.Floor((it.WeightPct - it.CostWeightPct) / 100 * totalMV / priceKRW)
		kind = "rebalance"
		if qty < 1 { // 쏠림 해소분이 1주 미만이면 일부 매도 비율로 대체
			qty, kind = partialQty(), "partial"
		}
	} else {
		qty, kind = partialQty(), "partial"
	}
	qty = math.Min(qty, math.Floor(it.Quantity+1e-9))
	if r.MinSellQtyEnabled && r.MinSellQty > 0 {
		// 남는 수량이 기준(MinSellQty)을 초과해야 한다
		maxQty := math.Ceil(it.Quantity-r.MinSellQty-1e-9) - 1
		qty = math.Min(qty, maxQty)
	}
	if !finite(qty) || qty < 1 {
		return
	}
	it.SuggestedSellQty = qty
	it.SuggestedSellKRW = qty * priceKRW
	it.SuggestedSellKind = kind
}

// sellSuggestionSuffix 는 알림 메시지에 덧붙일 제안 문구다 (제안이 없으면 빈 문자열).
func sellSuggestionSuffix(it SignalItem) string {
	if it.Action != SignalSell || it.SuggestedSellQty <= 0 {
		return ""
	}
	qty := formatQty(it.SuggestedSellQty)
	switch it.SuggestedSellKind {
	case "rebalance":
		return " · 리밸런싱 " + qty + "주"
	case "partial":
		return " · 분할 익절 검토 " + qty + "주"
	}
	return ""
}

func formatQty(q float64) string {
	return strconv.FormatFloat(q, 'f', -1, 64)
}
