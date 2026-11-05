package services

import (
	"testing"

	"stock-manager/models"
)

// 그룹 방식: 익절 그룹과 위험 그룹이 각각 필요 개수를 채워야 하고, 둘 중 하나만 충족해도 매도.
func TestSellGroupMode(t *testing.T) {
	// avg 100, price 130: take_profit 충족, weight_drift 미충족(단일 종목), stop_loss 미충족
	mk := func(pMin, rMin int, stop float64) models.SignalRuleConfig {
		return models.SignalRuleConfig{
			TakeProfitEnabled: true, TakeProfitPct: 30,
			DriftEnabled: true, DriftPct: 50,
			StopLossEnabled: true, StopLossPct: stop,
			SellMode: "group", SellProfitMinCount: pMin, SellRiskMinCount: rMin, BuyMode: "any",
		}
	}
	tests := []struct {
		name string
		rule models.SignalRuleConfig
		px   float64
		want string
	}{
		{"익절 1개 필요, 1개 충족", mk(1, 1, -20), 130, SignalSell},
		{"익절 2개 필요, 1개만 충족 -> 관망", mk(2, 1, -20), 130, SignalHold},
		{"99 는 켜진 수(2)로 제한 -> 모두 필요, 미충족", mk(99, 1, -20), 130, SignalHold},
		{"위험 그룹 단독 충족(손절)", mk(2, 1, -20), 70, SignalSell},
		{"위험 99 도 켜진 1개로 제한", mk(2, 99, -20), 70, SignalSell},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if it := evalOne(t, krwAsset(1, tt.px, 10, 100, tt.rule)); it.Action != tt.want {
				t.Errorf("got %s want %s", it.Action, tt.want)
			}
		})
	}
	// 구 방식은 그대로 동작
	legacy := mk(1, 1, -20)
	legacy.SellMode = "all"
	if it := evalOne(t, krwAsset(1, 130, 10, 100, legacy)); it.Action != SignalHold {
		t.Errorf("all legacy %s", it.Action)
	}
	legacy.SellMode = "any"
	if it := evalOne(t, krwAsset(1, 130, 10, 100, legacy)); it.Action != SignalSell {
		t.Errorf("any legacy %s", it.Action)
	}
}

func TestMigrateV6ToV7(t *testing.T) {
	cases := []struct {
		mode         string
		count        int
		wantP, wantR int
	}{{"any", 0, 1, 1}, {"", 0, 1, 1}, {"count", 3, 3, 1}, {"all", 0, 99, 99}}
	for _, tc := range cases {
		c := models.SignalRuleConfig{SellMode: tc.mode, SellMinCount: tc.count, BuyMode: "count", BuyMinCount: 2}
		v := 6
		if !migrateRuleConfig(&c, &v) || v != models.SignalRuleVersion {
			t.Fatalf("not migrated")
		}
		if c.SellMode != "group" || c.SellProfitMinCount != tc.wantP || c.SellRiskMinCount != tc.wantR || c.SellMinCount != 0 {
			t.Errorf("%s/%d -> %+v", tc.mode, tc.count, c)
		}
		if c.BuyMode != "count" || c.BuyMinCount != 2 {
			t.Errorf("buy mode must stay: %+v", c)
		}
		if !c.BuyCooldownEnabled || c.BuyCooldownDays != 14 || !c.BuyMaxWeightEnabled || c.BuyMaxWeightPct != 20 ||
			!c.BuyQtyEnabled || c.BuyQtyMode != "amount" || c.BuyQtyAmountKRW != 1000000 || c.BuyQtyLowerAvgPct != 5 ||
			c.LastBuyDipEnabled || c.LastBuyDipPct != -10 || c.VolStopEnabled || c.VolStopK != 1 {
			t.Errorf("defaults %+v", c)
		}
		if err := ValidateSignalRuleConfig(&c); err != nil {
			t.Errorf("migrated config invalid: %v", err)
		}
	}
}

func TestValidateBuyRules(t *testing.T) {
	ok := func() models.SignalRuleConfig { return models.DefaultSignalRuleConfig() }
	c := ok()
	c.BuyCooldownDays, c.BuyMaxWeightPct, c.BuyQtyMode, c.BuyQtyAmountKRW, c.BuyQtyLowerAvgPct = 0, 0, "", 0, 0
	if err := ValidateSignalRuleConfig(&c); err != nil || c.BuyCooldownDays != 14 || c.BuyMaxWeightPct != 20 ||
		c.BuyQtyMode != "amount" || c.BuyQtyAmountKRW != 1000000 || c.BuyQtyLowerAvgPct != 5 {
		t.Errorf("defaults not applied: %v %+v", err, c)
	}
	bads := map[string]func(*models.SignalRuleConfig){
		"qty mode":     func(c *models.SignalRuleConfig) { c.BuyQtyMode = "bogus" },
		"cooldown 366": func(c *models.SignalRuleConfig) { c.BuyCooldownDays = 366 },
		"cooldown -1":  func(c *models.SignalRuleConfig) { c.BuyCooldownDays = -1 },
		"weight 101":   func(c *models.SignalRuleConfig) { c.BuyMaxWeightPct = 101 },
		"amount neg":   func(c *models.SignalRuleConfig) { c.BuyQtyAmountKRW = -1 },
		"lower 51":     func(c *models.SignalRuleConfig) { c.BuyQtyLowerAvgPct = 51 },
		"dip positive": func(c *models.SignalRuleConfig) { c.LastBuyDipPct = 1 },
		"dip zero on":  func(c *models.SignalRuleConfig) { c.LastBuyDipEnabled, c.LastBuyDipPct = true, 0 },
		"volk 6":       func(c *models.SignalRuleConfig) { c.VolStopK = 6 },
		"volk 0 on":    func(c *models.SignalRuleConfig) { c.VolStopEnabled, c.VolStopK = true, 0 },
		"group 0":      func(c *models.SignalRuleConfig) { c.SellProfitMinCount = 0 },
		"group 100":    func(c *models.SignalRuleConfig) { c.SellRiskMinCount = 100 },
		"buy group":    func(c *models.SignalRuleConfig) { c.BuyMode = "group" },
	}
	for name, f := range bads {
		c := ok()
		f(&c)
		if err := ValidateSignalRuleConfig(&c); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	// count 방식이어도 group 개수는 지워지지 않는다
	c = ok()
	c.SellMode, c.SellMinCount, c.SellProfitMinCount, c.SellRiskMinCount = "count", 2, 3, 4
	if err := ValidateSignalRuleConfig(&c); err != nil || c.SellProfitMinCount != 3 || c.SellRiskMinCount != 4 {
		t.Errorf("group counts cleared: %v %+v", err, c)
	}
}

func TestVolStopCheck(t *testing.T) {
	r := models.SignalRuleConfig{VolStopEnabled: true, VolStopK: 1.5, SellMode: "any", BuyMode: "any"}
	it := SignalItem{TotalReturnPct: -31, VolatilityPct: 20, ReturnBasis: "current"}
	evaluateSignalRule(&it, r)
	if len(it.SellChecks) != 1 || it.SellChecks[0].Code != "vol_stop" || !it.SellChecks[0].Met || it.SellChecks[0].Threshold != -30 {
		t.Errorf("met %+v", it.SellChecks)
	}
	it = SignalItem{TotalReturnPct: -29, VolatilityPct: 20, ReturnBasis: "current"}
	evaluateSignalRule(&it, r)
	if it.SellChecks[0].Met {
		t.Errorf("unmet %+v", it.SellChecks)
	}
	it = SignalItem{TotalReturnPct: -90, VolatilityPct: 0, ReturnBasis: "current"}
	evaluateSignalRule(&it, r)
	if it.SellChecks[0].Met {
		t.Errorf("not computable %+v", it.SellChecks)
	}
}

func buyTxn(acct uint, daysAgo int, price float64) SignalTxnInput {
	return SignalTxnInput{AccountID: acct, Type: models.TransactionTypeBuy, Date: sigNow.AddDate(0, 0, -daysAgo), Quantity: 1, Price: price}
}

func buyRule() models.SignalRuleConfig {
	return models.SignalRuleConfig{BuyDipEnabled: true, BuyDipPct: -10, SellMode: "any", BuyMode: "any"}
}

func TestLastBuyDip(t *testing.T) {
	r := buyRule()
	r.BuyDipEnabled = false
	r.LastBuyDipEnabled, r.LastBuyDipPct = true, -10
	in := krwAsset(1, 85, 10, 50, r)
	in.Txns = []SignalTxnInput{buyTxn(1, 100, 200), buyTxn(2, 30, 100), buyTxn(1, 60, 50)} // 가장 최근: 30일 전 100원 (계좌 2)
	it := evalOne(t, in)
	if it.LastBuyPrice != 100 || it.DaysSinceLastBuy != 30 || it.LastBuyDate == "" || it.FromLastBuyPct > -14.9 || it.FromLastBuyPct < -15.1 {
		t.Errorf("last buy %+v", it)
	}
	if it.Action != SignalBuy || !it.BuyChecks[0].Met || it.BuyChecks[0].Code != "last_buy_dip" {
		t.Errorf("expect met %+v %s", it.BuyChecks, it.Action)
	}
	// 매수 거래가 없으면 미충족 (값 0)
	in.Txns = nil
	it = evalOne(t, in)
	if it.BuyChecks[0].Met || it.BuyChecks[0].Value != 0 || it.Action != SignalHold || it.LastBuyDate != "" {
		t.Errorf("no txn %+v", it)
	}
	// 낙폭 부족
	in.Txns = []SignalTxnInput{buyTxn(1, 30, 90)}
	if it = evalOne(t, in); it.BuyChecks[0].Met {
		t.Errorf("shallow %+v", it.BuyChecks)
	}
}

func TestBuyExclusions(t *testing.T) {
	// 단일 종목 비중 100% -> max_weight 로 제외
	r := buyRule()
	r.BuyMaxWeightEnabled, r.BuyMaxWeightPct = true, 20
	it := evalOne(t, krwAsset(1, 80, 10, 100, r))
	if it.Action != SignalHold || it.BuyExcludedReason != "max_weight" || it.BuyMaxWeightPct != 20 {
		t.Errorf("max weight %+v", it)
	}
	// 쿨다운
	r = buyRule()
	r.BuyCooldownEnabled, r.BuyCooldownDays = true, 14
	in := krwAsset(1, 80, 10, 100, r)
	in.Txns = []SignalTxnInput{buyTxn(1, 5, 90)}
	it = evalOne(t, in)
	if it.Action != SignalHold || it.BuyExcludedReason != "cooldown" || it.BuyCooldownDays != 14 || it.DaysSinceLastBuy != 5 {
		t.Errorf("cooldown %+v", it)
	}
	in.Txns = []SignalTxnInput{buyTxn(1, 14, 90)}
	if it = evalOne(t, in); it.Action != SignalBuy || it.BuyExcludedReason != "" {
		t.Errorf("cooldown over %+v", it)
	}
	// 둘 다 해당되면 쿨다운이 사유, 상세는 둘 다
	r.BuyMaxWeightEnabled, r.BuyMaxWeightPct = true, 20
	in = krwAsset(1, 80, 10, 100, r)
	in.Txns = []SignalTxnInput{buyTxn(1, 1, 90)}
	if it = evalOne(t, in); it.BuyExcludedReason != "cooldown" || it.BuyMaxWeightPct != 20 || it.BuyCooldownDays != 14 {
		t.Errorf("precedence %+v", it)
	}
	// CONFLICT -> SELL
	r = buyRule()
	r.StopLossEnabled, r.StopLossPct = true, -5
	r.BuyMaxWeightEnabled, r.BuyMaxWeightPct = true, 20
	if it = evalOne(t, krwAsset(1, 80, 10, 100, r)); it.Action != SignalSell {
		t.Errorf("conflict->sell %s", it.Action)
	}
	r.BuyMaxWeightEnabled = false
	if it = evalOne(t, krwAsset(1, 80, 10, 100, r)); it.Action != SignalConflict {
		t.Errorf("conflict %s", it.Action)
	}
}

// buyItem 은 BUY 판정된 항목을 직접 구성한다 (현재가 p KRW, 수량 q, 평단 avg).
func buyItem(p, q, avg float64) SignalItem {
	return SignalItem{Action: SignalBuy, Quantity: q, AvgPrice: avg, CurrentPrice: p, MarketValueKRW: p * q}
}

func TestBuyQtySuggestion(t *testing.T) {
	base := models.SignalRuleConfig{BuyQtyEnabled: true, BuyQtyMode: "amount", BuyQtyAmountKRW: 1000000, BuyQtyLowerAvgPct: 5}
	// amount: 1,000,000 / 30,000 = 33
	it := buyItem(30000, 10, 40000)
	applyBuySuggestion(&it, base, 10000000)
	if it.SuggestedBuyQty != 33 || it.SuggestedBuyKind != "amount" || it.SuggestedBuyKRW != 990000 {
		t.Errorf("amount %+v", it)
	}
	// 1주 미만이면 제안 없음
	small := base
	small.BuyQtyAmountKRW = 10000
	it = buyItem(30000, 10, 40000)
	if applyBuySuggestion(&it, small, 10000000); it.SuggestedBuyQty != 0 {
		t.Errorf("qty<1 %+v", it)
	}
	// 꺼짐 / BUY 아님
	off := base
	off.BuyQtyEnabled = false
	it = buyItem(30000, 10, 40000)
	if applyBuySuggestion(&it, off, 10000000); it.SuggestedBuyQty != 0 {
		t.Errorf("off %+v", it)
	}
	it = buyItem(30000, 10, 40000)
	it.Action = SignalHold
	if applyBuySuggestion(&it, base, 10000000); it.SuggestedBuyQty != 0 {
		t.Errorf("not buy %+v", it)
	}
	// target_weight: 보유 300,000 / 총 1,000,000, 목표 40% -> q=(0.4e6-3e5)/(0.6*3e4)=5.55 -> 5
	tw := base
	tw.BuyQtyMode, tw.TargetWeightPct = "target_weight", 40
	it = buyItem(30000, 10, 40000)
	if applyBuySuggestion(&it, tw, 1000000); it.SuggestedBuyQty != 5 || it.SuggestedBuyKind != "target_weight" {
		t.Errorf("target %+v", it)
	}
	// 목표 비중 0 이면 amount 로 대체
	tw.TargetWeightPct = 0
	it = buyItem(30000, 10, 40000)
	if applyBuySuggestion(&it, tw, 10000000); it.SuggestedBuyKind != "amount" || it.SuggestedBuyQty != 33 {
		t.Errorf("tw fallback %+v", it)
	}
	// lower_avg: Q=10 avg=100 price=80 x=10% -> 목표 평단 90 -> q=ceil(10*100*0.1/(90-80))=10
	la := base
	la.BuyQtyMode, la.BuyQtyLowerAvgPct = "lower_avg", 10
	it = buyItem(80, 10, 100)
	if applyBuySuggestion(&it, la, 1e9); it.SuggestedBuyQty != 10 || it.SuggestedBuyKind != "lower_avg" {
		t.Errorf("lower_avg %+v", it)
	}
	// 불가능: 현재가가 목표 평단 이상
	it = buyItem(95, 10, 100)
	if applyBuySuggestion(&it, la, 1e9); it.SuggestedBuyQty != 0 {
		t.Errorf("lower_avg impossible %+v", it)
	}
	// 최대 비중 상한 40%: amount 33주 요구, (0.4e6-3e5)/(0.6*3e4)=5.55 -> 5 로 제한
	capped := base
	capped.BuyMaxWeightEnabled, capped.BuyMaxWeightPct = true, 40
	it = buyItem(30000, 10, 40000)
	if applyBuySuggestion(&it, capped, 1000000); it.SuggestedBuyQty != 5 {
		t.Errorf("cap %+v", it)
	}
	// 이미 상한 초과 -> 제안 없음
	capped.BuyMaxWeightPct = 25
	it = buyItem(30000, 10, 40000)
	if applyBuySuggestion(&it, capped, 1000000); it.SuggestedBuyQty != 0 {
		t.Errorf("cap exceeded %+v", it)
	}
}

func TestBuySuggestionEndToEnd(t *testing.T) {
	r := buyRule()
	r.BuyQtyEnabled, r.BuyQtyMode, r.BuyQtyAmountKRW = true, "amount", 1000
	it := evalOne(t, krwAsset(1, 80, 10, 100, r)) // 단가 80원 -> 12주
	if it.Action != SignalBuy || it.SuggestedBuyQty != 12 {
		t.Errorf("%+v", it)
	}
	if got := buySuggestionSuffix(it); got != " · 추가 매수 12주" {
		t.Errorf("suffix %q", got)
	}
}
