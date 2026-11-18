package services

import (
	"math"
	"strings"
	"testing"

	"stock-manager/models"
)

// 오늘 살 종목: 신호 40 · 배당 30 · 비중 15 · 살 돈 15 (배당 없으면 신호 70), 매도·막힌·오늘 산·오늘 모으기 종목은 빼고 상위 3개
func TestRankToday(t *testing.T) {
	today := "2026-11-19"
	checks := func(met, total int) []SignalCheck {
		out := make([]SignalCheck, total)
		for i := range out {
			out[i] = SignalCheck{Code: "c", Label: "조건" + string(rune('A'+i)), Met: i < met}
		}
		return out
	}
	acc := func(id uint) []SignalAccountBreakdown { return []SignalAccountBreakdown{{AccountID: id}} }
	items := []SignalItem{
		{AssetID: 1, Ticker: "402970.KS", Name: "ACE 미국배당다우존스", Currency: "KRW", Action: SignalBuy, CurrentPrice: 15455, WeightPct: 4,
			BuyChecks: checks(3, 4), SuggestedBuyKRW: 185460, SuggestedBuyQty: 12, Accounts: acc(1)},
		{AssetID: 2, Ticker: "JEPQ", Name: "JEPQ", Currency: "USD", Action: SignalHold, CurrentPrice: 54.12, WeightPct: 10, BuyMaxWeightPct: 15,
			BuyChecks: checks(2, 4), SuggestedBuyKRW: 200000, Accounts: acc(2)},
		{AssetID: 3, Ticker: "475720.KS", Name: "RISE 200위클리커버드콜", Currency: "KRW", Action: SignalHold, CurrentPrice: 9994, WeightPct: 2,
			BuyChecks: checks(1, 4), SuggestedBuyKRW: 99940, Accounts: acc(3)},
		{AssetID: 4, Ticker: "SPYI", Action: SignalSell, CurrentPrice: 50, BuyChecks: checks(4, 4), Accounts: acc(2)},                             // 매도
		{AssetID: 5, Ticker: "QQQI", Action: SignalBuy, CurrentPrice: 50, BuyChecks: checks(4, 4), BuyExcludedReason: "cooldown", Accounts: acc(2)}, // 쉬는 기간
		{AssetID: 6, Ticker: "GPIQ", Action: SignalBuy, CurrentPrice: 50, BuyChecks: checks(4, 4), LastBuyDate: today, Accounts: acc(2)},         // 오늘 이미 삼
		{AssetID: 7, Ticker: "SCHD", Action: SignalBuy, CurrentPrice: 27, BuyChecks: checks(4, 4), Accounts: acc(2)},                             // 오늘 모으기
		{AssetID: 8, Ticker: "005930.KS", Name: "삼성전자", Currency: "KRW", Action: SignalHold, CurrentPrice: 60000, WeightPct: 30,
			BuyChecks: checks(0, 4), Accounts: acc(1)}, // 점수 낮음
		{AssetID: 9, Ticker: "FUND:XZU9SMKB", Name: "한국벨류10년투자배당", Currency: "KRW", Action: SignalHold, CurrentPrice: 1007, WeightPct: 1,
			BuyChecks: checks(2, 4), SuggestedBuyKRW: 1000, Accounts: acc(4)}, // 예수금 기록 안 하는 토스뱅크
	}
	divRows := map[uint]DivScoreRow{
		1: {AssetID: 1, Score: 80, Rank: 1, Parts: DivScoreParts{Yield: 0.9}},
		2: {AssetID: 2, Score: 70, Rank: 3, Parts: DivScoreParts{Yield: 0.7}},
	}
	planned := map[uint]bool{7: true}
	accounts := map[uint]models.Account{
		1: {ID: 1, Name: "토스증권", Broker: "토스증권"},
		2: {ID: 2, Name: "Super365", Broker: "메리츠증권", ForeignSettle: models.SettleUSD},
		3: {ID: 3, Name: "종합", Broker: "카카오증권"},
		4: {ID: 4, Name: "토스뱅크", Broker: "토스뱅크", NoCash: true},
	}
	balances := map[uint]CashBalance{1: {KRW: 412300}, 2: {USD: 230.4}, 3: {KRW: 96120}}

	picks, considered := rankToday(items, divRows, planned, accounts, balances, 1400, today)
	if considered != 4 {
		t.Fatalf("점수를 넘긴 종목 = %d (1·2·3·9)", considered)
	}
	got := []uint{}
	for _, p := range picks {
		got = append(got, p.AssetID)
	}
	if len(picks) != 3 || got[0] != 1 || got[1] != 9 || got[2] != 2 {
		t.Fatalf("순서 = %v (1, 9, 2 — 3번은 4위)", got)
	}
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.11 }
	a := picks[0]
	// 신호 40 · 배당 30×(0.6×0.8+0.4×0.9)=25.2 · 비중 15×(1−4/20)=12 · 살 돈 15 = 92.2
	if a.Rank != 1 || !near(a.Parts.Signal, 40) || !near(a.Parts.Dividend, 25.2) || !near(a.Parts.Weight, 12) || !near(a.Parts.Cash, 15) || !near(a.Score, 92.2) {
		t.Fatalf("1위 = %+v", a)
	}
	if a.Account == nil || a.Account.Currency != "KRW" || a.Account.Short != 0 || a.Market != "KR" {
		t.Fatalf("1위 계좌 = %+v", a.Account)
	}
	if len(a.Reasons) == 0 || !strings.HasPrefix(a.Reasons[0], "매수 신호") || !strings.Contains(strings.Join(a.Reasons, "|"), "배당 점수 1위") {
		t.Fatalf("1위 이유 = %v", a.Reasons)
	}
	// 배당 없는 펀드: 신호 70×2/4=35 · 비중 15×0.95=14.25 · 예수금 기록 안 함 → 살 돈 만점
	f := picks[1]
	if f.Parts.SignalMax != 70 || !near(f.Parts.Signal, 35) || !near(f.Parts.Cash, 15) || f.Account == nil || !f.Account.NoCash {
		t.Fatalf("펀드 = %+v %+v", f.Parts, f.Account)
	}
	// 달러 계좌: 제안 20만 원 ÷ 1,400 = $142.86, 예수금 $230.40 → 충분
	j := picks[2]
	if j.Account == nil || j.Account.Currency != "USD" || !near(j.Account.Need, 142.86) || j.Account.Short != 0 || j.Market != "US" {
		t.Fatalf("JEPQ 계좌 = %+v", j.Account)
	}
	// 예수금이 모자라면 모자란 금액
	only3, _ := rankToday(items[2:3], nil, nil, accounts, balances, 1400, today)
	if len(only3) != 1 || only3[0].Account == nil || !near(only3[0].Account.Short, 3820) {
		t.Fatalf("모자란 금액 = %+v", only3)
	}
}
