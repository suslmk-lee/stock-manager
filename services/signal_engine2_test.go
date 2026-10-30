package services

import (
	"testing"
	"time"

	"stock-manager/models"
)

// flatHistory 는 now 이전 n일 동안 close 로 고정된 일봉을 만든다. spike>0 이면 10일 전 종가를 spike 로 한다.
func flatHistory(n int, close, spike float64) []PricePoint {
	pts := make([]PricePoint, 0, n)
	for i := n; i >= 1; i-- {
		c := close
		if spike > 0 && i == 10 {
			c = spike
		}
		pts = append(pts, PricePoint{Time: sigNow.AddDate(0, 0, -i).Unix(), Close: c})
	}
	return pts
}

func ruleWith(f func(r *models.SignalRule)) models.SignalRule {
	r := noRules()
	f(&r)
	return r
}

func onlyCheck(t *testing.T, it SignalItem, code string) SignalCheck {
	t.Helper()
	for _, c := range append(append([]SignalCheck{}, it.SellChecks...), it.BuyChecks...) {
		if c.Code == code {
			return c
		}
	}
	t.Fatalf("check %s not listed: %+v %+v", code, it.SellChecks, it.BuyChecks)
	return SignalCheck{}
}

func TestPriceTrendChecks(t *testing.T) {
	rule := ruleWith(func(r *models.SignalRule) {
		r.FromHighEnabled, r.FromHighPct = true, -20
		r.BelowMAEnabled, r.BelowMAPct = true, -5
		r.AboveMAEnabled, r.AboveMAPct = true, 25
	})
	// 250일 100, 10일 전 고점 200. 현재가 90 -> 고점 대비 -55%, MA200 약 100.5 대비 약 -10%
	in := krwAsset(1, 90, 1, 100, rule)
	in.History = flatHistory(250, 100, 200)
	it := evalOne(t, in)
	if !it.PriceHistoryOK || !approx(it.High52w, 200) || !approx(it.Low52w, 100) || it.MA200 <= 0 {
		t.Fatalf("stats %+v", it)
	}
	if !approx(it.FromHighPct, (90.0/200-1)*100) || !approx(it.FromLowPct, -10) {
		t.Errorf("pct %v %v", it.FromHighPct, it.FromLowPct)
	}
	if c := onlyCheck(t, it, "from_high"); !c.Met || c.Threshold != -20 || !approx(c.Value, it.FromHighPct) {
		t.Errorf("from_high %+v", c)
	}
	if c := onlyCheck(t, it, "below_ma"); !c.Met || !approx(c.Value, it.VsMA200Pct) {
		t.Errorf("below_ma %+v", c)
	}
	if c := onlyCheck(t, it, "above_ma"); c.Met {
		t.Errorf("above_ma should be unmet %+v", c)
	}
	if it.Action != SignalBuy {
		t.Errorf("action %s", it.Action)
	}

	// 현재가 140 -> MA 대비 +39%: 과열
	in.Price = 140
	it = evalOne(t, in)
	if c := onlyCheck(t, it, "above_ma"); !c.Met || c.Threshold != 25 {
		t.Errorf("above_ma %+v", c)
	}

	// 이력 없음 / 부족(19점): 체크는 남기되 met=false, value 0
	for _, h := range [][]PricePoint{nil, flatHistory(19, 100, 0)} {
		in.History = h
		in.Price = 50
		it = evalOne(t, in)
		for _, code := range []string{"from_high", "below_ma", "above_ma"} {
			if c := onlyCheck(t, it, code); c.Met || c.Value != 0 {
				t.Errorf("%s with %d points: %+v", code, len(h), c)
			}
		}
		if it.PriceHistoryOK {
			t.Error("history must not be ok")
		}
	}
	// 60점: 고점은 있으나 MA200 없음
	in.History = flatHistory(60, 100, 0)
	it = evalOne(t, in)
	if !it.PriceHistoryOK || it.MA200 != 0 || onlyCheck(t, it, "below_ma").Met {
		t.Errorf("60 points: %+v", it)
	}
	if !onlyCheck(t, it, "from_high").Met { // 50 vs 100 -> -50%
		t.Error("from_high should be met with 60 points")
	}
}

func TestDividendCutCheck(t *testing.T) {
	rule := ruleWith(func(r *models.SignalRule) { r.DividendCutEnabled, r.DividendCutPct = true, 10 })
	in := krwAsset(1, 100, 10, 100, rule)
	in.Dividends = []SignalDividendInput{
		{AccountID: 1, Amount: 100, Date: sigNow.AddDate(0, 0, -30)},
		{AccountID: 1, Amount: 200, Date: sigNow.AddDate(0, 0, -400)},
	}
	it := evalOne(t, in)
	c := onlyCheck(t, it, "dividend_cut")
	if !it.DividendTrendOK || !approx(it.DPS12m, 10) || !approx(it.DPSPrev12m, 20) || !approx(it.DividendChangePct, -50) {
		t.Fatalf("trend %+v", it)
	}
	if !c.Met || !approx(c.Value, -50) || !approx(c.Threshold, -10) {
		t.Errorf("check %+v", c)
	}
	// 삭감폭이 임계 미만: -5%
	in.Dividends[0].Amount = 190
	if c := onlyCheck(t, evalOne(t, in), "dividend_cut"); c.Met {
		t.Errorf("-5%% must not trigger: %+v", c)
	}
	// 직전 12개월 데이터 없음 -> 판단 불가
	in.Dividends = in.Dividends[:1]
	it = evalOne(t, in)
	if c := onlyCheck(t, it, "dividend_cut"); c.Met || c.Value != 0 || it.DividendTrendOK {
		t.Errorf("unavailable %+v", c)
	}
	// 당시 보유 수량 역추적: 200일 전 5주 매수 -> 400일 전엔 10-5=5주
	in.Dividends = []SignalDividendInput{
		{AccountID: 1, Amount: 100, Date: sigNow.AddDate(0, 0, -30)},
		{AccountID: 1, Amount: 100, Date: sigNow.AddDate(0, 0, -400)},
	}
	in.Txns = []SignalTxnInput{{AccountID: 1, Type: models.TransactionTypeBuy, Date: sigNow.AddDate(0, 0, -200), Quantity: 5, Price: 100}}
	it = evalOne(t, in)
	if !it.DividendTrendOK || !approx(it.DPS12m, 10) || !approx(it.DPSPrev12m, 20) {
		t.Errorf("qty backtrace %+v", it)
	}
}

func usdAsset(rule models.SignalRule, qty float64) SignalAssetInput {
	return SignalAssetInput{
		AssetID: 1, Ticker: "AAPL", Name: "Apple", Price: 150, PriceCurrency: "USD",
		Holdings: []SignalHoldingInput{{AccountID: 1, AccountType: models.AccountTypeGeneral, Quantity: qty, AvgPrice: 100}},
		Txns:     []SignalTxnInput{{AccountID: 1, Type: models.TransactionTypeBuy, Date: sigNow.AddDate(-1, 0, 0), Quantity: 1, Price: 100}},
		Rule:     rule, RuleSource: "default",
	}
}

func TestReturnBasisAndFxEffect(t *testing.T) {
	flatFx := func(time.Time) float64 { return 1000 } // 매수 시점 환율 1000, 현재 1500
	ctx := SignalContext{FxAt: flatFx, FxOK: true}
	run := func(in SignalAssetInput, c SignalContext) SignalItem {
		return BuildSignalReport([]SignalAssetInput{in}, 1500, sigNow, c).Items[0]
	}
	tp := ruleWith(func(r *models.SignalRule) { r.TakeProfitEnabled, r.TakeProfitPct = true, 100; r.FxHistorical = true })

	it := run(usdAsset(tp, 1), ctx)
	// 현재 환율: MV 225000, cost 150000 -> 50%. 환율 반영: cost 100000 -> 125%
	if !approx(it.TotalReturnPct, 50) || !approx(it.TotalReturnPctFx, 125) || !approx(it.CostKRWFx, 100_000) {
		t.Fatalf("pcts %v %v %v", it.TotalReturnPct, it.TotalReturnPctFx, it.CostKRWFx)
	}
	if it.ReturnBasis != "fx" || it.Action != SignalSell {
		t.Errorf("basis %s action %s", it.ReturnBasis, it.Action)
	}
	if c := onlyCheck(t, it, "take_profit"); !c.Met || !approx(c.Value, 125) {
		t.Errorf("check %+v", c)
	}
	// 환율 상승 -> 환차익 양수: fx 총수익 125000 - 현재환율 총수익 75000
	if !approx(it.FxEffectKRW, 50_000) || !approx(it.FxCoveragePct, 100) {
		t.Errorf("effect %v coverage %v", it.FxEffectKRW, it.FxCoveragePct)
	}

	// fx_historical=false -> 현재 환율 기준으로 판단
	cur := tp
	cur.FxHistorical = false
	it = run(usdAsset(cur, 1), ctx)
	if it.ReturnBasis != "current" || it.Action != SignalHold || !approx(onlyCheck(t, it, "take_profit").Value, 50) {
		t.Errorf("current basis %+v", it)
	}
	// 환율 이력 없음 -> current
	it = run(usdAsset(tp, 1), SignalContext{})
	if it.ReturnBasis != "current" || it.Action != SignalHold || it.FxEffectKRW != 0 || !approx(it.TotalReturnPctFx, it.TotalReturnPct) {
		t.Errorf("no fx %+v", it)
	}
	// KRW 자산: current, fx 필드 = 현재 값
	it = run(krwAsset(1, 150, 1, 100, tp), ctx)
	if it.ReturnBasis != "current" || !approx(it.TotalReturnPctFx, it.TotalReturnPct) || it.FxEffectKRW != 0 || !approx(it.CostKRWFx, it.CostKRW) {
		t.Errorf("krw %+v", it)
	}
}

func TestFxCoverageWithSeededHolding(t *testing.T) {
	ctx := SignalContext{FxAt: func(time.Time) float64 { return 1000 }, FxOK: true}
	// 보유 2주, 거래 기록은 1주뿐 -> 나머지 1주는 현재 환율로 시드, 커버리지 50%
	in := usdAsset(ruleWith(func(r *models.SignalRule) { r.FxHistorical = true }), 2)
	it := BuildSignalReport([]SignalAssetInput{in}, 1500, sigNow, ctx).Items[0]
	if !approx(it.FxCoveragePct, 50) {
		t.Errorf("coverage %v", it.FxCoveragePct)
	}
	if !approx(it.CostKRWFx, 100*1000+100*1500) {
		t.Errorf("cost fx %v", it.CostKRWFx)
	}
}

func TestFxRealizedAndDividendAtEventRate(t *testing.T) {
	ctx := SignalContext{FxAt: func(time.Time) float64 { return 1200 }, FxOK: true}
	in := usdAsset(ruleWith(func(r *models.SignalRule) { r.FxHistorical = true }), 1)
	in.PnLs = []SignalPnLInput{{Date: sigNow.AddDate(0, -1, 0), Profit: 20, BuyAvgPrice: 100, Quantity: 1, Currency: "USD"}}
	in.Dividends = []SignalDividendInput{{AccountID: 1, Amount: 10, Tax: 1.5, Currency: "USD", Date: sigNow.AddDate(0, -2, 0)}}
	it := BuildSignalReport([]SignalAssetInput{in}, 1500, sigNow, ctx).Items[0]
	// 보유 원가 120000, 매도 원가 120000, 합 240000. total = 225000 - 120000 + 24000 + 10200 = 139200
	if !approx(it.CostKRWFx, 240_000) || !approx(it.TotalReturnPctFx, 139_200.0/240_000*100) {
		t.Errorf("%v %v", it.CostKRWFx, it.TotalReturnPctFx)
	}
	// 현재 환율 총수익: (225000-150000) + 30000 + 12750 = 117750
	if !approx(it.FxEffectKRW, 139_200-117_750) {
		t.Errorf("effect %v", it.FxEffectKRW)
	}
}

func TestTaxHint(t *testing.T) {
	sum := &TaxSummary{HarvestWindow: true, RemainingKRW: 1_000_000, ExemptionKRW: OverseasTaxExemptionKRW}
	ctx := SignalContext{Tax: sum}
	on := ruleWith(func(r *models.SignalRule) { r.TaxHarvestEnabled = true })
	run := func(in SignalAssetInput, c SignalContext) SignalItem {
		return BuildSignalReport([]SignalAssetInput{in}, 1500, sigNow, c).Items[0]
	}

	it := run(usdAsset(on, 1), ctx)
	if it.TaxHint == nil || it.TaxHint.Kind != "harvest_gain" || !approx(it.TaxHint.AmountKRW, 75_000) {
		t.Errorf("general usd: %+v", it.TaxHint)
	}
	if it := run(usdAsset(noRules(), 1), ctx); it.TaxHint != nil {
		t.Errorf("rule off: %+v", it.TaxHint)
	}
	isa := usdAsset(on, 1)
	isa.Holdings[0].AccountType = models.AccountTypeISA
	if it := run(isa, ctx); it.TaxHint != nil {
		t.Errorf("isa: %+v", it.TaxHint)
	}
	if it := run(krwAsset(1, 150, 1, 100, on), ctx); it.TaxHint != nil {
		t.Errorf("krw: %+v", it.TaxHint)
	}
	closed := &TaxSummary{HarvestWindow: false, RemainingKRW: 1_000_000}
	if it := run(usdAsset(on, 1), SignalContext{Tax: closed}); it.TaxHint != nil {
		t.Errorf("window: %+v", it.TaxHint)
	}
	loss := &TaxSummary{HarvestWindow: true, NetKRW: 5_000_000, ExemptionKRW: OverseasTaxExemptionKRW}
	l := usdAsset(on, 1)
	l.Price = 50
	if it := run(l, SignalContext{Tax: loss}); it.TaxHint == nil || it.TaxHint.Kind != "harvest_loss" {
		t.Errorf("loss: %+v", it.TaxHint)
	}
	if r := BuildSignalReport([]SignalAssetInput{usdAsset(on, 1)}, 1500, sigNow, ctx); r.Tax == nil || r.Tax.RemainingKRW != 1_000_000 {
		t.Errorf("report tax %+v", r.Tax)
	}
}
