package services

import (
	"math"
	"time"

	"stock-manager/models"
)

// 매도 체크 중 익절 그룹에 속하는 코드. 나머지 매도 체크는 모두 위험(손절) 그룹이다.
var profitGroupCodes = map[string]bool{
	"take_profit": true, "trailing_stop": true, "annualized_return": true,
	"weight_drift": true, "yield_compression": true, "vol_overheat": true,
	"rsi_overbought": true, "mfi_overbought": true, "per_high": true, "pbr_high": true,
}

// groupSellHit 는 "group" 방식 매도 판정이다. 익절/위험 그룹 각각에서
// 켜진 조건이 있고 충족 개수가 min(필요 개수, 켜진 개수) 이상이면 해당 그룹이 충족, 둘 중 하나면 매도.
func groupSellHit(checks []SignalCheck, profitMin, riskMin int) bool {
	var profitOn, profitMet, riskOn, riskMet int
	for _, c := range checks {
		if profitGroupCodes[c.Code] {
			profitOn++
			if c.Met {
				profitMet++
			}
		} else {
			riskOn++
			if c.Met {
				riskMet++
			}
		}
	}
	hit := func(on, met, min int) bool {
		if on == 0 {
			return false
		}
		if min < 1 {
			min = 1
		}
		if min > on {
			min = on
		}
		return met >= min
	}
	return hit(profitOn, profitMet, profitMin) || hit(riskOn, riskMet, riskMin)
}

// applyLastBuy 는 전 계좌 거래 중 가장 최근 매수(날짜 기준, 같은 날이면 목록 뒤쪽)를 찾아 마지막 매수 필드를 채운다.
func applyLastBuy(item *SignalItem, txns []SignalTxnInput, price float64, now time.Time) {
	var last *SignalTxnInput
	for i := range txns {
		t := &txns[i]
		if t.Type != models.TransactionTypeBuy {
			continue
		}
		if last == nil || !t.Date.Before(last.Date) {
			last = t
		}
	}
	item.hasLastBuy = false
	if last == nil {
		return
	}
	item.hasLastBuy = true
	item.LastBuyDate = last.Date.In(time.FixedZone("KST", kstOffsetSec)).Format("2006-01-02")
	item.LastBuyPrice = last.Price
	days := int(kstDayIndex(now) - kstDayIndex(last.Date))
	if days < 0 {
		days = 0
	}
	item.DaysSinceLastBuy = days
	if price > 0 && last.Price > 0 {
		item.FromLastBuyPct = (price/last.Price - 1) * 100
	}
}

// applyBuySuggestion 은 최종 액션이 BUY 인 종목에 추가 매수 수량을 채운다.
//   - amount: floor(금액 / 원화 단가)
//   - target_weight: 목표 비중(TargetWeightPct)에 도달하는 수량. 매수로 총액도 늘어나는 점을 반영해 정확히 푼다:
//     (v+q·p)/(T+q·p)=w  =>  q=(w·T−v)/((1−w)·p)   (w>=1 이면 q=(T−v)/p). 목표 비중이 0 이하면 amount 로 대체.
//   - lower_avg: 평단을 x% 낮추는 수량 ceil(Q·avg·x/(avg(1−x)−price)), 현재가가 목표 평단 이상이면 제안 없음
//
// 최대 비중이 켜져 있으면 매수 후 비중이 상한을 넘지 않도록 내림 보정하고, 1주 미만이면 제안하지 않는다.
func applyBuySuggestion(it *SignalItem, r models.SignalRuleConfig, totalMV float64) {
	it.SuggestedBuyQty, it.SuggestedBuyKRW, it.SuggestedBuyKind = 0, 0, ""
	if it.Action != SignalBuy || !r.BuyQtyEnabled || it.Quantity <= 0 || it.MarketValueKRW <= 0 || it.CurrentPrice <= 0 {
		return
	}
	priceKRW := it.MarketValueKRW / it.Quantity
	value := it.MarketValueKRW
	var qty float64
	kind := r.BuyQtyMode
	if kind == "" {
		kind = "amount"
	}
	if kind == "target_weight" && r.TargetWeightPct <= 0 {
		kind = "amount"
	}
	switch kind {
	case "amount":
		if r.BuyQtyAmountKRW <= 0 {
			return
		}
		qty = math.Floor(r.BuyQtyAmountKRW / priceKRW)
	case "target_weight":
		w := r.TargetWeightPct / 100
		if w >= 1 {
			qty = math.Floor((totalMV - value) / priceKRW)
		} else {
			qty = math.Floor((w*totalMV - value) / ((1 - w) * priceKRW))
		}
	case "lower_avg":
		x := r.BuyQtyLowerAvgPct / 100
		avg, p := it.AvgPrice, it.CurrentPrice
		den := avg*(1-x) - p
		if x <= 0 || avg <= 0 || den <= 0 {
			return
		}
		qty = math.Ceil(it.Quantity * avg * x / den)
	default:
		return
	}
	if r.BuyMaxWeightEnabled && r.BuyMaxWeightPct > 0 && r.BuyMaxWeightPct < 100 {
		c := r.BuyMaxWeightPct / 100
		qty = math.Min(qty, math.Floor((c*totalMV-value)/((1-c)*priceKRW)))
	}
	if !finite(qty) || qty < 1 {
		return
	}
	it.SuggestedBuyQty = qty
	it.SuggestedBuyKRW = qty * priceKRW
	it.SuggestedBuyKind = kind
}

// buySuggestionSuffix 는 알림 메시지에 덧붙일 추가 매수 문구다 (제안이 없으면 빈 문자열).
func buySuggestionSuffix(it SignalItem) string {
	if it.Action != SignalBuy || it.SuggestedBuyQty <= 0 {
		return ""
	}
	return " · 추가 매수 " + formatQty(it.SuggestedBuyQty) + "주"
}
