package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

// histAt 은 sigNow 기준 -400..-1 일의 일봉을 만든다. base 는 기본 종가, spikes 는 {며칠 전: 종가} 덮어쓰기.
func histAt(base float64, spikes map[int]float64) []PricePoint {
	var pts []PricePoint
	for d := 400; d >= 1; d-- {
		c := base
		if v, ok := spikes[d]; ok {
			c = v
		}
		pts = append(pts, PricePoint{Time: sigNow.AddDate(0, 0, -d).Add(12 * time.Hour).Unix(), Close: c})
	}
	return pts
}

func buyTx(daysAgo int, qty float64) SignalTxnInput {
	return SignalTxnInput{AccountID: 1, Type: models.TransactionTypeBuy, Date: sigNow.AddDate(0, 0, -daysAgo), Quantity: qty, Price: 100}
}

func sellTx(daysAgo int, qty float64) SignalTxnInput {
	return SignalTxnInput{AccountID: 1, Type: models.TransactionTypeSell, Date: sigNow.AddDate(0, 0, -daysAgo), Quantity: qty, Price: 100}
}

func trailRule() models.SignalRuleConfig {
	r := noRules()
	r.TrailingEnabled, r.TrailingActivatePct, r.TrailingDropPct = true, 20, -10
	return r
}

func sellCheck(it SignalItem, code string) (SignalCheck, bool) {
	for _, c := range it.SellChecks {
		if c.Code == code {
			return c, true
		}
	}
	return SignalCheck{}, false
}

func TestTrailingStop(t *testing.T) {
	// 활성화 미달: 고점 수익률 10%
	in := krwAsset(1, 105, 10, 100, trailRule())
	in.History = histAt(100, map[int]float64{100: 110})
	in.Txns = []SignalTxnInput{buyTx(200, 10)}
	it := evalOne(t, in)
	if it.Action != SignalHold || it.PeakPrice != 110 || math.Abs(it.PeakGainPct-10) > 1e-9 {
		t.Errorf("not activated: %s peak=%v gain=%v", it.Action, it.PeakPrice, it.PeakGainPct)
	}

	// 활성화 + 되돌림 -16.9% -> SELL
	in = krwAsset(1, 108, 10, 100, trailRule())
	in.History = histAt(100, map[int]float64{100: 130})
	in.Txns = []SignalTxnInput{buyTx(200, 10)}
	it = evalOne(t, in)
	c, ok := sellCheck(it, "trailing_stop")
	if !ok || !c.Met || it.Action != SignalSell || c.Unit != "%" || c.Threshold != -10 {
		t.Fatalf("dropped: %s %+v", it.Action, c)
	}
	if it.PeakDate == "" || math.Abs(it.FromPeakPct-(108.0/130-1)*100) > 1e-9 {
		t.Errorf("peak info %+v", it)
	}

	// 활성화 + 되돌림 미달 -> HOLD
	in = krwAsset(1, 125, 10, 100, trailRule())
	in.History = histAt(100, map[int]float64{100: 130})
	in.Txns = []SignalTxnInput{buyTx(200, 10)}
	if it = evalOne(t, in); it.Action != SignalHold {
		t.Errorf("not dropped: %s", it.Action)
	}

	// 첫 매수 이전의 고점은 무시: 300일 전 200, 매수는 200일 전
	in = krwAsset(1, 108, 10, 100, trailRule())
	in.History = histAt(100, map[int]float64{300: 200, 100: 110})
	in.Txns = []SignalTxnInput{buyTx(200, 10)}
	if it = evalOne(t, in); it.Action != SignalHold || it.PeakPrice != 110 {
		t.Errorf("pre-buy peak must be ignored: %s peak=%v", it.Action, it.PeakPrice)
	}
	// 거래 정보가 없으면 전체 구간(폴백)
	in.Txns = nil
	if it = evalOne(t, in); it.Action != SignalSell || it.PeakPrice != 200 {
		t.Errorf("fallback: %s peak=%v", it.Action, it.PeakPrice)
	}

	// 현재가가 신고점이면 고점은 현재가
	in = krwAsset(1, 150, 10, 100, trailRule())
	in.History = histAt(100, nil)
	it = evalOne(t, in)
	if it.PeakPrice != 150 || it.FromPeakPct != 0 || it.Action != SignalHold {
		t.Errorf("current is peak: %+v", it)
	}
}

func TestAnnualizedFormula(t *testing.T) {
	if v := annualizedReturnPct(21, 365); math.Abs(v-21) > 1e-9 {
		t.Errorf("21%%/365d = %v", v)
	}
	if v := annualizedReturnPct(10, 182.5); math.Abs(v-21) > 1e-9 {
		t.Errorf("10%%/182.5d = %v", v)
	}
	if annualizedReturnPct(10, 0) != 0 || annualizedReturnPct(-100, 100) != -100 || annualizedReturnPct(-150, 100) != -100 {
		t.Error("guards")
	}
	if v := annualizedReturnPct(500, 1); v != annualizedCapPct {
		t.Errorf("cap %v", v)
	}
	if v := annualizedReturnPct(math.NaN(), 100); v != 0 {
		t.Errorf("nan %v", v)
	}
}

func TestHoldingDaysFIFO(t *testing.T) {
	// 300일 전 100주, 100일 전 100주, 50일 전 100주 매도 -> 오래된 로트 소진, 남은 100주는 100일
	holdings := []SignalHoldingInput{{AccountID: 1, Quantity: 100}}
	lots := heldLotsFIFO([]SignalTxnInput{buyTx(300, 100), buyTx(100, 100), sellTx(50, 100)}, holdings)
	if d := weightedHoldingDays(lots, sigNow); math.Abs(d-100) > 1e-9 {
		t.Errorf("days=%v", d)
	}
	// 부분 매도: 50@300 + 100@100 -> (50*300+100*100)/150
	holdings = []SignalHoldingInput{{AccountID: 1, Quantity: 150}}
	lots = heldLotsFIFO([]SignalTxnInput{buyTx(300, 100), buyTx(100, 100), sellTx(50, 50)}, holdings)
	if d := weightedHoldingDays(lots, sigNow); math.Abs(d-(50.0*300+100*100)/150) > 1e-9 {
		t.Errorf("days=%v", d)
	}
	// 거래가 설명하지 못하는 수량은 평균에서 제외
	holdings = []SignalHoldingInput{{AccountID: 1, Quantity: 200}}
	lots = heldLotsFIFO([]SignalTxnInput{buyTx(40, 100)}, holdings)
	if d := weightedHoldingDays(lots, sigNow); math.Abs(d-40) > 1e-9 {
		t.Errorf("uncovered days=%v", d)
	}
	if weightedHoldingDays(heldLotsFIFO(nil, holdings), sigNow) != 0 {
		t.Error("no txns -> 0")
	}
}

func TestAnnualizedCheckGates(t *testing.T) {
	mk := func(mod func(r *models.SignalRuleConfig)) SignalItem {
		r := noRules()
		r.AnnualizedEnabled, r.AnnualizedPct, r.AnnualizedMinDays, r.AnnualizedMinReturnPct = true, 25, 90, 15
		mod(&r)
		in := krwAsset(1, 130, 100, 100, r)
		in.Txns = []SignalTxnInput{buyTx(300, 100), buyTx(100, 100), sellTx(50, 100)}
		return evalOne(t, in)
	}
	it := mk(func(*models.SignalRuleConfig) {})
	c, ok := sellCheck(it, "annualized_return")
	want := (math.Pow(1.3, 365.0/100) - 1) * 100
	if !ok || !c.Met || it.HoldingDays != 100 || math.Abs(it.AnnualizedReturnPct-want) > 1e-6 || it.Action != SignalSell {
		t.Fatalf("base %+v days=%d ann=%v", c, it.HoldingDays, it.AnnualizedReturnPct)
	}
	if c, _ := sellCheck(mk(func(r *models.SignalRuleConfig) { r.AnnualizedMinDays = 120 }), "annualized_return"); c.Met {
		t.Error("min days gate")
	}
	if c, _ := sellCheck(mk(func(r *models.SignalRuleConfig) { r.AnnualizedMinReturnPct = 40 }), "annualized_return"); c.Met {
		t.Error("min return gate")
	}
	if c, _ := sellCheck(mk(func(r *models.SignalRuleConfig) { r.AnnualizedPct = 5000 }), "annualized_return"); c.Met {
		t.Error("threshold")
	}
	// 규칙이 꺼져 있어도 지표는 채워진다
	it = mk(func(r *models.SignalRuleConfig) { r.AnnualizedEnabled = false })
	if it.HoldingDays != 100 || it.AnnualizedReturnPct <= 0 || len(it.SellChecks) != 0 {
		t.Errorf("off: %+v", it)
	}
}

func driftRule() models.SignalRuleConfig {
	r := noRules()
	r.DriftEnabled, r.DriftPct = true, 7
	r.PartialEnabled, r.PartialPct = true, 33
	return r
}

func TestWeightDriftAndRebalanceSuggestion(t *testing.T) {
	a := krwAsset(1, 200, 10, 100, driftRule()) // 시가 2000, 원가 1000
	b := krwAsset(2, 100, 10, 100, driftRule()) // 시가 1000, 원가 1000
	r := BuildSignalReport([]SignalAssetInput{a, b}, 1000, sigNow, SignalContext{})
	got := map[uint]SignalItem{}
	for _, it := range r.Items {
		got[it.AssetID] = it
	}
	ia, ib := got[1], got[2]
	if math.Abs(ia.CostWeightPct-50) > 1e-9 || math.Abs(ib.CostWeightPct-50) > 1e-9 {
		t.Errorf("cost weights %v %v", ia.CostWeightPct, ib.CostWeightPct)
	}
	c, _ := sellCheck(ia, "weight_drift")
	if !c.Met || c.Unit != "%p" || math.Abs(c.Value-(200.0/3-50)) > 1e-9 || ia.Action != SignalSell {
		t.Errorf("A drift %+v action=%s", c, ia.Action)
	}
	if c, _ := sellCheck(ib, "weight_drift"); c.Met || ib.Action != SignalHold {
		t.Errorf("B must not trigger: %+v %s", c, ib.Action)
	}
	// floor((66.67-50)/100 * 3000 / 200) = floor(2.5) = 2
	if ia.SuggestedSellKind != "rebalance" || ia.SuggestedSellQty != 2 || ia.SuggestedSellKRW != 400 {
		t.Errorf("rebalance suggestion %+v", ia)
	}
	if ib.SuggestedSellQty != 0 || ib.SuggestedSellKind != "" {
		t.Errorf("B suggestion %+v", ib)
	}
}

func TestPartialSuggestion(t *testing.T) {
	tp := func() models.SignalRuleConfig {
		r := noRules()
		r.TakeProfitEnabled, r.TakeProfitPct = true, 30
		r.PartialEnabled, r.PartialPct = true, 33
		return r
	}
	// 이익 실현 신호만: floor(10*0.33)=3
	it := evalOne(t, krwAsset(1, 150, 10, 100, tp()))
	if it.Action != SignalSell || it.SuggestedSellKind != "partial" || it.SuggestedSellQty != 3 || it.SuggestedSellKRW != 450 {
		t.Errorf("partial %+v", it)
	}
	if s := sellSuggestionSuffix(it); s != " · 분할 익절 검토 3주" {
		t.Errorf("suffix %q", s)
	}

	// 분할 매도 꺼짐 -> 제안 없음
	r := tp()
	r.PartialEnabled = false
	if it = evalOne(t, krwAsset(1, 150, 10, 100, r)); it.SuggestedSellQty != 0 {
		t.Errorf("partial off %+v", it)
	}

	// 위험 신호(배당수익률 하락)가 함께 충족되면 제안 없음
	r = tp()
	r.LowYieldEnabled, r.LowYieldPct = true, 2
	in := krwAsset(1, 150, 10, 100, r)
	in.Dividends = []SignalDividendInput{{AccountID: 1, Amount: 1, Currency: "KRW", Date: sigNow.AddDate(0, 0, -30)}}
	it = evalOne(t, in)
	if it.Action != SignalSell || it.SuggestedSellQty != 0 || it.SuggestedSellKind != "" {
		t.Errorf("risk signal must suppress: %+v", it)
	}

	// 소량 보유 기준 상한: 4주, 100% -> 남는 수량이 1주를 초과해야 하므로 최대 2주
	r = tp()
	r.PartialPct = 100
	r.MinSellQtyEnabled, r.MinSellQty = true, 1
	if it = evalOne(t, krwAsset(1, 150, 4, 100, r)); it.SuggestedSellQty != 2 {
		t.Errorf("cap %+v", it)
	}
	// 상한 때문에 0 이하가 되면 제안 없음 (2주 보유, 남기면 >1주 불가)
	if it = evalOne(t, krwAsset(1, 150, 2, 100, r)); it.Action != SignalSell || it.SuggestedSellQty != 0 {
		t.Errorf("cap zero %+v", it)
	}

	// 소수 보유: floor(2.5*0.33)=0 -> 제안 없음
	if it = evalOne(t, krwAsset(1, 150, 2.5, 100, tp())); it.Action != SignalSell || it.SuggestedSellQty != 0 {
		t.Errorf("fractional %+v", it)
	}
}

func TestAlertMessageSuffix(t *testing.T) {
	r := noRules()
	r.TakeProfitEnabled, r.TakeProfitPct = true, 30
	r.PartialEnabled, r.PartialPct = true, 33
	it := evalOne(t, krwAsset(1, 150, 10, 100, r))
	evs, _ := DiffSignals([]SignalItem{it}, nil, false, models.NotificationSetting{}, sigNow)
	if len(evs) != 1 || evs[0].Message != "매도 검토로 전환 · 목표 수익률 · 분할 익절 검토 3주" {
		t.Errorf("%+v", evs)
	}
}

func TestMigrateV4ToV5(t *testing.T) {
	std := models.DefaultSignalRuleConfig()
	std.TrailingEnabled, std.TrailingActivatePct, std.TrailingDropPct = false, 0, 0
	std.AnnualizedEnabled, std.AnnualizedMinDays, std.AnnualizedPct, std.AnnualizedMinReturnPct = true, 0, 0, 0
	std.DriftEnabled, std.DriftPct, std.PartialEnabled, std.PartialPct = true, 0, false, 0
	r := models.SignalRule{SignalRuleConfig: std, RuleVersion: 4}
	if !migrateSignalRule(&r) || r.RuleVersion != models.SignalRuleVersion {
		t.Fatalf("not migrated %+v", r)
	}
	c := r.SignalRuleConfig
	if !c.TrailingEnabled || c.TrailingActivatePct != 20 || c.TrailingDropPct != -10 || c.AnnualizedEnabled || c.AnnualizedMinDays != 90 ||
		c.AnnualizedPct != 25 || c.AnnualizedMinReturnPct != 15 || c.DriftEnabled || c.DriftPct != 7 || !c.PartialEnabled || c.PartialPct != 33 {
		t.Errorf("standard %+v", c)
	}
	// 익절/손절이 모두 꺼진 규칙은 트레일링이 꺼진 채 유지
	div := models.DividendSignalRuleConfig()
	div.TrailingEnabled = true
	div.TrailingDropPct = 0
	r = models.SignalRule{SignalRuleConfig: div, RuleVersion: 4}
	migrateSignalRule(&r)
	if r.TrailingEnabled || r.TrailingDropPct != -10 {
		t.Errorf("dividend-style %+v", r.SignalRuleConfig)
	}
	// 이미 v5 면 건드리지 않는다
	r = models.SignalRule{SignalRuleConfig: models.SignalRuleConfig{}, RuleVersion: models.SignalRuleVersion}
	if migrateSignalRule(&r) || r.TrailingEnabled {
		t.Error("must not re-migrate")
	}
	if models.DividendSignalRuleConfig().TrailingEnabled || !models.DefaultSignalRuleConfig().TrailingEnabled {
		t.Error("defaults")
	}
}

func TestProfileMigrationToV5(t *testing.T) {
	svc, db := newProfileSvc(t)
	if _, err := svc.GetSignalProfiles(); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.SignalProfile{}).Where("1 = 1").Updates(map[string]interface{}{
		"rule_version": 4, "rule_trailing_enabled": false, "rule_trailing_activate_pct": 0, "rule_trailing_drop_pct": 0,
		"rule_annualized_min_days": 0, "rule_partial_enabled": false, "rule_partial_pct": 0, "rule_drift_pct": 0,
	}).Error; err != nil {
		t.Fatal(err)
	}
	res, err := NewSignalService(db, nil, nil).GetSignalProfiles()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, p := range res.Profiles {
		r := p.Rule
		seen[p.Key] = true
		wantTrail := r.TakeProfitEnabled || r.StopLossEnabled
		if r.TrailingEnabled != wantTrail || r.TrailingDropPct != -10 || r.AnnualizedMinDays != 90 || !r.PartialEnabled || r.PartialPct != 33 || r.DriftPct != 7 {
			t.Errorf("profile %s not migrated: %+v", p.Key, r)
		}
		if p.Key == models.ProfileKeyDividend && r.TrailingEnabled {
			t.Error("dividend profile must stay off")
		}
		if p.Key == models.ProfileKeyDefault && !r.TrailingEnabled {
			t.Error("default profile must have trailing on")
		}
	}
	if !seen[models.ProfileKeyDefault] || !seen[models.ProfileKeyDividend] {
		t.Errorf("profiles %v", seen)
	}
}

func TestValidateProfitRuleFields(t *testing.T) {
	bad := map[string]func(r *models.SignalRuleConfig){
		"trailing activate": func(r *models.SignalRuleConfig) { r.TrailingActivatePct = -1 },
		"trailing drop +":   func(r *models.SignalRuleConfig) { r.TrailingDropPct = 5 },
		"trailing drop 0":   func(r *models.SignalRuleConfig) { r.TrailingEnabled, r.TrailingDropPct = true, 0 },
		"annualized pct":    func(r *models.SignalRuleConfig) { r.AnnualizedPct = -1 },
		"annualized ret":    func(r *models.SignalRuleConfig) { r.AnnualizedMinReturnPct = -1 },
		"min days neg":      func(r *models.SignalRuleConfig) { r.AnnualizedMinDays = -1 },
		"min days big":      func(r *models.SignalRuleConfig) { r.AnnualizedMinDays = 3651 },
		"drift neg":         func(r *models.SignalRuleConfig) { r.DriftPct = -1 },
		"drift zero on":     func(r *models.SignalRuleConfig) { r.DriftEnabled, r.DriftPct = true, 0 },
		"partial big":       func(r *models.SignalRuleConfig) { r.PartialPct = 101 },
		"partial neg":       func(r *models.SignalRuleConfig) { r.PartialPct = -5 },
		"nan":               func(r *models.SignalRuleConfig) { r.PartialPct = math.NaN() },
		"inf":               func(r *models.SignalRuleConfig) { r.TrailingActivatePct = math.Inf(1) },
	}
	for name, mod := range bad {
		r := models.DefaultSignalRuleConfig()
		mod(&r)
		if err := ValidateSignalRuleConfig(&r); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	r := models.DefaultSignalRuleConfig()
	r.AnnualizedMinDays, r.PartialPct = 0, 0
	if err := ValidateSignalRuleConfig(&r); err != nil || r.AnnualizedMinDays != 90 || r.PartialPct != 33 {
		t.Errorf("normalize %v %+v", err, r)
	}
	r = models.DefaultSignalRuleConfig()
	r.TrailingEnabled, r.TrailingDropPct = false, 0
	if err := ValidateSignalRuleConfig(&r); err != nil {
		t.Errorf("drop 0 allowed when disabled: %v", err)
	}
}
