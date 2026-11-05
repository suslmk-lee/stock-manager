package services

import (
	"testing"
	"time"

	"stock-manager/models"
)

// seriesHist 는 closes 를 하루 간격 일봉으로 만든다 (마지막 종가는 어제).
func seriesHist(closes []float64) []PricePoint {
	pts := make([]PricePoint, len(closes))
	for i, c := range closes {
		d := len(closes) - i
		pts[i] = PricePoint{Time: sigNow.AddDate(0, 0, -d).Add(12 * time.Hour).Unix(), Close: c}
	}
	return pts
}

// seg 는 (값, 개수) 구간을 이어 붙인다.
func seg(parts ...[2]float64) []float64 {
	var out []float64
	for _, p := range parts {
		for i := 0; i < int(p[1]); i++ {
			out = append(out, p[0])
		}
	}
	return out
}

// ramp 는 from 에서 to 까지 n 개 종가를 선형으로 만든다 (to 포함, from 제외).
func ramp(from, to float64, n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = from + (to-from)*float64(i+1)/float64(n)
	}
	return out
}

func trendAsset(price float64, closes []float64, r models.SignalRuleConfig) SignalAssetInput {
	in := krwAsset(1, price, 10, 100, r)
	in.History = seriesHist(closes)
	return in
}

func belowMARule(mode string) models.SignalRuleConfig {
	r := noRules()
	r.BelowMAEnabled, r.BelowMAPct = true, -5
	r.BelowMAMode, r.BelowMALookbackDays, r.BelowMAMaxAbovePct, r.BelowMAReclaimDays = mode, 60, 3, 10
	return r
}

func fromHighRule(mode string) models.SignalRuleConfig {
	r := noRules()
	r.FromHighEnabled, r.FromHighPct = true, -20
	r.FromHighMode, r.FromHighLookbackDays, r.FromHighReboundPct, r.FromHighStillBelowPct = mode, 60, 5, -10
	return r
}

func TestBelowMAReboundMode(t *testing.T) {
	dip := append(seg([2]float64{100, 200}, [2]float64{90, 20}), ramp(90, 94, 10)...)
	check := func(name string, price float64, closes []float64, want bool) {
		t.Helper()
		it := evalOne(t, trendAsset(price, closes, belowMARule("rebound")))
		c, ok := buyCheck(it, "below_ma")
		if !ok || c.Met != want || c.Label != "장기 이평 하회 후 반등" || !approx(c.Threshold, -5) || c.Unit != "%" {
			t.Errorf("%s: %+v (vs=%v min=%v rising=%v ma20=%v)", name, c, it.VsMA200Pct, it.MA200MinDevPct, it.MA20Rising, it.MA20)
		}
	}
	check("dip then turning up", 96, dip, true)
	// 계속 하락: 현재가가 20일 이평 아래
	fall := append(seg([2]float64{100, 200}), ramp(100, 88, 20)...)
	check("still falling", 85, fall, false)
	// 이미 200일선 위 +6%
	up := append(seg([2]float64{100, 200}, [2]float64{90, 20}), ramp(90, 106, 10)...)
	check("already above", 106, up, false)
	// 충분히 빠진 적 없음
	check("never dipped", 100, seg([2]float64{100, 260}), false)
	// 이력 부족(200 미만)
	check("short history", 96, seg([2]float64{100, 100}), false)

	it := evalOne(t, trendAsset(96, dip, belowMARule("rebound")))
	if it.MA200MinDevPct > -5 || !it.MA20Rising || it.MA200ReclaimDaysAgo != 0 {
		t.Errorf("detail fields %+v %v %v", it.MA200MinDevPct, it.MA20Rising, it.MA200ReclaimDaysAgo)
	}
}

func TestBelowMAReclaimMode(t *testing.T) {
	check := func(name string, price float64, closes []float64, want bool, wantAgo int) {
		t.Helper()
		it := evalOne(t, trendAsset(price, closes, belowMARule("reclaim")))
		c, ok := buyCheck(it, "below_ma")
		if !ok || c.Met != want || c.Label != "200일선 회복" || c.Threshold != 0 {
			t.Errorf("%s: %+v ago=%d vs=%v", name, c, it.MA200ReclaimDaysAgo, it.VsMA200Pct)
		}
		if it.MA200ReclaimDaysAgo != wantAgo {
			t.Errorf("%s: reclaim ago %d want %d", name, it.MA200ReclaimDaysAgo, wantAgo)
		}
	}
	base := seg([2]float64{100, 200}, [2]float64{90, 30})
	check("crossed recently", 104, append(append([]float64{}, base...), seg([2]float64{103, 5})...), true, 6)
	check("crossed long ago", 104, append(append([]float64{}, base...), seg([2]float64{103, 20})...), false, 21)
	check("still below", 92, append(append([]float64{}, base...), seg([2]float64{91, 5})...), false, 0)
}

func TestFromHighReboundMode(t *testing.T) {
	drop := append(seg([2]float64{100, 200}, [2]float64{70, 30}), seg([2]float64{72, 10})...)
	check := func(name, mode string, price float64, want bool, label string) {
		t.Helper()
		it := evalOne(t, trendAsset(price, drop, fromHighRule(mode)))
		c, ok := buyCheck(it, "from_high")
		if !ok || c.Met != want || c.Label != label || !approx(c.Threshold, -20) {
			t.Errorf("%s: %+v (deepest=%v rebound=%v fromHigh=%v)", name, c, it.FromHighDeepestPct, it.FromLowReboundPct, it.FromHighPct)
		}
	}
	const rb, bl = "52주 고점 대비 하락 후 반등", "52주 고점 대비 하락"
	check("rebound ok", "rebound", 74, true, rb)
	check("no rebound", "rebound", 71, false, rb)
	check("recovered near high", "rebound", 95, false, rb)
	// 레거시 below: 반등 여부와 무관하게 -20% 이하면 충족
	check("legacy below", "below", 71, true, bl)
	check("legacy not deep", "below", 95, false, bl)

	it := evalOne(t, trendAsset(74, drop, fromHighRule("rebound")))
	if it.FromHighDeepestPct > -29 || !approx(it.FromLowReboundPct, (74.0/70-1)*100) {
		t.Errorf("detail %v %v", it.FromHighDeepestPct, it.FromLowReboundPct)
	}
	// 얕은 낙폭(-10%)은 기준 -20 미충족
	shallow := append(seg([2]float64{100, 200}, [2]float64{90, 30}), seg([2]float64{91, 10})...)
	it = evalOne(t, trendAsset(95, shallow, fromHighRule("rebound")))
	if c, _ := buyCheck(it, "from_high"); c.Met {
		t.Errorf("shallow must be unmet %+v", c)
	}
}

func TestTrendOfInsufficientHistory(t *testing.T) {
	tm := TrendOf(seg([2]float64{100, 100}), 90, 60, 60)
	if tm.MAOK || tm.MinDevPct != 0 || tm.MA20Rising || tm.ReclaimDays != 0 {
		t.Errorf("ma must be unavailable %+v", tm)
	}
	if !tm.HighOK {
		t.Errorf("high rebound needs only 20 closes %+v", tm)
	}
	if tm = TrendOf(seg([2]float64{100, 10}), 90, 60, 60); tm.MAOK || tm.HighOK {
		t.Errorf("both unavailable %+v", tm)
	}
}

func TestMigrateV8ToV9(t *testing.T) {
	c := models.SignalRuleConfig{BelowMAEnabled: true, BelowMAPct: -7, FromHighEnabled: true, FromHighPct: -25, SellMode: "group", BuyMode: "any", SellProfitMinCount: 1, SellRiskMinCount: 1}
	v := 8
	if !migrateRuleConfig(&c, &v) || v != models.SignalRuleVersion {
		t.Fatalf("not migrated v=%d", v)
	}
	if c.BelowMAMode != "rebound" || c.BelowMALookbackDays != 60 || c.BelowMAMaxAbovePct != 3 || c.BelowMAReclaimDays != 10 ||
		c.FromHighMode != "rebound" || c.FromHighLookbackDays != 60 || c.FromHighReboundPct != 5 || c.FromHighStillBelowPct != -10 {
		t.Errorf("defaults %+v", c)
	}
	if !c.BelowMAEnabled || c.BelowMAPct != -7 || !c.FromHighEnabled || c.FromHighPct != -25 {
		t.Errorf("must keep enabled/pct %+v", c)
	}
	if err := ValidateSignalRuleConfig(&c); err != nil {
		t.Errorf("invalid after migrate: %v", err)
	}
}

func TestValidateTrendFields(t *testing.T) {
	zero := models.DefaultSignalRuleConfig()
	zero.BelowMAMode, zero.BelowMALookbackDays, zero.BelowMAReclaimDays = "", 0, 0
	zero.FromHighMode, zero.FromHighLookbackDays, zero.FromHighReboundPct = "", 0, 0
	if err := ValidateSignalRuleConfig(&zero); err != nil {
		t.Fatal(err)
	}
	if zero.BelowMAMode != "rebound" || zero.BelowMALookbackDays != 60 || zero.BelowMAReclaimDays != 10 ||
		zero.FromHighMode != "rebound" || zero.FromHighLookbackDays != 60 || zero.FromHighReboundPct != 5 {
		t.Errorf("defaults not applied %+v", zero)
	}
	bad := map[string]func(*models.SignalRuleConfig){
		"below_ma_mode":             func(r *models.SignalRuleConfig) { r.BelowMAMode = "x" },
		"below_ma_lookback_days":    func(r *models.SignalRuleConfig) { r.BelowMALookbackDays = 9 },
		"below_ma_lookback_days 2":  func(r *models.SignalRuleConfig) { r.BelowMALookbackDays = 251 },
		"below_ma_max_above_pct":    func(r *models.SignalRuleConfig) { r.BelowMAMaxAbovePct = 51 },
		"below_ma_max_above_pct 2":  func(r *models.SignalRuleConfig) { r.BelowMAMaxAbovePct = -1 },
		"below_ma_reclaim_days":     func(r *models.SignalRuleConfig) { r.BelowMAReclaimDays = 61 },
		"from_high_mode":            func(r *models.SignalRuleConfig) { r.FromHighMode = "reclaim" },
		"from_high_lookback_days":   func(r *models.SignalRuleConfig) { r.FromHighLookbackDays = 5 },
		"from_high_rebound_pct":     func(r *models.SignalRuleConfig) { r.FromHighReboundPct = 101 },
		"from_high_rebound_pct 2":   func(r *models.SignalRuleConfig) { r.FromHighReboundPct = -1 },
		"from_high_still_below_pct": func(r *models.SignalRuleConfig) { r.FromHighStillBelowPct = 1 },
	}
	for name, mut := range bad {
		c := models.DefaultSignalRuleConfig()
		mut(&c)
		if err := ValidateSignalRuleConfig(&c); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	c := models.DefaultSignalRuleConfig()
	c.BelowMAMode, c.FromHighMode = "RECLAIM", "Below"
	if err := ValidateSignalRuleConfig(&c); err != nil || c.BelowMAMode != "reclaim" || c.FromHighMode != "below" {
		t.Errorf("normalize %v %+v", err, c)
	}
}
