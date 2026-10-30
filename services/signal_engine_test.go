package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

var sigNow = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

func approx(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func noRules() models.SignalRule { return models.SignalRule{SellMode: "any", BuyMode: "any"} }

func krwAsset(id uint, price, qty, avg float64, rule models.SignalRule) SignalAssetInput {
	return SignalAssetInput{
		AssetID: id, Ticker: "005930.KS", Name: "삼성", Price: price, PriceCurrency: "KRW",
		Holdings: []SignalHoldingInput{{AccountID: 1, AccountType: models.AccountTypeGeneral, Quantity: qty, AvgPrice: avg}},
		Rule:     rule, RuleSource: "default",
	}
}

func evalOne(t *testing.T, in SignalAssetInput) SignalItem {
	t.Helper()
	r := BuildSignalReport([]SignalAssetInput{in}, 1000, sigNow, SignalContext{})
	if len(r.Items) != 1 {
		t.Fatalf("items=%d", len(r.Items))
	}
	return r.Items[0]
}

func TestAggregationAndCurrencyConversion(t *testing.T) {
	in := SignalAssetInput{
		AssetID: 1, Ticker: "AAPL", Name: "Apple", Price: 150, PriceCurrency: "USD",
		Holdings: []SignalHoldingInput{
			{AccountID: 1, AccountType: models.AccountTypeGeneral, Quantity: 10, AvgPrice: 100},
			{AccountID: 2, AccountType: models.AccountTypeISA, Quantity: 10, AvgPrice: 120},
		},
		PnLs: []SignalPnLInput{
			{Profit: 50, BuyAvgPrice: 100, Quantity: 5, Currency: "USD"},
			{Profit: 10000, BuyAvgPrice: 1000, Quantity: 10, Currency: "KRW"},
		},
		Dividends: []SignalDividendInput{
			{Amount: 10, Tax: 1.5, Currency: "USD", Date: sigNow.AddDate(0, 0, -30)},
			{Amount: 5000, Tax: 700, Currency: "KRW", Date: sigNow.AddDate(0, 0, -400)},
		},
		Rule: noRules(),
	}
	it := evalOne(t, in)
	// costHolding = 10*100+10*120 = 2200 USD -> 2,200,000 KRW; qty 20; avg 110
	// MV = 20*150 = 3000 USD -> 3,000,000
	// realized = 50 USD*1000 + 10000 = 60000; costSold = 500*1000 + 10000 = 510000
	// dividends = 8.5*1000 + 4300 = 12800; 12m = 8500
	if !approx(it.Quantity, 20) || !approx(it.AvgPrice, 110) {
		t.Errorf("qty/avg %v %v", it.Quantity, it.AvgPrice)
	}
	if !approx(it.MarketValueKRW, 3_000_000) {
		t.Errorf("mv %v", it.MarketValueKRW)
	}
	if !approx(it.CostKRW, 2_710_000) {
		t.Errorf("cost %v", it.CostKRW)
	}
	if !approx(it.DividendsKRW, 12800) || !approx(it.Dividends12mKRW, 8500) {
		t.Errorf("div %v %v", it.DividendsKRW, it.Dividends12mKRW)
	}
	total := 800_000.0 + 60_000 + 12_800
	if !approx(it.TotalReturnKRW, total) || !approx(it.TotalReturnPct, total/2_710_000*100) {
		t.Errorf("total %v %v", it.TotalReturnKRW, it.TotalReturnPct)
	}
	if !approx(it.UnrealizedPct, 800_000.0/2_200_000*100) {
		t.Errorf("unrealized %v", it.UnrealizedPct)
	}
	if !approx(it.DividendPayback, 12800.0/2_710_000*100) {
		t.Errorf("payback %v", it.DividendPayback)
	}
	if !approx(it.CurrentYieldPct, 8500.0/3_000_000*100) || !approx(it.YieldOnCostPct, 8500.0/2_200_000*100) {
		t.Errorf("yields %v %v", it.CurrentYieldPct, it.YieldOnCostPct)
	}
	if !approx(it.FromAvgPct, (150.0-110)/110*100) {
		t.Errorf("fromAvg %v", it.FromAvgPct)
	}
	if !approx(it.WeightPct, 100) {
		t.Errorf("weight %v", it.WeightPct)
	}
	if len(it.Accounts) != 2 || !approx(it.Accounts[0].MarketValueKRW, 1_500_000) || it.RestrictedOnly {
		t.Errorf("accounts %+v", it.Accounts)
	}
	if it.Currency != "USD" || it.RuleSource != "default" {
		t.Errorf("meta %v %v", it.Currency, it.RuleSource)
	}
}

func TestCurrencyFallbackByTicker(t *testing.T) {
	if CurrencyForTicker("005930.ks") != "KRW" || CurrencyForTicker("035720.KQ") != "KRW" || CurrencyForTicker("AAPL") != "USD" {
		t.Error("fallback")
	}
	in := krwAsset(1, 100, 1, 100, noRules())
	in.PriceCurrency = ""
	in.Dividends = []SignalDividendInput{{Amount: 100, Currency: "", Date: sigNow}}
	it := evalOne(t, in)
	if it.Currency != "KRW" || !approx(it.DividendsKRW, 100) || !approx(it.MarketValueKRW, 100) {
		t.Errorf("%+v", it)
	}
}

func TestRuleBoundaries(t *testing.T) {
	// avg 100, qty 1: price p => total_return_pct = p-100 (percent), from_avg = p-100
	tests := []struct {
		name  string
		rule  models.SignalRule
		price float64
		want  string
		code  string
		met   bool
	}{
		{"tp at boundary", models.SignalRule{TakeProfitEnabled: true, TakeProfitPct: 30}, 130, SignalSell, "take_profit", true},
		{"tp below", models.SignalRule{TakeProfitEnabled: true, TakeProfitPct: 30}, 129.99, SignalHold, "take_profit", false},
		{"sl at boundary", models.SignalRule{StopLossEnabled: true, StopLossPct: -20}, 80, SignalSell, "stop_loss", true},
		{"sl above", models.SignalRule{StopLossEnabled: true, StopLossPct: -20}, 80.01, SignalHold, "stop_loss", false},
		{"dip at boundary", models.SignalRule{BuyDipEnabled: true, BuyDipPct: -10}, 90, SignalBuy, "buy_dip", true},
		{"dip above", models.SignalRule{BuyDipEnabled: true, BuyDipPct: -10}, 90.01, SignalHold, "buy_dip", false},
		{"payback ok", models.SignalRule{DividendPaybackEnabled: true, DividendPaybackPct: 0, DividendPaybackMinReturnPct: 10}, 110, SignalSell, "dividend_payback", true},
		{"payback min return unmet", models.SignalRule{DividendPaybackEnabled: true, DividendPaybackPct: 0, DividendPaybackMinReturnPct: 10}, 109, SignalHold, "dividend_payback", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.rule.SellMode, tt.rule.BuyMode = "any", "any"
			it := evalOne(t, krwAsset(1, tt.price, 1, 100, tt.rule))
			if it.Action != tt.want {
				t.Errorf("action %s want %s (ret %v)", it.Action, tt.want, it.TotalReturnPct)
			}
			all := append(append([]SignalCheck{}, it.SellChecks...), it.BuyChecks...)
			if len(all) != 1 || all[0].Code != tt.code || all[0].Met != tt.met {
				t.Errorf("checks %+v", all)
			}
		})
	}
}

func TestDividendPaybackThreshold(t *testing.T) {
	rule := models.SignalRule{DividendPaybackEnabled: true, DividendPaybackPct: 50, DividendPaybackMinReturnPct: 0, SellMode: "any", BuyMode: "any"}
	in := krwAsset(1, 100, 1, 100, rule)
	in.Dividends = []SignalDividendInput{{Amount: 50, Date: sigNow}}
	// cost 100, dividends 50 => 50%
	it := evalOne(t, in)
	if it.Action != SignalSell || !approx(it.DividendPayback, 50) {
		t.Errorf("%s %v", it.Action, it.DividendPayback)
	}
	in.Dividends[0].Amount = 49
	if it := evalOne(t, in); it.Action != SignalHold {
		t.Errorf("%s", it.Action)
	}
}

func TestLowAndHighYield(t *testing.T) {
	low := models.SignalRule{LowYieldEnabled: true, LowYieldPct: 2, SellMode: "any", BuyMode: "any"}
	in := krwAsset(1, 100, 10, 100, low) // MV 1000
	// no dividends in 12m -> not met
	in.Dividends = []SignalDividendInput{{Amount: 5, Date: sigNow.AddDate(-2, 0, 0)}}
	it := evalOne(t, in)
	if it.Action != SignalHold || it.SellChecks[0].Met {
		t.Errorf("no 12m dividend must not be met: %+v", it.SellChecks)
	}
	in.Dividends = []SignalDividendInput{{Amount: 20, Date: sigNow.AddDate(0, 0, -10)}} // 2%
	if it := evalOne(t, in); it.Action != SignalSell {
		t.Errorf("2%% <= 2%% should be met: %v", it.CurrentYieldPct)
	}
	in.Dividends[0].Amount = 21
	if it := evalOne(t, in); it.Action != SignalHold {
		t.Errorf("2.1%% should not be met")
	}

	high := models.SignalRule{HighYieldEnabled: true, HighYieldPct: 5, SellMode: "any", BuyMode: "any"}
	in = krwAsset(1, 100, 10, 100, high)
	in.Dividends = []SignalDividendInput{{Amount: 50, Date: sigNow}}
	if it := evalOne(t, in); it.Action != SignalBuy {
		t.Errorf("5%% >= 5%% should be buy")
	}
	in.Dividends[0].Amount = 49
	if it := evalOne(t, in); it.Action != SignalHold {
		t.Errorf("4.9%% should hold")
	}
}

func TestWeightRules(t *testing.T) {
	rule := models.SignalRule{WeightEnabled: true, TargetWeightPct: 50, WeightBandPct: 10, SellMode: "any", BuyMode: "any"}
	mk := func(a, b float64) []SignalAssetInput {
		x := krwAsset(1, a, 1, a, rule)
		y := krwAsset(2, b, 1, b, rule)
		y.Ticker = "000660.KS"
		return []SignalAssetInput{x, y}
	}
	find := func(r SignalReport, id uint) SignalItem {
		for _, it := range r.Items {
			if it.AssetID == id {
				return it
			}
		}
		t.Fatal("missing")
		return SignalItem{}
	}
	r := BuildSignalReport(mk(60, 40), 1000, sigNow, SignalContext{}) // 60 >= 60 -> sell; 40 <= 40 -> buy
	if find(r, 1).Action != SignalSell || find(r, 2).Action != SignalBuy {
		t.Errorf("%+v", r.Summary)
	}
	if th := find(r, 1).SellChecks[0].Threshold; !approx(th, 60) {
		t.Errorf("threshold %v", th)
	}
	r = BuildSignalReport(mk(59, 41), 1000, sigNow, SignalContext{})
	if find(r, 1).Action != SignalHold || find(r, 2).Action != SignalHold {
		t.Errorf("%+v", r.Summary)
	}
	// target 0 -> no weight checks
	rule.TargetWeightPct = 0
	r = BuildSignalReport(mk(60, 40), 1000, sigNow, SignalContext{})
	if len(find(r, 1).SellChecks)+len(find(r, 1).BuyChecks) != 0 {
		t.Error("target 0 should disable")
	}
}

func TestModesAndConflict(t *testing.T) {
	// price 130, avg 100: tp(30) met, stop_loss(-20) unmet; buy_dip(-10) unmet
	rule := models.SignalRule{TakeProfitEnabled: true, TakeProfitPct: 30, StopLossEnabled: true, StopLossPct: -20, SellMode: "any", BuyMode: "any"}
	if it := evalOne(t, krwAsset(1, 130, 1, 100, rule)); it.Action != SignalSell {
		t.Errorf("any: %s", it.Action)
	}
	rule.SellMode = "all"
	if it := evalOne(t, krwAsset(1, 130, 1, 100, rule)); it.Action != SignalHold {
		t.Errorf("all: %s", it.Action)
	}
	rule.StopLossPct = 0 // 30 <= 0 false still
	// all enabled and met
	rule2 := models.SignalRule{TakeProfitEnabled: true, TakeProfitPct: 30, DividendPaybackEnabled: true, DividendPaybackPct: 0, DividendPaybackMinReturnPct: 0, SellMode: "all", BuyMode: "any"}
	if it := evalOne(t, krwAsset(1, 130, 1, 100, rule2)); it.Action != SignalSell {
		t.Errorf("all met: %s", it.Action)
	}
	// nothing enabled with all mode -> hold
	if it := evalOne(t, krwAsset(1, 130, 1, 100, models.SignalRule{SellMode: "all", BuyMode: "all"})); it.Action != SignalHold {
		t.Errorf("empty all: %s", it.Action)
	}
	// buy all mode
	buyAll := models.SignalRule{BuyDipEnabled: true, BuyDipPct: -10, HighYieldEnabled: true, HighYieldPct: 5, SellMode: "any", BuyMode: "all"}
	if it := evalOne(t, krwAsset(1, 80, 1, 100, buyAll)); it.Action != SignalHold {
		t.Errorf("buy all unmet yield: %s", it.Action)
	}
	// conflict: stop_loss and buy_dip both met at price 80
	c := models.SignalRule{StopLossEnabled: true, StopLossPct: -20, BuyDipEnabled: true, BuyDipPct: -10, SellMode: "any", BuyMode: "any"}
	r := BuildSignalReport([]SignalAssetInput{krwAsset(1, 80, 1, 100, c)}, 1000, sigNow, SignalContext{})
	if r.Items[0].Action != SignalConflict || r.Summary.Conflict != 1 {
		t.Errorf("%+v", r)
	}
}

func TestNoPriceAndGuards(t *testing.T) {
	rule := models.DefaultSignalRule()
	in := krwAsset(1, 0, 5, 100, rule)
	in.Dividends = []SignalDividendInput{{Amount: 10, Date: sigNow}}
	other := krwAsset(2, 100, 1, 100, noRules())
	r := BuildSignalReport([]SignalAssetInput{in, other}, 1000, sigNow, SignalContext{})
	if r.Summary.NoPrice != 1 || r.Summary.Hold != 1 {
		t.Errorf("%+v", r.Summary)
	}
	np := r.Items[1]
	if np.Action != SignalNoPrice || len(np.SellChecks) != 0 || len(np.BuyChecks) != 0 || np.WeightPct != 0 {
		t.Errorf("%+v", np)
	}
	if r.Items[0].AssetID != 2 || !approx(r.Items[0].WeightPct, 100) {
		t.Errorf("weight must exclude no-price: %+v", r.Items[0])
	}

	// zero cost / zero avg guards
	z := krwAsset(3, 100, 1, 0, models.DefaultSignalRule())
	it := evalOne(t, z)
	if math.IsNaN(it.TotalReturnPct) || math.IsInf(it.TotalReturnPct, 0) || it.FromAvgPct != 0 || it.UnrealizedPct != 0 {
		t.Errorf("guards %+v", it)
	}
	// zero quantity excluded
	q := krwAsset(4, 100, 0, 100, noRules())
	if r := BuildSignalReport([]SignalAssetInput{q}, 1000, sigNow, SignalContext{}); len(r.Items) != 0 {
		t.Error("qty 0 should be excluded")
	}
}

func TestRestrictedOnly(t *testing.T) {
	in := krwAsset(1, 100, 1, 100, noRules())
	in.Holdings = []SignalHoldingInput{
		{AccountID: 1, AccountType: models.AccountTypeIRP, Quantity: 1, AvgPrice: 100},
		{AccountID: 2, AccountType: models.AccountTypePension, Quantity: 1, AvgPrice: 100},
	}
	if it := evalOne(t, in); !it.RestrictedOnly || !it.Accounts[0].Restricted {
		t.Error("expected restricted only")
	}
	in.Holdings = append(in.Holdings, SignalHoldingInput{AccountID: 3, AccountType: models.AccountTypeGeneral, Quantity: 1, AvgPrice: 100})
	if it := evalOne(t, in); it.RestrictedOnly {
		t.Error("mixed must not be restricted only")
	}
}

func TestRuleSourceAndSorting(t *testing.T) {
	tp := models.SignalRule{TakeProfitEnabled: true, TakeProfitPct: 10, SellMode: "any", BuyMode: "any"}
	a := krwAsset(1, 100, 1, 100, noRules()) // hold, small
	b := krwAsset(2, 120, 1, 100, tp)        // sell via override
	b.RuleSource = "asset"
	c := krwAsset(3, 120, 100, 100, tp)    // sell, bigger MV
	d := krwAsset(4, 0, 1, 100, noRules()) // no price
	r := BuildSignalReport([]SignalAssetInput{d, a, b, c}, 1000, sigNow, SignalContext{})
	got := []uint{}
	for _, it := range r.Items {
		got = append(got, it.AssetID)
	}
	want := []uint{3, 2, 1, 4}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order %v want %v", got, want)
		}
	}
	if r.Items[1].RuleSource != "asset" || r.Items[0].RuleSource != "default" {
		t.Error("rule source")
	}
	if r.USDKRW != 1000 || r.GeneratedAt != sigNow.Format(time.RFC3339) {
		t.Error("meta")
	}
}
