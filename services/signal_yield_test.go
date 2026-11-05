package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

// flatCloses 는 sigNow 기준 -days..-1 일의 일봉을 같은 종가로 만든다.
func flatCloses(days int, price float64) []PricePoint {
	var pts []PricePoint
	for d := days; d >= 1; d-- {
		pts = append(pts, PricePoint{Time: sigNow.AddDate(0, 0, -d).Add(12 * time.Hour).Unix(), Close: price})
	}
	return pts
}

// monthlyEvents 는 매월 15일(UTC)에 amount 를 지급하는 이벤트를 firstY/firstM 부터 2026-05 까지 만든다.
func monthlyEvents(firstY int, firstM time.Month, amount float64) []DivPerShare {
	var out []DivPerShare
	for d := time.Date(firstY, firstM, 15, 0, 0, 0, 0, time.UTC); d.Before(sigNow); d = d.AddDate(0, 1, 0) {
		out = append(out, DivPerShare{Date: d, Amount: amount})
	}
	return out
}

func toMarket(evs []DivPerShare) []DividendEvent {
	out := make([]DividendEvent, 0, len(evs))
	for _, e := range evs {
		out = append(out, DividendEvent{Time: e.Date.Unix(), Amount: e.Amount})
	}
	return out
}

func TestYieldCompressionWindows(t *testing.T) {
	closes := flatCloses(800, 100)

	// 충분한 이력(5년 월배당 0.5, 주가 100 고정): 월말 24개 지점, 평균 = 현재 = 6%
	yc := YieldCompressionOf(monthlyEvents(2021, 6, 0.5), closes, 100, sigNow)
	if !yc.OK || yc.Points != 24 || !approx(yc.AvgPct, 6) || !approx(yc.CurrentPct, 6) || !approx(yc.VsAvgPct, 0) {
		t.Errorf("full history %+v", yc)
	}
	// 현재가가 2배 -> 현재 수익률 3%, 평균 대비 -50%
	yc = YieldCompressionOf(monthlyEvents(2021, 6, 0.5), closes, 200, sigNow)
	if !yc.OK || !approx(yc.CurrentPct, 3) || !approx(yc.VsAvgPct, -50) {
		t.Errorf("doubled price %+v", yc)
	}

	// 첫 배당 2024-11: 12개월 창이 이력 안에 드는 월말(2025-10 ~ 2026-05)만 -> 8개
	yc = YieldCompressionOf(monthlyEvents(2024, 11, 0.5), closes, 100, sigNow)
	if !yc.OK || yc.Points != 8 {
		t.Errorf("partial history %+v", yc)
	}

	// 첫 배당 2025-02 -> 5개 지점 (< 6) -> 계산 불가
	yc = YieldCompressionOf(monthlyEvents(2025, 2, 0.5), closes, 100, sigNow)
	if yc.OK || yc.Points != 5 || yc.VsAvgPct != 0 {
		t.Errorf("insufficient history %+v", yc)
	}

	// 이벤트/종가/현재가가 없으면 계산 불가
	if yc = YieldCompressionOf(nil, closes, 100, sigNow); yc.OK || yc.Points != 0 {
		t.Errorf("no events %+v", yc)
	}
	if yc = YieldCompressionOf(monthlyEvents(2021, 6, 0.5), nil, 100, sigNow); yc.OK {
		t.Errorf("no closes %+v", yc)
	}
	if yc = YieldCompressionOf(monthlyEvents(2021, 6, 0.5), closes, 0, sigNow); yc.OK {
		t.Errorf("no price %+v", yc)
	}
}

func yieldRule(pct float64) models.SignalRuleConfig {
	r := noRules()
	r.YieldCompressionEnabled, r.YieldCompressionPct = true, pct
	return r
}

func TestYieldCompressionCheckAndSources(t *testing.T) {
	events := monthlyEvents(2021, 6, 0.5)

	// 시장 이벤트: 가격 2배 -> -50% <= -20 충족
	in := krwAsset(1, 200, 10, 100, yieldRule(20))
	in.History = flatCloses(800, 100)
	in.DivEvents = toMarket(events)
	it := evalOne(t, in)
	c, ok := sellCheck(it, "yield_compression")
	if !ok || !c.Met || !approx(c.Value, -50) || !approx(c.Threshold, -20) || c.Unit != "%" || it.Action != SignalSell {
		t.Fatalf("met %+v %+v", c, it)
	}
	if it.DividendYieldSource != "market" || it.DividendYieldPoints != 24 || !approx(it.DividendYieldAvgPct, 6) || !approx(it.DividendYieldVsAvgPct, -50) {
		t.Errorf("fields %+v", it)
	}

	// 임계값 -60 이면 미충족
	in.Rule = yieldRule(60)
	if c, _ = sellCheck(evalOne(t, in), "yield_compression"); c.Met {
		t.Errorf("must be unmet %+v", c)
	}

	// 규칙이 꺼져 있어도 지표는 계산된다
	in.Rule = noRules()
	it = evalOne(t, in)
	if _, has := sellCheck(it, "yield_compression"); has || it.DividendYieldPoints != 24 {
		t.Errorf("off but computed %+v", it)
	}

	// 시장 이벤트가 사용자 기록보다 우선: 기록은 주당 5 (10배) 로 다른 값
	in = krwAsset(1, 100, 10, 100, yieldRule(20))
	in.History = flatCloses(800, 100)
	in.DivEvents = toMarket(events)
	for _, e := range events {
		in.Dividends = append(in.Dividends, SignalDividendInput{AccountID: 1, Amount: 50, Currency: "KRW", Date: e.Date})
	}
	if it = evalOne(t, in); it.DividendYieldSource != "market" || !approx(it.DividendYieldAvgPct, 6) {
		t.Errorf("market preferred %+v", it)
	}

	// 시장 이벤트가 없으면 사용자 기록(주당 = 금액/보유수량 10)으로 대체
	in.DivEvents = nil
	for i := range in.Dividends {
		in.Dividends[i].Amount = 5 // 주당 0.5
	}
	if it = evalOne(t, in); it.DividendYieldSource != "records" || it.DividendYieldPoints != 24 || !approx(it.DividendYieldAvgPct, 6) {
		t.Errorf("records fallback %+v", it)
	}

	// 둘 다 없으면 지표 없음, 체크는 미충족
	in.Dividends = nil
	it = evalOne(t, in)
	if it.DividendYieldSource != "" || it.DividendYieldPoints != 0 {
		t.Errorf("none %+v", it)
	}
	in.Rule = yieldRule(20)
	if c, ok = sellCheck(evalOne(t, in), "yield_compression"); !ok || c.Met {
		t.Errorf("not computable %+v", c)
	}
}

func TestParseYahooDividends(t *testing.T) {
	// Yahoo chart API (events=div) 응답 예시 (축약)
	sample := `{"chart":{"result":[{"meta":{"currency":"USD","symbol":"KO"},"timestamp":[1700000000],
"events":{"dividends":{
 "1710000000":{"amount":0.485,"date":1710000000},
 "1694000000":{"amount":0.46,"date":1694000000},
 "1720000000":{"amount":0,"date":1720000000},
 "1730000000":{"amount":0.51}
}},"indicators":{"quote":[{"close":[60.1]}]}}],"error":null}}`
	ev, err := parseYahooDividends([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	if len(ev) != 3 || ev[0].Time != 1694000000 || ev[0].Amount != 0.46 || ev[1].Time != 1710000000 || ev[2].Time != 1730000000 || ev[2].Amount != 0.51 {
		t.Errorf("events %+v", ev)
	}
	// 배당 이벤트가 없는 응답
	if ev, err = parseYahooDividends([]byte(`{"chart":{"result":[{"meta":{}}]}}`)); err != nil || len(ev) != 0 {
		t.Errorf("none %+v %v", ev, err)
	}
	if ev, err = parseYahooDividends([]byte(`{"chart":{"result":null}}`)); err != nil || len(ev) != 0 {
		t.Errorf("null result %+v %v", ev, err)
	}
	if _, err = parseYahooDividends([]byte(`not json`)); err == nil {
		t.Error("invalid json must error")
	}
}

func TestDividendEventsCache(t *testing.T) {
	s := NewTickerService()
	cur := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	calls := 0
	fail := false
	s.divEvCache.now = func() time.Time { return cur }
	s.divEvCache.fetch = func(tk string) ([]DividendEvent, error) {
		calls++
		if fail {
			return nil, errTestFetch
		}
		return []DividendEvent{{Time: 1, Amount: 1}}, nil
	}
	if ev, err := s.GetDividendEventsCached("ko"); err != nil || len(ev) != 1 || calls != 1 {
		t.Fatalf("first %v %v %d", ev, err, calls)
	}
	s.GetDividendEventsCached("KO") // 캐시 적중 (대소문자 무관)
	if calls != 1 {
		t.Errorf("cache miss %d", calls)
	}
	cur = cur.Add(13 * time.Hour) // TTL(12h) 경과
	s.GetDividendEventsCached("KO")
	if calls != 2 {
		t.Errorf("expired %d", calls)
	}
	// 실패는 오류를 돌려주고 캐시하지 않으며, Many 에서는 빠진다
	fail = true
	cur = cur.Add(13 * time.Hour)
	if _, err := s.GetDividendEventsCached("KO"); err == nil {
		t.Error("expected error")
	}
	if m := s.GetDividendEventsCachedMany([]string{"KO", "ko"}); len(m) != 0 {
		t.Errorf("failure must be omitted %v", m)
	}
}

type testErr string

func (e testErr) Error() string { return string(e) }

const errTestFetch = testErr("fetch failed")

// noisyCloses 는 일간 로그수익률이 mu ± e 로 번갈아 나오는 종가열(n개)이다.
func noisyCloses(n int, p0, mu, e float64) []PricePoint {
	pts := make([]PricePoint, 0, n)
	p := p0
	for i := 0; i < n; i++ {
		if i > 0 {
			sign := 1.0
			if i%2 == 0 {
				sign = -1
			}
			p *= math.Exp(mu + sign*e)
		}
		pts = append(pts, PricePoint{Time: sigNow.AddDate(0, 0, -(n - i)).Add(12 * time.Hour).Unix(), Close: p})
	}
	return pts
}

func TestAnnualVolatility(t *testing.T) {
	const mu, e = 0.0005, 0.01
	// 300개 종가 중 마지막 252개 -> 수익률 251개. 부호 합 = +e 한 번 남으므로 평균이 mu+e/n 만큼 이동한다.
	pts := noisyCloses(300, 100, mu, e)
	vol, ok := AnnualVolatility(pts, sigNow)
	n := 251.0
	want := math.Sqrt((n*e*e-e*e/n)/(n-1)) * math.Sqrt(252)
	if !ok || math.Abs(vol-want) > 1e-9 {
		t.Errorf("vol %v want %v ok=%v", vol, want, ok)
	}
	// 수익률 119개(120개 종가) -> 불가, 120개(121개 종가) -> 가능
	if _, ok = AnnualVolatility(noisyCloses(120, 100, mu, e), sigNow); ok {
		t.Error("119 returns must fail")
	}
	if _, ok = AnnualVolatility(noisyCloses(121, 100, mu, e), sigNow); !ok {
		t.Error("120 returns must pass")
	}
	// 변동이 전혀 없으면 불가 (vol 0)
	if _, ok = AnnualVolatility(flatCloses(300, 100), sigNow); ok {
		t.Error("zero vol must fail")
	}
}

func volRule() models.SignalRuleConfig {
	r := noRules()
	r.VolOverheatEnabled, r.VolOverheatSigma = true, 1.5
	r.VolOversoldEnabled, r.VolOversoldSigma = true, 1.5
	return r
}

func TestVolSigmaChecks(t *testing.T) {
	hist := noisyCloses(300, 100, 0, 0.01)
	ma := ComputePriceStats(hist, sigNow).MA200
	vol, _ := AnnualVolatility(hist, sigNow)

	run := func(priceMul float64, r models.SignalRuleConfig) SignalItem {
		in := krwAsset(1, ma*priceMul, 10, 100, r)
		in.History = hist
		return evalOne(t, in)
	}

	// 과열: MA 대비 +50% / 연변동성 약 15.9% = 약 3.1σ
	it := run(1.5, volRule())
	wantSigma := 0.5 / vol
	if !approx(it.MA200Sigma, wantSigma) || !approx(it.VolatilityPct, vol*100) {
		t.Fatalf("metrics sigma=%v vol=%v", it.MA200Sigma, it.VolatilityPct)
	}
	c, ok := sellCheck(it, "vol_overheat")
	if !ok || !c.Met || c.Unit != "σ" || !approx(c.Threshold, 1.5) || !approx(c.Value, wantSigma) || it.Action != SignalSell {
		t.Errorf("overheat %+v", c)
	}
	// 높은 임계값이면 미충족
	r := volRule()
	r.VolOverheatSigma = 5
	if c, _ = sellCheck(run(1.5, r), "vol_overheat"); c.Met {
		t.Errorf("overheat unmet %+v", c)
	}
	// 과열 쪽 주가에서는 과매도 미충족
	if bc := it.BuyChecks; len(bc) != 1 || bc[0].Code != "vol_oversold" || bc[0].Met {
		t.Errorf("oversold must be unmet %+v", bc)
	}

	// 과매도: MA 대비 -30% -> 약 -1.9σ, 임계값 -1.5 충족
	it = run(0.7, volRule())
	bc := it.BuyChecks
	if len(bc) != 1 || !bc[0].Met || !approx(bc[0].Threshold, -1.5) || bc[0].Unit != "σ" || it.Action != SignalBuy {
		t.Errorf("oversold %+v action=%s", bc, it.Action)
	}
	r = volRule()
	r.VolOversoldSigma = 2.5
	if bc = run(0.7, r).BuyChecks; bc[0].Met {
		t.Errorf("oversold unmet %+v", bc)
	}

	// 규칙이 꺼져 있어도 지표는 계산된다 (체크 없음)
	it = run(1.5, noRules())
	if len(it.SellChecks) != 0 || it.VolatilityPct <= 0 || it.MA200Sigma <= 0 {
		t.Errorf("off %+v", it)
	}

	// 수익률 120개 미만 -> 계산 불가 (200일 이평도 없음), 체크 미충족
	in := krwAsset(1, 150, 10, 100, volRule())
	in.History = noisyCloses(100, 100, 0, 0.01)
	it = evalOne(t, in)
	if it.VolatilityPct != 0 || it.MA200Sigma != 0 || it.SellChecks[0].Met || it.BuyChecks[0].Met {
		t.Errorf("not computable %+v", it)
	}
	// 200일 미만이지만 변동성은 있는 경우(MA200 없음)도 미충족
	in.History = noisyCloses(150, 100, 0, 0.01)
	if it = evalOne(t, in); it.SellChecks[0].Met || it.BuyChecks[0].Met || it.MA200Sigma != 0 {
		t.Errorf("no ma200 %+v", it)
	}
}

func TestNewChecksAreProfitType(t *testing.T) {
	r := noRules()
	r.PartialEnabled, r.PartialPct = true, 33
	mk := func(checks ...SignalCheck) SignalItem {
		return SignalItem{Action: SignalSell, Quantity: 10, MarketValueKRW: 1500, SellChecks: checks}
	}
	yc := SignalCheck{Code: "yield_compression", Met: true}
	vo := SignalCheck{Code: "vol_overheat", Met: true}
	sl := SignalCheck{Code: "stop_loss", Met: true}

	for _, it := range []SignalItem{mk(yc), mk(vo), mk(yc, vo)} {
		applySellSuggestion(&it, r, 10000)
		if it.SuggestedSellKind != "partial" || it.SuggestedSellQty != 3 {
			t.Errorf("must suggest %+v", it)
		}
	}
	// 손절 등 위험 신호가 섞이면 제안 없음
	for _, it := range []SignalItem{mk(yc, sl), mk(vo, sl)} {
		applySellSuggestion(&it, r, 10000)
		if it.SuggestedSellQty != 0 || it.SuggestedSellKind != "" {
			t.Errorf("must suppress %+v", it)
		}
	}
}

func TestMigrateV5ToV6(t *testing.T) {
	std := models.DefaultSignalRuleConfig()
	std.YieldCompressionEnabled, std.YieldCompressionPct = true, 0
	std.VolOverheatEnabled, std.VolOverheatSigma = true, 0
	std.VolOversoldEnabled, std.VolOversoldSigma = true, 0
	r := models.SignalRule{SignalRuleConfig: std, RuleVersion: 5}
	if !migrateSignalRule(&r) || r.RuleVersion != models.SignalRuleVersion || models.SignalRuleVersion < 6 {
		t.Fatalf("not migrated %+v", r)
	}
	c := r.SignalRuleConfig
	if c.YieldCompressionEnabled || c.YieldCompressionPct != 20 || c.VolOverheatEnabled || c.VolOverheatSigma != 1.5 ||
		c.VolOversoldEnabled || c.VolOversoldSigma != 1.5 {
		t.Errorf("standard %+v", c)
	}
	// 익절/손절이 모두 꺼진 배당형 규칙은 배당수익률 압축이 켜진다
	div := models.DividendSignalRuleConfig()
	div.YieldCompressionEnabled, div.YieldCompressionPct = false, 0
	r = models.SignalRule{SignalRuleConfig: div, RuleVersion: 5}
	migrateSignalRule(&r)
	if !r.YieldCompressionEnabled || r.YieldCompressionPct != 20 {
		t.Errorf("dividend-style %+v", r.SignalRuleConfig)
	}
	// 이미 v6 이면 건드리지 않는다
	r = models.SignalRule{SignalRuleConfig: models.SignalRuleConfig{}, RuleVersion: models.SignalRuleVersion}
	if migrateSignalRule(&r) || r.YieldCompressionEnabled || r.YieldCompressionPct != 0 {
		t.Error("must not re-migrate")
	}
	// 출고 기본값
	if !models.DividendSignalRuleConfig().YieldCompressionEnabled || models.DefaultSignalRuleConfig().YieldCompressionEnabled ||
		models.DefaultSignalRuleConfig().VolOverheatEnabled || models.DefaultSignalRuleConfig().VolOversoldEnabled {
		t.Error("defaults")
	}
}

func TestValidateYieldVolFields(t *testing.T) {
	bad := []func(*models.SignalRuleConfig){
		func(c *models.SignalRuleConfig) { c.YieldCompressionPct = -1 },
		func(c *models.SignalRuleConfig) { c.YieldCompressionEnabled, c.YieldCompressionPct = true, 0 },
		func(c *models.SignalRuleConfig) { c.YieldCompressionPct = math.NaN() },
		func(c *models.SignalRuleConfig) { c.VolOverheatSigma = -0.1 },
		func(c *models.SignalRuleConfig) { c.VolOverheatEnabled, c.VolOverheatSigma = true, 0 },
		func(c *models.SignalRuleConfig) { c.VolOverheatSigma = math.Inf(1) },
		func(c *models.SignalRuleConfig) { c.VolOversoldSigma = -2 },
		func(c *models.SignalRuleConfig) { c.VolOversoldEnabled, c.VolOversoldSigma = true, 0 },
		func(c *models.SignalRuleConfig) { c.VolOversoldSigma = math.NaN() },
	}
	for i, mut := range bad {
		c := models.DefaultSignalRuleConfig()
		mut(&c)
		if err := ValidateSignalRuleConfig(&c); err == nil {
			t.Errorf("case %d: expected error", i)
		}
	}
	c := models.DefaultSignalRuleConfig()
	c.YieldCompressionEnabled, c.VolOverheatEnabled, c.VolOversoldEnabled = true, true, true
	if err := ValidateSignalRuleConfig(&c); err != nil {
		t.Errorf("valid rejected: %v", err)
	}
	// 꺼져 있으면 0 허용
	c = models.DefaultSignalRuleConfig()
	c.YieldCompressionPct, c.VolOverheatSigma, c.VolOversoldSigma = 0, 0, 0
	if err := ValidateSignalRuleConfig(&c); err != nil {
		t.Errorf("zero while disabled rejected: %v", err)
	}
}
