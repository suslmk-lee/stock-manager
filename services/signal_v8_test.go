package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

func buyCheck(it SignalItem, code string) (SignalCheck, bool) {
	for _, c := range it.BuyChecks {
		if c.Code == code {
			return c, true
		}
	}
	return SignalCheck{}, false
}

func yieldExpRule(pct float64) models.SignalRuleConfig {
	r := noRules()
	r.YieldExpansionEnabled, r.YieldExpansionPct = true, pct
	return r
}

func TestYieldExpansionCheck(t *testing.T) {
	events := toMarket(monthlyEvents(2021, 6, 0.5))

	// 가격 절반 -> 현재 12%, 평균 6% -> +100% >= 20 충족
	in := krwAsset(1, 50, 10, 100, yieldExpRule(20))
	in.History = flatCloses(800, 100)
	in.DivEvents = events
	it := evalOne(t, in)
	c, ok := buyCheck(it, "yield_expansion")
	if !ok || !c.Met || !approx(c.Value, 100) || !approx(c.Threshold, 20) || c.Unit != "%" || it.Action != SignalBuy {
		t.Fatalf("met %+v %s", c, it.Action)
	}

	// 임계값 150 이면 미충족
	in.Rule = yieldExpRule(150)
	if c, _ = buyCheck(evalOne(t, in), "yield_expansion"); c.Met {
		t.Errorf("must be unmet %+v", c)
	}

	// 계산 불가(배당 이력 없음): 미충족
	in = krwAsset(1, 50, 10, 100, yieldExpRule(20))
	in.History = flatCloses(800, 100)
	it = evalOne(t, in)
	if c, ok = buyCheck(it, "yield_expansion"); !ok || c.Met || it.Action != SignalHold {
		t.Errorf("not computable %+v %s", c, it.Action)
	}

	// 매수 충족 개수(count 2)에 포함: buy_dip 과 함께 2개 충족해야 매수
	r := yieldExpRule(20)
	r.BuyDipEnabled, r.BuyDipPct = true, -10
	r.BuyMode, r.BuyMinCount = "count", 2
	in = krwAsset(1, 50, 10, 100, r)
	in.History, in.DivEvents = flatCloses(800, 100), events
	if it = evalOne(t, in); it.Action != SignalBuy {
		t.Errorf("both met -> %s", it.Action)
	}
	in.DivEvents = nil
	if it = evalOne(t, in); it.Action != SignalHold {
		t.Errorf("one met -> %s", it.Action)
	}
}

func reboundRule(maOn bool) models.SignalRuleConfig {
	r := noRules()
	r.BuyDipEnabled, r.BuyDipPct = true, -10
	r.ReboundConfirmEnabled, r.ReboundFromLowPct, r.ReboundLookbackDays, r.ReboundMAEnabled = true, 5, 20, maOn
	return r
}

func TestReboundConfirmation(t *testing.T) {
	// 20거래일 저점 70, 현재가 80 -> 저점 대비 +14.3% >= 5 : 통과
	in := krwAsset(1, 80, 10, 100, reboundRule(false))
	in.History = histAt(100, map[int]float64{10: 70})
	it := evalOne(t, in)
	if it.Action != SignalBuy || it.BuyExcludedReason != "" || !it.ReboundConfirmed || it.RecentLowPrice != 70 ||
		!approx(it.FromRecentLowPct, (80.0/70-1)*100) || it.ReboundLookbackDays != 20 || it.MA20 <= 0 {
		t.Fatalf("pass %s %+v", it.Action, it)
	}

	// 반등 미확인: 저점이 곧 현재가 근처 (flat 100 -> 80 은 저점보다 낮고 이평보다도 낮다) -> BUY 가 HOLD
	in = krwAsset(1, 80, 10, 100, reboundRule(true))
	in.History = histAt(100, nil)
	it = evalOne(t, in)
	if it.Action != SignalHold || it.BuyExcludedReason != "no_rebound" || it.ReboundConfirmed {
		t.Fatalf("blocked %s %q", it.Action, it.BuyExcludedReason)
	}

	// CONFLICT -> SELL (손절 -10 충족 + 매수 조건 충족이지만 반등 미확인)
	r := reboundRule(true)
	r.StopLossEnabled, r.StopLossPct = true, -10
	in = krwAsset(1, 80, 10, 100, r)
	in.History = histAt(100, nil)
	if it = evalOne(t, in); it.Action != SignalSell || it.BuyExcludedReason != "no_rebound" {
		t.Errorf("conflict->sell: %s %q", it.Action, it.BuyExcludedReason)
	}
	in.History = histAt(80, map[int]float64{3: 79}) // 저점 +1.3%, MA 80 이상 -> MA 로 통과 -> CONFLICT
	in.Price = 81
	in.Rule.StopLossEnabled = true
	in.Rule.StopLossPct = -10
	if it = evalOne(t, in); it.Action != SignalConflict {
		t.Errorf("confirmed conflict: %s", it.Action)
	}

	// MA20 로 통과: 저점 대비 +2.5% (< 5) 이지만 현재가 81 >= MA20(≈80)
	hist := histAt(80, map[int]float64{3: 79})
	in = krwAsset(1, 81, 10, 100, reboundRule(true))
	in.History = hist
	it = evalOne(t, in)
	if it.Action != SignalBuy || !it.ReboundConfirmed || it.FromRecentLowPct >= 5 {
		t.Fatalf("ma pass %s %+v", it.Action, it)
	}
	// MA 옵션이 꺼지면 막힌다
	in.Rule = reboundRule(false)
	if it = evalOne(t, in); it.Action != SignalHold || it.BuyExcludedReason != "no_rebound" {
		t.Errorf("ma off: %s %q", it.Action, it.BuyExcludedReason)
	}

	// 이력 없음: 막지 않는다
	in = krwAsset(1, 80, 10, 100, reboundRule(false))
	if it = evalOne(t, in); it.Action != SignalBuy || it.BuyExcludedReason != "" || it.RecentLowPrice != 0 {
		t.Errorf("no history: %s %q", it.Action, it.BuyExcludedReason)
	}

	// 규칙이 꺼져 있어도 지표는 채워진다
	in = krwAsset(1, 80, 10, 100, noRules())
	in.History = histAt(100, map[int]float64{10: 70})
	if it = evalOne(t, in); it.RecentLowPrice != 70 || it.ShortChangeDays != 20 {
		t.Errorf("metrics when off: %+v", it)
	}
}

func TestReboundReasonPrecedence(t *testing.T) {
	// 쿨다운 > 최대 비중 > 반등 미확인
	r := reboundRule(false)
	r.BuyCooldownEnabled, r.BuyCooldownDays = true, 14
	r.BuyMaxWeightEnabled, r.BuyMaxWeightPct = true, 20
	in := krwAsset(1, 80, 10, 100, r)
	in.History = histAt(100, nil)
	in.Txns = []SignalTxnInput{buyTx(5, 10)}
	if it := evalOne(t, in); it.BuyExcludedReason != "cooldown" {
		t.Errorf("cooldown first: %q", it.BuyExcludedReason)
	}
	in.Txns = nil // 단일 종목 비중 100% >= 20
	if it := evalOne(t, in); it.BuyExcludedReason != "max_weight" {
		t.Errorf("max_weight second: %q", it.BuyExcludedReason)
	}
	in.Rule.BuyMaxWeightEnabled = false
	if it := evalOne(t, in); it.BuyExcludedReason != "no_rebound" {
		t.Errorf("no_rebound last: %q", it.BuyExcludedReason)
	}
}

func TestReboundOfPure(t *testing.T) {
	h := histAt(100, map[int]float64{30: 50, 5: 90}) // 30일 전 저점 50 은 20일 창 밖
	rb := ReboundOf(h, 99, 20, sigNow)
	if !rb.OK || rb.RecentLow != 90 || !approx(rb.FromLowPct, 10) {
		t.Errorf("window 20: %+v", rb)
	}
	rb = ReboundOf(h, 99, 40, sigNow)
	if rb.RecentLow != 50 {
		t.Errorf("window 40: %+v", rb)
	}
	if rb := ReboundOf(h[:3], 99, 20, sigNow); rb.OK {
		t.Errorf("too few closes must be not OK")
	}
	if !approx(ReboundOf(histAt(100, nil), 100, 20, sigNow).MA20, 100) {
		t.Errorf("ma20")
	}
}

func timeStopRule(days int, maxRet float64) models.SignalRuleConfig {
	r := noRules()
	r.TimeStopEnabled, r.TimeStopDays, r.TimeStopMaxReturnPct = true, days, maxRet
	return r
}

func TestTimeStop(t *testing.T) {
	// 200일 보유, 수익률 -10% <= -5 -> 충족
	in := krwAsset(1, 90, 10, 100, timeStopRule(180, -5))
	in.Txns = []SignalTxnInput{buyTx(200, 10)}
	it := evalOne(t, in)
	c, ok := sellCheck(it, "time_stop")
	if !ok || !c.Met || !approx(c.Value, -10) || c.Threshold != -5 || c.Unit != "%" || it.Action != SignalSell {
		t.Fatalf("met %+v %s", c, it.Action)
	}
	// 기간 미달
	in.Rule = timeStopRule(250, -5)
	if c, _ = sellCheck(evalOne(t, in), "time_stop"); c.Met {
		t.Errorf("days gate %+v", c)
	}
	// 수익률 미달(수익 중)
	in = krwAsset(1, 110, 10, 100, timeStopRule(180, -5))
	in.Txns = []SignalTxnInput{buyTx(200, 10)}
	if c, _ = sellCheck(evalOne(t, in), "time_stop"); c.Met {
		t.Errorf("return gate %+v", c)
	}
	// 기준 0: 본전 이하면 충족 (수익률 0 도 포함)
	in = krwAsset(1, 100, 10, 100, timeStopRule(180, 0))
	in.Txns = []SignalTxnInput{buyTx(200, 10)}
	if c, _ = sellCheck(evalOne(t, in), "time_stop"); !c.Met {
		t.Errorf("zero threshold %+v", c)
	}
	// 거래 기록이 없으면 보유일 0 -> 미충족
	in = krwAsset(1, 90, 10, 100, timeStopRule(30, -5))
	it = evalOne(t, in)
	if c, ok = sellCheck(it, "time_stop"); !ok || c.Met || it.Action != SignalHold {
		t.Errorf("no txns %+v %s", c, it.Action)
	}
}

func TestTimeStopAndShortDropAreRiskGroup(t *testing.T) {
	if profitGroupCodes["time_stop"] || profitGroupCodes["short_drop"] {
		t.Fatal("must be risk group")
	}
	r := noRules()
	r.SellMode, r.SellProfitMinCount, r.SellRiskMinCount = "group", 1, 2
	r.TakeProfitEnabled, r.TakeProfitPct = true, 30
	r.TimeStopEnabled, r.TimeStopDays, r.TimeStopMaxReturnPct = true, 180, -5
	r.ShortDropEnabled, r.ShortDropDays, r.ShortDropPct = true, 20, -50 // 급락은 미충족
	in := krwAsset(1, 90, 10, 100, r)
	in.History = histAt(90, nil)
	in.Txns = []SignalTxnInput{buyTx(200, 10)}
	// 위험 그룹 2개 필요인데 time_stop 만 충족 -> 관망 (익절 그룹의 take_profit 미충족)
	if it := evalOne(t, in); it.Action != SignalHold {
		t.Errorf("risk 1/2: %s", it.Action)
	}
	in.Rule.ShortDropPct = -5
	in.History = histAt(100, nil) // 20일 전 100 -> 90 = -10% <= -5
	if it := evalOne(t, in); it.Action != SignalSell {
		t.Errorf("risk 2/2: %s", it.Action)
	}
}

func shortDropRule(days int, pct float64) models.SignalRuleConfig {
	r := noRules()
	r.ShortDropEnabled, r.ShortDropDays, r.ShortDropPct = true, days, pct
	return r
}

func TestShortDrop(t *testing.T) {
	// 20거래일 전 종가(d=20)는 120, 그 외 100. 현재가 100 -> -16.67%
	h := histAt(100, map[int]float64{20: 120, 21: 1000, 19: 1000})
	in := krwAsset(1, 100, 10, 100, shortDropRule(20, -15))
	in.History = h
	it := evalOne(t, in)
	c, ok := sellCheck(it, "short_drop")
	if !ok || !c.Met || !approx(c.Value, (100.0/120-1)*100) || c.Threshold != -15 || c.Unit != "%" || it.Action != SignalSell {
		t.Fatalf("met %+v %s", c, it.Action)
	}
	if it.ShortChangeDays != 20 || !approx(it.ShortChangePct, c.Value) {
		t.Errorf("fields %d %v", it.ShortChangeDays, it.ShortChangePct)
	}
	// 임계값 -20 이면 미충족
	in.Rule = shortDropRule(20, -20)
	if c, _ = sellCheck(evalOne(t, in), "short_drop"); c.Met {
		t.Errorf("unmet %+v", c)
	}
	// 이력 부족(10개) -> 계산 불가, 미충족
	in = krwAsset(1, 50, 10, 100, shortDropRule(20, -15))
	in.History = histAt(100, nil)[390:]
	it = evalOne(t, in)
	if c, ok = sellCheck(it, "short_drop"); !ok || c.Met || it.ShortChangeDays != 0 || it.Action != SignalHold {
		t.Errorf("insufficient %+v %s", c, it.Action)
	}
	// 규칙 기간 5일: 5거래일 전 종가는 d=5
	in = krwAsset(1, 100, 10, 100, shortDropRule(5, -15))
	in.History = histAt(100, map[int]float64{5: 200})
	if it = evalOne(t, in); it.ShortChangeDays != 5 || !approx(it.ShortChangePct, -50) {
		t.Errorf("5 days %+v", it.ShortChangePct)
	}
}

func TestShortChangeOfPure(t *testing.T) {
	now := sigNow
	pts := []PricePoint{}
	for i := 1; i <= 10; i++ { // 종가 1..10, 마지막이 10
		pts = append(pts, PricePoint{Time: now.Add(-time.Duration(11-i) * 24 * time.Hour).Unix(), Close: float64(i)})
	}
	// N=3 -> 마지막에서 세 번째(8), 현재가 16 -> +100%
	if v, ok := ShortChangeOf(pts, 16, 3, now); !ok || !approx(v, 100) {
		t.Errorf("n=3: %v %v", v, ok)
	}
	if _, ok := ShortChangeOf(pts, 16, 11, now); ok {
		t.Errorf("need more history")
	}
	if v, ok := ShortChangeOf(pts, 5, 10, now); !ok || !approx(v, 400) {
		t.Errorf("n=10: %v", v)
	}
}

func TestMigrateV7ToV8(t *testing.T) {
	// 표준형(익절/손절 있음): 확대 꺼짐
	c := models.SignalRuleConfig{TakeProfitEnabled: true, StopLossEnabled: true, SellMode: "group", BuyMode: "any", SellProfitMinCount: 1, SellRiskMinCount: 1}
	v := 7
	if !migrateRuleConfig(&c, &v) || v != models.SignalRuleVersion || models.SignalRuleVersion < 8 {
		t.Fatalf("not migrated v=%d", v)
	}
	if c.YieldExpansionEnabled || c.ReboundConfirmEnabled || c.TimeStopEnabled || c.ShortDropEnabled || !c.ReboundMAEnabled ||
		c.ReboundFromLowPct != 5 || c.ReboundLookbackDays != 20 || c.YieldExpansionPct != 20 || c.TimeStopDays != 365 ||
		c.TimeStopMaxReturnPct != 0 || c.ShortDropDays != 20 || c.ShortDropPct != -15 {
		t.Errorf("standard %+v", c)
	}
	if err := ValidateSignalRuleConfig(&c); err != nil {
		t.Errorf("invalid after migrate: %v", err)
	}
	// 배당형(익절/손절 모두 꺼짐): 확대 켜짐
	d := models.SignalRuleConfig{SellMode: "group", BuyMode: "any"}
	v = 7
	migrateRuleConfig(&d, &v)
	if !d.YieldExpansionEnabled {
		t.Errorf("dividend style must enable yield expansion")
	}
	// 기존 값은 보존
	e := models.SignalRuleConfig{ReboundFromLowPct: 8, ShortDropPct: -30, TimeStopDays: 90}
	v = 7
	migrateRuleConfig(&e, &v)
	if e.ReboundFromLowPct != 8 || e.ShortDropPct != -30 || e.TimeStopDays != 90 {
		t.Errorf("preserve %+v", e)
	}
	// 공장 출고 규칙
	if !models.DividendSignalRuleConfig().YieldExpansionEnabled || models.DefaultSignalRuleConfig().YieldExpansionEnabled {
		t.Errorf("factory yield expansion")
	}
	if err := ValidateSignalRuleConfig(func() *models.SignalRuleConfig { x := models.DefaultSignalRuleConfig(); return &x }()); err != nil {
		t.Errorf("default invalid: %v", err)
	}
}

func TestValidateV8Fields(t *testing.T) {
	base := models.DefaultSignalRuleConfig
	bad := map[string]func(*models.SignalRuleConfig){
		"rebound pct >100":   func(c *models.SignalRuleConfig) { c.ReboundFromLowPct = 101 },
		"rebound pct <0":     func(c *models.SignalRuleConfig) { c.ReboundFromLowPct = -1 },
		"lookback <5":        func(c *models.SignalRuleConfig) { c.ReboundLookbackDays = 4 },
		"lookback >120":      func(c *models.SignalRuleConfig) { c.ReboundLookbackDays = 121 },
		"yield exp <0":       func(c *models.SignalRuleConfig) { c.YieldExpansionPct = -1 },
		"time stop days <30": func(c *models.SignalRuleConfig) { c.TimeStopDays = 29 },
		"time stop days big": func(c *models.SignalRuleConfig) { c.TimeStopDays = 3651 },
		"short days <5":      func(c *models.SignalRuleConfig) { c.ShortDropDays = 4 },
		"short days >120":    func(c *models.SignalRuleConfig) { c.ShortDropDays = 121 },
		"short pct >0":       func(c *models.SignalRuleConfig) { c.ShortDropPct = 1 },
		"time stop ret NaN":  func(c *models.SignalRuleConfig) { c.TimeStopMaxReturnPct = math.NaN() },
	}
	for name, f := range bad {
		c := base()
		f(&c)
		if err := ValidateSignalRuleConfig(&c); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	// 0 은 기본값으로 보정
	c := base()
	c.ReboundFromLowPct, c.ReboundLookbackDays, c.YieldExpansionPct = 0, 0, 0
	c.TimeStopDays, c.ShortDropDays, c.ShortDropPct = 0, 0, 0
	c.YieldExpansionEnabled, c.ShortDropEnabled, c.ReboundConfirmEnabled = true, true, true
	if err := ValidateSignalRuleConfig(&c); err != nil || c.ReboundFromLowPct != 5 || c.ReboundLookbackDays != 20 ||
		c.YieldExpansionPct != 20 || c.TimeStopDays != 365 || c.ShortDropDays != 20 || c.ShortDropPct != -15 {
		t.Errorf("zero defaults %v %+v", err, c)
	}
	// 양수/음수 시간 손절 기준은 허용
	c = base()
	c.TimeStopMaxReturnPct = 7
	if err := ValidateSignalRuleConfig(&c); err != nil {
		t.Errorf("positive time stop max return: %v", err)
	}
}
