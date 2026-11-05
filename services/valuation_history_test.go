package services

import (
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"stock-manager/models"
)

var valNow = time.Date(2026, 11, 6, 12, 0, 0, 0, kst)

func vUTC(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// flatPrices 는 now 이전 완료된 months 개월의 월봉(매월 1일, 종가 close)을 만든다.
func flatPrices(close float64, months int) []PricePoint {
	var out []PricePoint
	nk := valNow.In(kst)
	for k := months; k >= 0; k-- { // k=0 은 진행 중인 이번 달 (무시되어야 함)
		first := time.Date(nk.Year(), nk.Month()-time.Month(k), 1, 9, 0, 0, 0, kst)
		out = append(out, PricePoint{Time: first.Unix(), Close: close})
	}
	return out
}

func pointOf(pts []ValuationPoint, month string) (float64, bool) {
	for _, p := range pts {
		if p.Month == month {
			return p.Value, true
		}
	}
	return 0, false
}

func TestValuationSeriesLagNoLookAhead(t *testing.T) {
	h := &FundamentalHistory{AnnualEPS: []PeriodValue{
		{vUTC(2024, 12, 31), 5}, {vUTC(2025, 12, 31), 10},
	}}
	per, pbr := BuildValuationSeries(flatPrices(100, 36), h, valNow, 36)
	if len(pbr) != 0 {
		t.Errorf("no BPS -> no PBR: %v", pbr)
	}
	// FY2024 는 2025-02-14 이후에야 알 수 있다: 1월 말에는 없고 2월 말부터 있다
	if _, ok := pointOf(per, "2025-01"); ok {
		t.Error("2025-01 must not use FY2024 (look-ahead)")
	}
	if v, ok := pointOf(per, "2025-02"); !ok || math.Abs(v-20) > 1e-9 {
		t.Errorf("2025-02 = %v %v", v, ok)
	}
	// FY2025 는 2026-02-14 이후: 2026-01 은 아직 FY2024 값(20), 2026-02 부터 10
	if v, _ := pointOf(per, "2026-01"); math.Abs(v-20) > 1e-9 {
		t.Errorf("2026-01 = %v", v)
	}
	if v, _ := pointOf(per, "2026-02"); math.Abs(v-10) > 1e-9 {
		t.Errorf("2026-02 = %v", v)
	}
	// 이번 달(2026-11)은 포함하지 않고 마지막은 2026-10
	if last := per[len(per)-1]; last.Month != "2026-10" {
		t.Errorf("last month %s", last.Month)
	}
	if _, ok := pointOf(per, "2026-11"); ok {
		t.Error("current month must be excluded")
	}
}

func TestValuationTTMFromQuarterly(t *testing.T) {
	q := []PeriodValue{
		{vUTC(2025, 6, 30), 1}, {vUTC(2025, 9, 30), 2}, {vUTC(2025, 12, 31), 3}, {vUTC(2026, 3, 31), 4}, {vUTC(2026, 6, 30), 5},
	}
	ttm := ttmEPS(q)
	if len(ttm) != 2 || ttm[0].Value != 10 || ttm[1].Value != 14 {
		t.Fatalf("ttm %+v", ttm)
	}
	// 분기가 비면(연속이 아니면) TTM 을 만들지 않는다
	gap := []PeriodValue{{vUTC(2025, 6, 30), 1}, {vUTC(2025, 9, 30), 2}, {vUTC(2026, 3, 31), 4}, {vUTC(2026, 6, 30), 5}}
	if got := ttmEPS(gap); len(got) != 0 {
		t.Errorf("gap must break TTM: %+v", got)
	}
	// 연간 EPS(2025-12-31 = 8)와 TTM 이 섞인다: 같은 종료일은 TTM 우선(여기서는 겹침 없음), 이후 TTM 이 최신
	h := &FundamentalHistory{AnnualEPS: []PeriodValue{{vUTC(2025, 12, 31), 8}}, QuarterlyEPS: q}
	eps := epsSeries(h)
	if len(eps) != 3 || eps[0].Value != 8 || eps[1].Value != 10 || eps[2].Value != 14 {
		t.Fatalf("eps %+v", eps)
	}
	// 같은 종료일이면 TTM 이 연간을 대체
	h.AnnualEPS = []PeriodValue{{vUTC(2026, 3, 31), 99}}
	for _, p := range epsSeries(h) {
		if p.Value == 99 {
			t.Error("TTM must replace annual at the same period end")
		}
	}
	// 가격 100, 2026-10 말: 2026-06-30 TTM(14)이 가장 최근(+45일 = 8/14 < 10/31) -> PER 100/14
	per, _ := BuildValuationSeries(flatPrices(100, 12), h, valNow, 12)
	if v, _ := pointOf(per, "2026-10"); math.Abs(v-100.0/14) > 1e-9 {
		t.Errorf("2026-10 PER %v", v)
	}
	// 2026-07 말: 6/30 + 45일 = 8/14 이후라 아직 3/31 TTM(10)
	if v, _ := pointOf(per, "2026-07"); math.Abs(v-10) > 1e-9 {
		t.Errorf("2026-07 PER %v", v)
	}
}

func TestValuationNegativeEPSSkipped(t *testing.T) {
	h := &FundamentalHistory{
		AnnualEPS: []PeriodValue{{vUTC(2024, 12, 31), 5}, {vUTC(2025, 12, 31), -3}},
		AnnualBPS: []PeriodValue{{vUTC(2024, 12, 31), 50}, {vUTC(2025, 12, 31), 40}},
	}
	per, pbr := BuildValuationSeries(flatPrices(100, 24), h, valNow, 24)
	if _, ok := pointOf(per, "2026-06"); ok {
		t.Error("negative EPS month must be skipped")
	}
	if v, ok := pointOf(per, "2025-06"); !ok || v != 20 {
		t.Errorf("positive EPS month: %v %v", v, ok)
	}
	if v, _ := pointOf(pbr, "2026-06"); math.Abs(v-2.5) > 1e-9 {
		t.Errorf("PBR still computed: %v", v)
	}
}

func TestValuationStaleEPSDropped(t *testing.T) {
	h := &FundamentalHistory{AnnualEPS: []PeriodValue{{vUTC(2023, 12, 31), 5}}}
	per, _ := BuildValuationSeries(flatPrices(100, 36), h, valNow, 36)
	if _, ok := pointOf(per, "2024-06"); !ok {
		t.Error("recent enough value is used")
	}
	if _, ok := pointOf(per, "2026-10"); ok {
		t.Error("value older than 550 days must not be used")
	}
}

func TestParseYahooTimeseriesFixtureAndBPS(t *testing.T) {
	h, err := parseYahooTimeseries(readFixture(t, "yahoo_timeseries_aapl.json"))
	if err != nil {
		t.Fatal(err)
	}
	if h.Currency != "USD" || len(h.QuarterlyEPS) != 5 || len(h.AnnualEPS) != 4 || len(h.QuarterlyBPS) != 5 {
		t.Fatalf("%+v", h)
	}
	if h.QuarterlyEPS[0].Value != 1.57 || !h.QuarterlyEPS[0].End.Equal(vUTC(2025, 6, 30)) {
		t.Errorf("%+v", h.QuarterlyEPS[0])
	}
	// BPS = 자기자본 / 발행주식수 (2025-09-30: 7.3733E10 / 1.477326E10)
	if got, want := h.QuarterlyBPS[0].Value, 7.3733e10/1.477326e10; math.Abs(got-want) > 1e-9 {
		t.Errorf("bps %v want %v", got, want)
	}
	// 주식수가 없는 분기는 BPS 를 만들지 않는다
	h2, _ := parseYahooTimeseries([]byte(`{"timeseries":{"result":[{"quarterlyStockholdersEquity":[{"asOfDate":"2026-03-31","reportedValue":{"raw":100}}]}]}}`))
	if len(h2.QuarterlyBPS) != 0 {
		t.Errorf("%+v", h2.QuarterlyBPS)
	}
	if _, err := parseYahooTimeseries([]byte(`{`)); err == nil {
		t.Error("invalid json must error")
	}
}

func TestParseNaverFinanceFixturesIgnoreEstimates(t *testing.T) {
	eps, bps, err := parseNaverFinance(readFixture(t, "naver_finance_quarter_005930.json"))
	if err != nil {
		t.Fatal(err)
	}
	// 202609 는 추정(isConsensus Y, EPS 13,504)이므로 빠지고 실적 5개만 남는다
	if len(eps) != 5 || eps[0].Value != 733 || !eps[0].End.Equal(vUTC(2025, 6, 30)) || eps[4].Value != 10718 || !eps[4].End.Equal(vUTC(2026, 6, 30)) {
		t.Fatalf("eps %+v", eps)
	}
	for _, p := range eps {
		if p.Value == 13504 {
			t.Error("estimate column leaked")
		}
	}
	if len(bps) != 5 || bps[0].Value != 58135 || bps[4].Value != 86052 { // 추정 열의 BPS 는 "-"
		t.Fatalf("bps %+v", bps)
	}
	aeps, abps, err := parseNaverFinance(readFixture(t, "naver_finance_annual_005930.json"))
	if err != nil {
		t.Fatal(err)
	}
	// 연간 202612 추정(EPS 45,655 / BPS 108,381) 제외
	if len(aeps) != 3 || aeps[0].Value != 2131 || aeps[2].Value != 6564 || !aeps[2].End.Equal(vUTC(2025, 12, 31)) {
		t.Fatalf("annual eps %+v", aeps)
	}
	if len(abps) != 3 || abps[2].Value != 63997 {
		t.Fatalf("annual bps %+v", abps)
	}
	if _, _, err := parseNaverFinance([]byte(`not json`)); err == nil {
		t.Error("invalid json must error")
	}
}

func TestGetHistoryHTTP(t *testing.T) {
	var naverCalls, yahooCrumbSeen int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/finance/annual"):
			atomic.AddInt32(&naverCalls, 1)
			w.Write(readFixture(t, "naver_finance_annual_005930.json"))
		case strings.HasSuffix(r.URL.Path, "/finance/quarter"):
			atomic.AddInt32(&naverCalls, 1)
			w.Write(readFixture(t, "naver_finance_quarter_005930.json"))
		case r.URL.Path == "/crumb":
			w.Write([]byte("abc123"))
		case r.URL.Path == "/cookie":
			w.WriteHeader(404)
		case strings.HasPrefix(r.URL.Path, "/ts/AAPL"):
			if r.URL.Query().Get("crumb") == "abc123" {
				atomic.AddInt32(&yahooCrumbSeen, 1)
			}
			if !strings.Contains(r.URL.RawQuery, "quarterlyDilutedEPS") || r.URL.Query().Get("period1") == "" {
				w.WriteHeader(400)
				return
			}
			w.Write(readFixture(t, "yahoo_timeseries_aapl.json"))
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	s := NewFundamentalsService(srv.Client())
	s.naverFinanceURL = srv.URL + "/api/stock/%s/finance/%s"
	s.yahooCookieURL, s.yahooCrumbURL, s.yahooSeriesURL = srv.URL+"/cookie", srv.URL+"/crumb", srv.URL+"/ts"

	h, err := s.GetHistory("005930.ks")
	if err != nil || naverCalls != 2 || len(h.QuarterlyEPS) != 5 || len(h.AnnualEPS) != 3 || h.Currency != "KRW" {
		t.Fatalf("naver: %v calls=%d %+v", err, naverCalls, h)
	}
	h, err = s.GetHistory("AAPL")
	if err != nil || len(h.AnnualEPS) != 4 || yahooCrumbSeen != 1 {
		t.Fatalf("yahoo: %v crumb=%d %+v", err, yahooCrumbSeen, h)
	}
	// 알 수 없는 심볼은 빈 결과 (오류 아님)
	if h, err := s.GetHistory("ZZZZ"); err != nil || len(h.QuarterlyEPS) != 0 {
		t.Errorf("unknown: %v %+v", err, h)
	}
}

func TestValuationAverageAndMetrics(t *testing.T) {
	var pts []ValuationPoint
	keys, _ := monthWindow(valNow, 12)
	for i, k := range keys {
		pts = append(pts, ValuationPoint{k, float64(10 + i%2*10)}) // 10,20,10,20... 평균 15
	}
	avg, n, ok := ValuationAverage(pts, 12, valNow)
	if !ok || n != 12 || math.Abs(avg-15) > 1e-9 {
		t.Fatalf("%v %v %v", avg, n, ok)
	}
	// 기간 6개월이면 최근 6개만 (여기서는 최소 지점 6개 충족)
	if _, n, ok := ValuationAverage(pts, 6, valNow); !ok || n != 6 {
		t.Errorf("window 6: n=%d ok=%v", n, ok)
	}
	// 비양수 제외
	pts[0].Value = -1
	if _, n, _ := ValuationAverage(pts, 12, valNow); n != 11 {
		t.Errorf("non-positive excluded: n=%d", n)
	}

	vs := &ValuationSeries{PER: pts, PERSource: "computed", PBR: pts[1:4], PBRSource: "computed"}
	it := SignalItem{PER: 12, PBR: 9}
	computeValuationMetrics(&it, vs, 12, valNow)
	if it.PERPoints != 11 {
		t.Errorf("per %+v", it)
	}
	want := (12/it.PERAvg - 1) * 100
	if math.Abs(it.PERVsAvgPct-want) > 1e-9 || it.ValuationSource != "computed" || it.ValuationWindowMonths != 12 {
		t.Errorf("vs %v want %v src=%s win=%d", it.PERVsAvgPct, want, it.ValuationSource, it.ValuationWindowMonths)
	}
	// PBR 지점 3개 < 6: 지점 수만 채우고 평균/괴리는 비운다
	if it.PBRPoints != 3 || it.PBRAvg != 0 || it.PBRVsAvgPct != 0 {
		t.Errorf("pbr not computable: %+v", it)
	}
	// 실시간 PER 이 없으면 마지막 월말 값을 현재값으로 쓴다
	it2 := SignalItem{}
	computeValuationMetrics(&it2, vs, 12, valNow)
	last := pts[len(pts)-1].Value
	if math.Abs(it2.PERVsAvgPct-(last/it2.PERAvg-1)*100) > 1e-9 {
		t.Errorf("fallback to last point: %+v", it2)
	}
	// 기간 0 은 36, nil 시리즈는 아무것도 채우지 않는다
	it3 := SignalItem{PER: 10}
	computeValuationMetrics(&it3, nil, 0, valNow)
	if it3.PERPoints != 0 || it3.ValuationSource != "" {
		t.Errorf("%+v", it3)
	}
	computeValuationMetrics(&it3, vs, 0, valNow)
	if it3.ValuationWindowMonths != 36 {
		t.Errorf("default window %d", it3.ValuationWindowMonths)
	}
}

func TestValuationLessThanSixPointsNotComputable(t *testing.T) {
	h := &FundamentalHistory{AnnualEPS: []PeriodValue{{vUTC(2026, 3, 31), 5}}}
	per, _ := BuildValuationSeries(flatPrices(100, 36), h, valNow, 36)
	// 2026-03 EPS 는 2026-05 말부터: 5,6,7,8,9,10 -> 2026-05..2026-10 = 6개
	if len(per) != 6 {
		t.Fatalf("points %d", len(per))
	}
	if _, _, ok := ValuationAverage(per, 36, valNow); !ok {
		t.Error("6 points is enough")
	}
	if _, n, ok := ValuationAverage(per[1:], 36, valNow); ok || n != 5 {
		t.Errorf("5 points must not be computable: n=%d ok=%v", n, ok)
	}
}

func TestSnapshotValuationSeries(t *testing.T) {
	var snaps []models.FundamentalSnapshot
	for _, d := range []string{"2026-04-03", "2026-04-28", "2026-05-29", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-30", "2026-11-05"} {
		snaps = append(snaps, models.FundamentalSnapshot{Date: d, PER: 10, PBR: 1})
	}
	snaps[1].PER, snaps[1].PBR = 12, 1.2 // 4월의 마지막 값
	snaps[2].PBR = 0                     // 5월 PBR 은 없음
	per, pbr := SnapshotValuationSeries(snaps, valNow, 36)
	if len(per) != 7 || len(pbr) != 6 { // 2026-11 은 진행 중이라 제외
		t.Fatalf("per=%d pbr=%d", len(per), len(pbr))
	}
	if v, _ := pointOf(per, "2026-04"); v != 12 {
		t.Errorf("last of month: %v", v)
	}
	if _, ok := pointOf(per, "2026-11"); ok {
		t.Error("current month excluded")
	}
}

func newTestValuationService(prices *PriceHistory, hist *FundamentalHistory, snaps []models.FundamentalSnapshot) (*ValuationService, *int32) {
	var calls int32
	s := NewValuationService(nil, nil, nil)
	s.now = func() time.Time { return valNow }
	s.fetchPrices = func(string) (*PriceHistory, error) { atomic.AddInt32(&calls, 1); return prices, nil }
	s.fetchHistory = func(string) (*FundamentalHistory, error) { return hist, nil }
	s.loadSnapshots = func(string) ([]models.FundamentalSnapshot, error) { return snaps, nil }
	return s, &calls
}

func TestValuationServiceComputedAndCache(t *testing.T) {
	h := &FundamentalHistory{
		Currency:  "KRW",
		AnnualEPS: []PeriodValue{{vUTC(2024, 12, 31), 5}},
		AnnualBPS: []PeriodValue{{vUTC(2024, 12, 31), 50}},
	}
	s, calls := newTestValuationService(&PriceHistory{Currency: "KRW", Points: flatPrices(100, 36)}, h, nil)
	v, err := s.Get("005930.ks")
	if err != nil || len(v.PER) < 6 || v.PERSource != "computed" || v.PBRSource != "computed" || v.Source() != "computed" {
		t.Fatalf("%v %+v", err, v)
	}
	if _, err := s.Get("005930.KS"); err != nil || *calls != 1 {
		t.Errorf("cache hit expected, calls=%d err=%v", *calls, err)
	}
	// 12시간이 지나면 다시 조회
	s.now = func() time.Time { return valNow.Add(13 * time.Hour) }
	if _, err := s.Get("005930.KS"); err != nil || *calls != 2 {
		t.Errorf("expired cache refetch, calls=%d", *calls)
	}
	// 통화가 다르면 계산하지 않는다 (빈 결과)
	s2, _ := newTestValuationService(&PriceHistory{Currency: "USD", Points: flatPrices(100, 36)}, h, nil)
	if v, err := s2.Get("X"); err != nil || len(v.PER) != 0 || v.Source() != "" {
		t.Errorf("currency mismatch: %v %+v", err, v)
	}
}

func TestValuationServiceEmptyCachedErrorNot(t *testing.T) {
	s, calls := newTestValuationService(&PriceHistory{Points: flatPrices(100, 36)}, &FundamentalHistory{}, nil)
	for i := 0; i < 2; i++ {
		if v, err := s.Get("ETF"); err != nil || v == nil || len(v.PER) != 0 {
			t.Fatalf("empty result: %v %+v", err, v)
		}
	}
	if *calls != 1 {
		t.Errorf("empty result must be cached, calls=%d", *calls)
	}

	var n int32
	s.fetchPrices = func(string) (*PriceHistory, error) { atomic.AddInt32(&n, 1); return nil, errors.New("boom") }
	if _, err := s.Get("ERR"); err == nil {
		t.Fatal("error expected")
	}
	if _, err := s.Get("ERR"); err == nil || n != 2 {
		t.Errorf("errors must not be cached: n=%d", n)
	}
	got := s.GetMany([]string{"err", "ETF", "etf", ""})
	if len(got) != 1 || got["ETF"] == nil {
		t.Errorf("GetMany: %v", got)
	}
}

func TestValuationServiceSnapshotFallback(t *testing.T) {
	var snaps []models.FundamentalSnapshot
	for _, d := range []string{"2026-03-31", "2026-04-30", "2026-05-29", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"} {
		snaps = append(snaps, models.FundamentalSnapshot{Date: d, PER: 10, PBR: 2})
	}
	// 계산된 지점이 6개 미만(EPS 만 4개월치) -> PER 은 스냅샷, BPS 이력 없음 -> PBR 도 스냅샷
	h := &FundamentalHistory{AnnualEPS: []PeriodValue{{vUTC(2026, 5, 31), 5}}}
	s, _ := newTestValuationService(&PriceHistory{Points: flatPrices(100, 36)}, h, snaps)
	v, err := s.Get("A")
	if err != nil || v.PERSource != "snapshots" || v.PBRSource != "snapshots" || len(v.PER) != 7 || v.Source() != "snapshots" {
		t.Fatalf("%v %+v", err, v)
	}
	// 스냅샷도 6개 미만이면 계산 결과(<6)를 그대로 둔다
	s2, _ := newTestValuationService(&PriceHistory{Points: flatPrices(100, 36)}, h, snaps[:3])
	v2, _ := s2.Get("A")
	if v2.PERSource != "computed" || len(v2.PER) >= valuationMinPoints || v2.PBRSource != "" {
		t.Errorf("%+v", v2)
	}
	// 조회 오류여도 스냅샷이 충분하면 (캐시 없이) 스냅샷을 쓴다
	s3, _ := newTestValuationService(nil, nil, snaps)
	s3.fetchPrices = func(string) (*PriceHistory, error) { return nil, errors.New("down") }
	v3, err := s3.Get("A")
	if err != nil || v3.PERSource != "snapshots" {
		t.Errorf("snapshots on fetch error: %v %+v", err, v3)
	}
	if len(s3.entries) != 0 {
		t.Error("fetch-error result must not be cached")
	}
}

func TestValuationAvgChecks(t *testing.T) {
	rule := ruleWith(func(r *models.SignalRuleConfig) {
		r.PerAvgBuyEnabled, r.PerAvgBuyPct = true, 20
		r.PerAvgSellEnabled, r.PerAvgSellPct = true, 30
		r.PbrAvgBuyEnabled, r.PbrAvgBuyPct = true, 20
		r.PbrAvgSellEnabled, r.PbrAvgSellPct = true, 30
		r.MinSellQtyEnabled = false
	})
	eval := func(mut func(it *SignalItem)) SignalItem {
		it := SignalItem{Quantity: 10}
		mut(&it)
		evaluateSignalRule(&it, rule)
		return it
	}
	// 저평가 충족 (정확히 경계 포함)
	it := eval(func(it *SignalItem) { it.PERAvg, it.PERVsAvgPct, it.PBRAvg, it.PBRVsAvgPct = 10, -20, 2, -35 })
	for _, c := range []string{"per_avg_low", "pbr_avg_low"} {
		if !onlyCheck(t, it, c).Met {
			t.Errorf("%s met", c)
		}
	}
	if c := onlyCheck(t, it, "per_avg_low"); c.Value != -20 || c.Threshold != -20 || c.Unit != "%" || c.Label != "PER 평균 대비 저평가" {
		t.Errorf("%+v", c)
	}
	if c := onlyCheck(t, it, "pbr_avg_high"); c.Met || c.Label != "PBR 평균 대비 고평가" {
		t.Errorf("%+v", c)
	}
	// 미충족
	it = eval(func(it *SignalItem) { it.PERAvg, it.PERVsAvgPct, it.PBRAvg, it.PBRVsAvgPct = 10, -19.9, 2, 5 })
	for _, c := range []string{"per_avg_low", "pbr_avg_low", "per_avg_high", "pbr_avg_high"} {
		if onlyCheck(t, it, c).Met {
			t.Errorf("%s unmet", c)
		}
	}
	// 고평가 충족
	it = eval(func(it *SignalItem) { it.PERAvg, it.PERVsAvgPct, it.PBRAvg, it.PBRVsAvgPct = 10, 30, 2, 80 })
	for _, c := range []string{"per_avg_high", "pbr_avg_high"} {
		if cc := onlyCheck(t, it, c); !cc.Met || cc.Threshold != 30 {
			t.Errorf("%s met: %+v", c, cc)
		}
	}
	// 계산 불가(avg 0) -> 값이 0 이어도 충족으로 보지 않는다 (−PerAvgBuyPct 보다 vs 가 작아도)
	it = eval(func(it *SignalItem) { it.PERVsAvgPct, it.PBRVsAvgPct = -50, 500 })
	for _, c := range []string{"per_avg_low", "pbr_avg_low", "per_avg_high", "pbr_avg_high"} {
		if onlyCheck(t, it, c).Met {
			t.Errorf("%s unavailable must be unmet", c)
		}
	}
	// 규칙이 꺼져 있으면 체크 자체가 없다
	off := noRules()
	it2 := SignalItem{Quantity: 10, PERAvg: 10, PERVsAvgPct: -50}
	evaluateSignalRule(&it2, off)
	for _, c := range append(append([]SignalCheck{}, it2.SellChecks...), it2.BuyChecks...) {
		if strings.Contains(c.Code, "_avg_") {
			t.Errorf("disabled rule listed: %s", c.Code)
		}
	}
}

func TestValuationAvgGroupMembership(t *testing.T) {
	for _, c := range []string{"per_avg_high", "pbr_avg_high"} {
		if !profitGroupCodes[c] || !profitSellCodes[c] {
			t.Errorf("%s must be in both profit groups", c)
		}
	}
	for _, c := range []string{"per_avg_low", "pbr_avg_low"} {
		if profitGroupCodes[c] || profitSellCodes[c] {
			t.Errorf("%s is a buy check", c)
		}
	}
	rule := ruleWith(func(r *models.SignalRuleConfig) {
		r.SellMode = "group"
		r.SellProfitMinCount, r.SellRiskMinCount = 1, 1
		r.PerAvgSellEnabled, r.PerAvgSellPct = true, 30
		r.MinSellQtyEnabled = false
	})
	it := SignalItem{Quantity: 10, PERAvg: 10, PERVsAvgPct: 45}
	if got := evaluateSignalRule(&it, rule); got != SignalSell {
		t.Errorf("action %s", got)
	}
}

func TestValuationMetricsAppliedWithoutRules(t *testing.T) {
	var pts []ValuationPoint
	keys, _ := monthWindow(sigNow, 36)
	for _, k := range keys {
		pts = append(pts, ValuationPoint{k, 10})
	}
	in := krwAsset(1, 100, 1, 100, noRules())
	in.Fundamentals = &Fundamentals{PER: 15, Source: "naver"}
	in.Valuation = &ValuationSeries{PER: pts, PERSource: "snapshots"}
	it := evalOne(t, in)
	if it.PERAvg != 10 || math.Abs(it.PERVsAvgPct-50) > 1e-9 || it.PERPoints != 36 || it.ValuationSource != "snapshots" || it.ValuationWindowMonths != 36 {
		t.Errorf("%+v", it)
	}
	if it.PBRPoints != 0 || it.PBRAvg != 0 {
		t.Errorf("no pbr history: %+v", it)
	}
}

func TestMigrateV10ToV11(t *testing.T) {
	c := models.DefaultSignalRuleConfig()
	c.ValuationWindowMonths, c.PerAvgBuyPct, c.PbrAvgSellPct = 0, 0, 0
	c.PerAvgBuyEnabled, c.PerAvgSellEnabled, c.PbrAvgBuyEnabled, c.PbrAvgSellEnabled = true, true, true, true // 이전 스키마에는 없던 값
	c.PerBuyMax = 7
	v := 10
	if !migrateRuleConfig(&c, &v) || v != models.SignalRuleVersion || models.SignalRuleVersion != 11 {
		t.Fatalf("v=%d", v)
	}
	if c.ValuationWindowMonths != 36 || c.PerAvgBuyPct != 20 || c.PerAvgSellPct != 30 || c.PbrAvgBuyPct != 20 || c.PbrAvgSellPct != 30 {
		t.Errorf("defaults %+v", c)
	}
	if c.PerAvgBuyEnabled || c.PerAvgSellEnabled || c.PbrAvgBuyEnabled || c.PbrAvgSellEnabled {
		t.Error("new rules must default off")
	}
	if c.PerBuyMax != 7 {
		t.Error("existing values must be preserved")
	}
	// v11 은 다시 보정하지 않는다
	c.PerAvgBuyPct = 44
	if migrateRuleConfig(&c, &v) || c.PerAvgBuyPct != 44 {
		t.Error("no re-migration")
	}
}

func TestValidateValuationRules(t *testing.T) {
	ok := func(mut func(r *models.SignalRuleConfig)) models.SignalRuleConfig {
		r := models.DefaultSignalRuleConfig()
		mut(&r)
		return r
	}
	r := ok(func(r *models.SignalRuleConfig) {
		r.ValuationWindowMonths, r.PerAvgBuyPct, r.PerAvgSellPct, r.PbrAvgBuyPct, r.PbrAvgSellPct = 0, 0, 0, 0, 0
	})
	if err := ValidateSignalRuleConfig(&r); err != nil || r.ValuationWindowMonths != 36 || r.PerAvgBuyPct != 20 || r.PerAvgSellPct != 30 || r.PbrAvgBuyPct != 20 || r.PbrAvgSellPct != 30 {
		t.Fatalf("defaults not filled: %v %+v", err, r)
	}
	edge := ok(func(r *models.SignalRuleConfig) {
		r.ValuationWindowMonths, r.PerAvgBuyPct, r.PerAvgSellPct = 12, 90, 500
	})
	if err := ValidateSignalRuleConfig(&edge); err != nil {
		t.Errorf("edges allowed: %v", err)
	}
	bad := map[string]func(r *models.SignalRuleConfig){
		"window lo":   func(r *models.SignalRuleConfig) { r.ValuationWindowMonths = 11 },
		"window hi":   func(r *models.SignalRuleConfig) { r.ValuationWindowMonths = 61 },
		"window neg":  func(r *models.SignalRuleConfig) { r.ValuationWindowMonths = -1 },
		"per buy hi":  func(r *models.SignalRuleConfig) { r.PerAvgBuyPct = 90.1 },
		"per buy neg": func(r *models.SignalRuleConfig) { r.PerAvgBuyPct = -1 },
		"per sell hi": func(r *models.SignalRuleConfig) { r.PerAvgSellPct = 501 },
		"pbr buy hi":  func(r *models.SignalRuleConfig) { r.PbrAvgBuyPct = 91 },
		"pbr sell hi": func(r *models.SignalRuleConfig) { r.PbrAvgSellPct = 600 },
		"nan":         func(r *models.SignalRuleConfig) { r.PbrAvgSellPct = math.NaN() },
		"inf":         func(r *models.SignalRuleConfig) { r.PerAvgBuyPct = math.Inf(1) },
	}
	for name, mut := range bad {
		c := ok(mut)
		err := ValidateSignalRuleConfig(&c)
		if _, isRule := err.(*ErrInvalidSignalRule); err == nil || !isRule {
			t.Errorf("%s: want ErrInvalidSignalRule, got %v", name, err)
		}
	}
	if d := models.DefaultSignalRuleConfig(); d.PerAvgBuyEnabled || d.PerAvgSellEnabled || d.PbrAvgBuyEnabled || d.PbrAvgSellEnabled || d.ValuationWindowMonths != 36 {
		t.Errorf("default config %+v", d)
	}
}
