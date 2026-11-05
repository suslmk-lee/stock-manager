package services

import (
	"math"
	"os"
	"testing"
	"time"

	"stock-manager/models"
)

// StockCharts RSI 교재 예제(14일) 종가와 기대값.
var rsiTextbookCloses = []float64{
	44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
	46.28, 46.00, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18,
	44.22, 44.57, 43.42, 42.66, 43.13,
}
var rsiTextbookWant = []float64{
	70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.30, 33.08, 37.77,
}

func TestRSISeriesTextbook(t *testing.T) {
	got := RSISeries(rsiTextbookCloses, 14)
	if len(got) != len(rsiTextbookWant) {
		t.Fatalf("len %d want %d", len(got), len(rsiTextbookWant))
	}
	for i, w := range rsiTextbookWant {
		if math.Abs(got[i]-w) > 0.1 {
			t.Errorf("rsi[%d]=%.2f want %.2f", i, got[i], w)
		}
	}
}

func TestRSISmallAndEdges(t *testing.T) {
	s := RSISeries([]float64{10, 11, 10, 12}, 2)
	if len(s) != 2 || math.Abs(s[0]-50) > 1e-9 || math.Abs(s[1]-100+100.0/6) > 1e-9 {
		t.Fatalf("%v", s)
	}
	if RSISeries([]float64{1, 2, 3}, 3) != nil || RSISeries(nil, 14) != nil {
		t.Error("insufficient data should be nil")
	}
	if up := RSISeries([]float64{1, 2, 3, 4}, 2); up[len(up)-1] != 100 {
		t.Errorf("only gains -> 100, got %v", up)
	}
	if flat := RSISeries([]float64{5, 5, 5, 5}, 2); flat[0] != 50 {
		t.Errorf("flat -> 50, got %v", flat)
	}
}

func oscPoints(closes []float64, vol float64) []PricePoint {
	pts := make([]PricePoint, len(closes))
	for i, c := range closes {
		pts[i] = PricePoint{Time: sigNow.AddDate(0, 0, -(len(closes) - i)).Unix(), Close: c, High: c, Low: c, Volume: vol}
	}
	return pts
}

func TestMFISeries(t *testing.T) {
	// 전형가격 = 종가(고=저=종). 양의 흐름 1100+1200, 음의 흐름 1000 -> 100-100/(1+2.3)
	s := MFISeries(oscPoints([]float64{10, 11, 10, 12}, 100), 3)
	if len(s) != 1 || math.Abs(s[0]-(100-100/3.3)) > 1e-9 {
		t.Fatalf("%v", s)
	}
	if MFISeries(oscPoints([]float64{10, 11, 12}, 100), 3) != nil {
		t.Error("insufficient data should be nil")
	}
	// 전부 상승이면 음의 흐름 0 -> 100
	if up := MFISeries(oscPoints([]float64{1, 2, 3, 4}, 10), 3); up[0] != 100 {
		t.Errorf("%v", up)
	}
}

func TestMFIZeroVolumeNotComputable(t *testing.T) {
	pts := oscPoints([]float64{10, 11, 10, 12, 11, 12}, 0)
	if _, _, ok := MFIOf(pts, 3, 5, sigNow); ok {
		t.Error("zero volume must be not computable")
	}
	// 거래량 필드가 아예 없는 봉(과거 캐시)도 계산 불가
	pts2 := oscPoints([]float64{10, 11, 10, 12, 11, 12}, 100)
	for i := range pts2 {
		pts2[i].Volume = 0
	}
	if _, _, ok := MFIOf(pts2, 3, 5, sigNow); ok {
		t.Error("missing volume must be not computable")
	}
	if cur, _, ok := MFIOf(oscPoints([]float64{10, 11, 10, 12, 11, 12}, 100), 3, 5, sigNow); !ok || cur <= 0 {
		t.Errorf("cur=%v ok=%v", cur, ok)
	}
}

func TestOscStatsLookbackMin(t *testing.T) {
	series := []float64{50, 20, 25, 40, 45, 60}
	cur, min, ok := OscStats(series, 3) // 마지막 3개: 40,45,60
	if !ok || cur != 60 || min != 40 {
		t.Errorf("cur=%v min=%v ok=%v", cur, min, ok)
	}
	if _, min, _ := OscStats(series, 10); min != 20 {
		t.Errorf("lookback longer than series: min=%v", min)
	}
	if _, _, ok := OscStats(nil, 3); ok {
		t.Error("empty series")
	}
	if _, _, ok := OscStats([]float64{10, math.NaN()}, 3); ok {
		t.Error("NaN last value must be not computable")
	}
	if _, min, ok := OscStats([]float64{10, math.NaN(), 30}, 3); !ok || min != 10 {
		t.Errorf("NaN inside window skipped: min=%v ok=%v", min, ok)
	}
}

func TestOscMetricsFilledWithoutRules(t *testing.T) {
	in := krwAsset(1, 100, 1, 100, noRules())
	in.History = oscPoints(rsiTextbookCloses, 1000)
	it := evalOne(t, in)
	if it.RSI <= 0 || math.Abs(it.RSI-37.77) > 0.1 || it.RSIMin <= 0 || it.RSIMin > it.RSI {
		t.Errorf("rsi=%v min=%v", it.RSI, it.RSIMin)
	}
	if it.MFI <= 0 || it.MFIMin <= 0 {
		t.Errorf("mfi=%v min=%v", it.MFI, it.MFIMin)
	}
	// 이력이 없으면 비어 있다
	it2 := evalOne(t, krwAsset(1, 100, 1, 100, noRules()))
	if it2.RSI != 0 || it2.MFI != 0 {
		t.Errorf("no history: %+v", it2)
	}
}

func checkFor(t *testing.T, it SignalItem, code string) SignalCheck { return onlyCheck(t, it, code) }

func TestOscFundamentalChecks(t *testing.T) {
	rule := ruleWith(func(r *models.SignalRuleConfig) {
		r.RsiBuyEnabled, r.RsiBuyLevel = true, 30
		r.MfiBuyEnabled, r.MfiBuyLevel = true, 20
		r.RsiSellEnabled, r.RsiSellLevel = true, 70
		r.MfiSellEnabled, r.MfiSellLevel = true, 80
		r.PerBuyEnabled, r.PerBuyMax = true, 10
		r.PerSellEnabled, r.PerSellMin = true, 40
		r.PbrBuyEnabled, r.PbrBuyMax = true, 1
		r.PbrSellEnabled, r.PbrSellMin = true, 5
		r.MinSellQtyEnabled = false
	})
	eval := func(mut func(it *SignalItem)) SignalItem {
		it := SignalItem{Quantity: 10}
		mut(&it)
		evaluateSignalRule(&it, rule)
		return it
	}

	// 충족
	it := eval(func(it *SignalItem) {
		it.RSI, it.RSIMin, it.MFI, it.MFIMin = 35, 25, 25, 15
		it.PER, it.PBR = 8, 0.9
	})
	for _, c := range []string{"rsi_rebound", "mfi_rebound", "per_low", "pbr_low"} {
		if !checkFor(t, it, c).Met {
			t.Errorf("%s should be met", c)
		}
	}
	if c := checkFor(t, it, "rsi_rebound"); c.Value != 35 || c.Threshold != 30 || c.Unit != "" || c.Label != "RSI 과매도 반등" {
		t.Errorf("%+v", c)
	}
	for _, c := range []string{"rsi_overbought", "mfi_overbought", "per_high", "pbr_high"} {
		if checkFor(t, it, c).Met {
			t.Errorf("%s should be unmet", c)
		}
	}

	// 반등 미충족: 구간 최솟값이 기준 위 / 아직 기준 아래
	it = eval(func(it *SignalItem) { it.RSI, it.RSIMin, it.MFI, it.MFIMin = 35, 31, 15, 10 })
	if checkFor(t, it, "rsi_rebound").Met || checkFor(t, it, "mfi_rebound").Met {
		t.Error("rebound must be unmet")
	}

	// 과열/고평가
	it = eval(func(it *SignalItem) {
		it.RSI, it.MFI, it.PER, it.PBR = 70, 80, 40, 5
	})
	for _, c := range []string{"rsi_overbought", "mfi_overbought", "per_high", "pbr_high"} {
		if !checkFor(t, it, c).Met {
			t.Errorf("%s should be met at threshold", c)
		}
	}

	// 값 없음(0) -> 모두 미충족
	it = eval(func(it *SignalItem) {})
	for _, c := range []string{"rsi_rebound", "mfi_rebound", "per_low", "pbr_low", "rsi_overbought", "mfi_overbought", "per_high", "pbr_high"} {
		if cc := checkFor(t, it, c); cc.Met || cc.Value != 0 {
			t.Errorf("%s unavailable should be unmet: %+v", c, cc)
		}
	}
}

func TestOscFundamentalGroupMembership(t *testing.T) {
	for _, c := range []string{"rsi_overbought", "mfi_overbought", "per_high", "pbr_high"} {
		if !profitGroupCodes[c] || !profitSellCodes[c] {
			t.Errorf("%s must be in both profit groups", c)
		}
	}
	for _, c := range []string{"rsi_rebound", "mfi_rebound", "per_low", "pbr_low"} {
		if profitGroupCodes[c] || profitSellCodes[c] {
			t.Errorf("%s is a buy check", c)
		}
	}
	// 익절 그룹 1개 충족이면 SELL (위험 그룹 규칙이 없어도)
	rule := ruleWith(func(r *models.SignalRuleConfig) {
		r.SellMode = "group"
		r.SellProfitMinCount, r.SellRiskMinCount = 1, 1
		r.RsiSellEnabled, r.RsiSellLevel = true, 70
		r.MinSellQtyEnabled = false
	})
	it := SignalItem{Quantity: 10, RSI: 75}
	if got := evaluateSignalRule(&it, rule); got != SignalSell {
		t.Errorf("action %s", got)
	}
}

func TestFundamentalsAppliedToItem(t *testing.T) {
	in := krwAsset(1, 100, 1, 100, noRules())
	in.Fundamentals = &Fundamentals{PER: 9.04, ForwardPER: 4.41, PBR: 2.34, EPS: 22292, BPS: 86052, Source: "naver",
		AsOf: time.Date(2026, 6, 1, 3, 0, 0, 0, time.UTC)}
	it := evalOne(t, in)
	if it.PER != 9.04 || it.ForwardPER != 4.41 || it.PBR != 2.34 || it.EPS != 22292 || it.BPS != 86052 ||
		it.FundamentalsSource != "naver" || it.FundamentalsAsOf != "2026-06-01" {
		t.Errorf("%+v", it)
	}
	// 빈 펀더멘털은 필드를 채우지 않는다
	in.Fundamentals = &Fundamentals{Source: "yahoo"}
	if it := evalOne(t, in); it.FundamentalsSource != "" || it.PER != 0 {
		t.Errorf("empty must not be applied: %+v", it)
	}
}

func TestMigrateV9ToV10(t *testing.T) {
	c := models.DefaultSignalRuleConfig()
	c.RsiPeriod, c.MfiPeriod, c.OscLookbackDays, c.RsiBuyLevel, c.PerBuyMax = 0, 0, 0, 0, 0
	c.RsiBuyEnabled = true // 이전 스키마에는 없던 값이라 꺼진 상태로 보정
	c.TakeProfitPct = 77
	v := 9
	if !migrateRuleConfig(&c, &v) || v != models.SignalRuleVersion {
		t.Fatalf("v=%d", v)
	}
	if c.RsiPeriod != 14 || c.MfiPeriod != 14 || c.OscLookbackDays != 10 || c.RsiBuyLevel != 30 || c.RsiSellLevel != 70 ||
		c.MfiBuyLevel != 20 || c.MfiSellLevel != 80 || c.PerBuyMax != 10 || c.PerSellMin != 40 || c.PbrBuyMax != 1 || c.PbrSellMin != 5 {
		t.Errorf("defaults %+v", c)
	}
	if c.RsiBuyEnabled || c.RsiSellEnabled || c.MfiBuyEnabled || c.MfiSellEnabled || c.PerBuyEnabled || c.PerSellEnabled || c.PbrBuyEnabled || c.PbrSellEnabled {
		t.Error("new rules must default off")
	}
	if c.TakeProfitPct != 77 || c.BelowMAMode != "rebound" {
		t.Errorf("existing values must be preserved: %+v", c)
	}
	if d := models.DefaultSignalRuleConfig(); d.RsiBuyEnabled || d.PerBuyEnabled || d.RsiPeriod != 14 || d.PbrSellMin != 5 {
		t.Errorf("default config %+v", d)
	}
}

func TestValidateOscFundamentalRules(t *testing.T) {
	ok := func(mut func(r *models.SignalRuleConfig)) models.SignalRuleConfig {
		r := models.DefaultSignalRuleConfig()
		mut(&r)
		return r
	}
	// 0 은 기본값으로 채워진다
	r := ok(func(r *models.SignalRuleConfig) { r.RsiPeriod, r.MfiPeriod, r.OscLookbackDays, r.RsiBuyLevel, r.PerBuyMax = 0, 0, 0, 0, 0 })
	if err := ValidateSignalRuleConfig(&r); err != nil || r.RsiPeriod != 14 || r.MfiPeriod != 14 || r.OscLookbackDays != 10 || r.RsiBuyLevel != 30 || r.PerBuyMax != 10 {
		t.Fatalf("defaults not filled: %v %+v", err, r)
	}
	bad := map[string]func(r *models.SignalRuleConfig){
		"rsi_period":        func(r *models.SignalRuleConfig) { r.RsiPeriod = 1 },
		"rsi_period hi":     func(r *models.SignalRuleConfig) { r.RsiPeriod = 51 },
		"mfi_period":        func(r *models.SignalRuleConfig) { r.MfiPeriod = 51 },
		"osc_lookback":      func(r *models.SignalRuleConfig) { r.OscLookbackDays = 61 },
		"osc_lookback neg":  func(r *models.SignalRuleConfig) { r.OscLookbackDays = -1 },
		"rsi_buy_level":     func(r *models.SignalRuleConfig) { r.RsiBuyLevel = 100 },
		"rsi_sell_level":    func(r *models.SignalRuleConfig) { r.RsiSellLevel = -5 },
		"mfi_buy_level":     func(r *models.SignalRuleConfig) { r.MfiBuyLevel = 99.5 },
		"rsi sell<=buy":     func(r *models.SignalRuleConfig) { r.RsiBuyEnabled, r.RsiSellEnabled, r.RsiBuyLevel, r.RsiSellLevel = true, true, 60, 60 },
		"mfi sell<=buy":     func(r *models.SignalRuleConfig) { r.MfiBuyEnabled, r.MfiSellEnabled, r.MfiBuyLevel, r.MfiSellLevel = true, true, 80, 70 },
		"per_buy_max":       func(r *models.SignalRuleConfig) { r.PerBuyMax = -1 },
		"pbr_sell_min":      func(r *models.SignalRuleConfig) { r.PbrSellMin = -0.1 },
		"nan":               func(r *models.SignalRuleConfig) { r.PerSellMin = math.NaN() },
		"inf":               func(r *models.SignalRuleConfig) { r.RsiSellLevel = math.Inf(1) },
	}
	for name, mut := range bad {
		c := ok(mut)
		err := ValidateSignalRuleConfig(&c)
		if _, isRule := err.(*ErrInvalidSignalRule); err == nil || !isRule {
			t.Errorf("%s: want ErrInvalidSignalRule, got %v", name, err)
		}
	}
	// 둘 다 켜지 않았다면 매도/매수 기준 대소는 검사하지 않는다
	c := ok(func(r *models.SignalRuleConfig) { r.RsiBuyEnabled, r.RsiBuyLevel, r.RsiSellLevel = true, 60, 50 })
	if err := ValidateSignalRuleConfig(&c); err != nil {
		t.Errorf("sell disabled: %v", err)
	}
}

func TestParsePriceHistoryHighLowVolume(t *testing.T) {
	body, err := os.ReadFile("testdata/yahoo_chart_aapl.json")
	if err != nil {
		t.Fatal(err)
	}
	h, err := parsePriceHistory(body, "AAPL", "1mo", "1d")
	if err != nil {
		t.Fatal(err)
	}
	// 6개 봉 중 3번째(null)는 건너뛴다
	if h.Symbol != "AAPL" || h.Currency != "USD" || h.GmtOffset != -18000 || len(h.Points) != 5 {
		t.Fatalf("%+v", h)
	}
	for _, p := range h.Points {
		if p.Close <= 0 || p.High < p.Close*0.9 || p.Low <= 0 || p.High < p.Low || p.Volume <= 0 {
			t.Errorf("bad point %+v", p)
		}
	}
	// 고가/저가/거래량 null 이어도 종가가 있으면 포함(0)
	partial := []byte(`{"chart":{"result":[{"meta":{"symbol":"X"},"timestamp":[1,2],"indicators":{"quote":[{"close":[10,11],"high":[null,12],"low":[9],"volume":null}]}}]}}`)
	h, err = parsePriceHistory(partial, "X", "1mo", "1d")
	if err != nil || len(h.Points) != 2 || h.Points[0].High != 0 || h.Points[1].High != 12 || h.Points[1].Low != 0 || h.Points[1].Volume != 0 {
		t.Fatalf("%+v %v", h, err)
	}
	if _, err := parsePriceHistory([]byte(`{"chart":{"result":[]}}`), "X", "1mo", "1d"); err == nil {
		t.Error("empty result must be an error")
	}
}
