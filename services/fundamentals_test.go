package services

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"stock-manager/models"
)

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestParseLooseNumber(t *testing.T) {
	cases := map[string]float64{
		"9.04배": 9.04, "22,292원": 22292, "86,052원": 86052, "-3.5": -3.5, " 12 ": 12,
		"N/A": 0, "-": 0, "": 0, "배": 0, "0.83%": 0.83, "1,178조 251억": 1178,
	}
	for in, want := range cases {
		if got := parseLooseNumber(in); got != want {
			t.Errorf("%q -> %v want %v", in, got, want)
		}
	}
}

func TestParseNaverFundamentalsFixture(t *testing.T) {
	f, err := parseNaverFundamentals(readFixture(t, "naver_integration_005930.json"))
	if err != nil {
		t.Fatal(err)
	}
	if f.Source != "naver" || f.PER != 9.04 || f.ForwardPER != 4.41 || f.PBR != 2.34 || f.EPS != 22292 || f.BPS != 86052 {
		t.Errorf("%+v", f)
	}
	// N/A / - 는 0
	f, err = parseNaverFundamentals([]byte(`{"totalInfos":[{"code":"per","value":"N/A"},{"code":"pbr","value":"-"},{"code":"eps","value":"-1,234원"},{"code":"bps","value":"5,000원"}]}`))
	if err != nil || f.PER != 0 || f.PBR != 0 || f.EPS != -1234 || f.BPS != 5000 {
		t.Errorf("%+v %v", f, err)
	}
	// ETF 처럼 totalInfos 가 있어도 per/pbr 가 없으면 빈 결과
	f, _ = parseNaverFundamentals([]byte(`{"totalInfos":[{"code":"lastClosePrice","value":"1,000"}]}`))
	if !f.IsEmpty() {
		t.Errorf("%+v", f)
	}
	if _, err := parseNaverFundamentals([]byte(`not json`)); err == nil {
		t.Error("want parse error")
	}
}

func TestParseYahooFundamentalsFixture(t *testing.T) {
	f, err := parseYahooFundamentals(readFixture(t, "yahoo_quotesummary_aapl.json"))
	if err != nil {
		t.Fatal(err)
	}
	if f.Source != "yahoo" || f.PER < 38 || f.PER > 39 || f.ForwardPER < 32 || f.ForwardPER > 33 ||
		f.PBR < 44 || f.PBR > 45 || f.EPS != 8.98 || f.BPS < 7.7 || f.BPS > 7.8 {
		t.Errorf("%+v", f)
	}
	// 비어 있는 값({}), 문자열("Infinity"), 누락은 모두 0
	f, err = parseYahooFundamentals([]byte(`{"quoteSummary":{"result":[{"summaryDetail":{"trailingPE":{},"forwardPE":"Infinity"},"defaultKeyStatistics":{"priceToBook":{"raw":1.5,"fmt":"1.50"},"forwardPE":{"raw":12.5}}}]}}`))
	if err != nil || f.PER != 0 || f.ForwardPER != 12.5 || f.PBR != 1.5 || f.EPS != 0 {
		t.Errorf("%+v %v", f, err)
	}
	f, err = parseYahooFundamentals([]byte(`{"quoteSummary":{"result":null,"error":{"code":"Not Found"}}}`))
	if err != nil || !f.IsEmpty() || f.Source != "yahoo" {
		t.Errorf("%+v %v", f, err)
	}
}

// 가짜 Yahoo/Naver 서버: 쿠키 + crumb + 401 갱신 흐름을 재현한다.
type fakeYahoo struct {
	mu          sync.Mutex
	validCrumb  string
	cookieCalls int
	crumbCalls  int
	sumCalls    int
	summary     []byte
	naver       []byte
}

func (f *fakeYahoo) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/cookie", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.cookieCalls++
		f.mu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: "A3", Value: "cookie-ok", Path: "/"})
		http.NotFound(w, r) // 실제 fc.yahoo.com 은 404 지만 쿠키를 준다
	})
	mux.HandleFunc("/crumb", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.crumbCalls++
		f.mu.Unlock()
		if c, err := r.Cookie("A3"); err != nil || c.Value != "cookie-ok" {
			http.Error(w, "no cookie", http.StatusUnauthorized)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		w.Write([]byte(f.validCrumb))
	})
	mux.HandleFunc("/summary/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.sumCalls++
		valid := f.validCrumb
		f.mu.Unlock()
		if _, err := r.Cookie("A3"); err != nil || r.URL.Query().Get("crumb") != valid {
			http.Error(w, `{"finance":{"error":{"code":"Unauthorized"}}}`, http.StatusUnauthorized)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/NOPE") {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("modules") != "summaryDetail,defaultKeyStatistics" {
			http.Error(w, "bad modules", http.StatusBadRequest)
			return
		}
		w.Write(f.summary)
	})
	mux.HandleFunc("/naver/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/999999") {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/500000") {
			http.Error(w, "boom", 500)
			return
		}
		w.Write(f.naver)
	})
	return mux
}

func newFakeFundamentals(t *testing.T) (*FundamentalsService, *fakeYahoo) {
	t.Helper()
	fy := &fakeYahoo{validCrumb: "CRUMB1", summary: readFixture(t, "yahoo_quotesummary_aapl.json"), naver: readFixture(t, "naver_integration_005930.json")}
	srv := httptest.NewServer(fy.handler())
	t.Cleanup(srv.Close)
	s := NewFundamentalsService(nil)
	s.yahooCookieURL = srv.URL + "/cookie"
	s.yahooCrumbURL = srv.URL + "/crumb"
	s.yahooSummaryURL = srv.URL + "/summary"
	s.naverURL = srv.URL + "/naver/%s"
	return s, fy
}

func TestFundamentalsYahooCrumbFlowAndRefresh(t *testing.T) {
	s, fy := newFakeFundamentals(t)

	f, err := s.Get("aapl")
	if err != nil || f.Source != "yahoo" || f.PER < 38 || f.PBR < 44 || f.AsOf.IsZero() {
		t.Fatalf("%+v %v", f, err)
	}
	if fy.cookieCalls != 1 || fy.crumbCalls != 1 || fy.sumCalls != 1 {
		t.Fatalf("calls cookie=%d crumb=%d summary=%d", fy.cookieCalls, fy.crumbCalls, fy.sumCalls)
	}

	// 다른 종목: 쿠키/crumb 재사용
	if _, err := s.Get("MSFT"); err != nil {
		t.Fatal(err)
	}
	if fy.cookieCalls != 1 || fy.crumbCalls != 1 || fy.sumCalls != 2 {
		t.Fatalf("crumb must be reused: cookie=%d crumb=%d summary=%d", fy.cookieCalls, fy.crumbCalls, fy.sumCalls)
	}

	// 서버가 crumb 을 폐기 -> 401 -> 갱신 후 한 번 재시도
	fy.mu.Lock()
	fy.validCrumb = "CRUMB2"
	fy.mu.Unlock()
	if _, err := s.Get("GOOG"); err != nil {
		t.Fatalf("refresh on 401: %v", err)
	}
	if fy.cookieCalls != 2 || fy.crumbCalls != 2 || fy.sumCalls != 4 || s.crumb != "CRUMB2" {
		t.Fatalf("refresh: cookie=%d crumb=%d summary=%d crumb=%q", fy.cookieCalls, fy.crumbCalls, fy.sumCalls, s.crumb)
	}

	// 알 수 없는 심볼(404)은 빈 결과로 캐시된다
	f, err = s.Get("NOPE")
	if err != nil || !f.IsEmpty() {
		t.Fatalf("%+v %v", f, err)
	}
	n := fy.sumCalls
	if _, err := s.Get("NOPE"); err != nil || fy.sumCalls != n {
		t.Errorf("empty result must be cached (calls %d -> %d)", n, fy.sumCalls)
	}
}

func TestFundamentalsYahooPersistent401IsError(t *testing.T) {
	s, fy := newFakeFundamentals(t)
	s.yahooCrumbURL = strings.Replace(s.yahooCrumbURL, "/crumb", "/crumb-other", 1) // 존재하지 않는 경로 -> crumb 실패
	if _, err := s.Get("AAPL"); err == nil {
		t.Fatal("want error when crumb is unavailable")
	}
	_ = fy
	// 오류는 캐시되지 않는다
	if _, ok := s.entries["AAPL"]; ok {
		t.Error("error must not be cached")
	}
}

func TestFundamentalsNaverRouting(t *testing.T) {
	s, fy := newFakeFundamentals(t)
	for _, tk := range []string{"005930.KS", "035720.kq"} {
		f, err := s.Get(tk)
		if err != nil || f.Source != "naver" || f.PER != 9.04 || f.PBR != 2.34 {
			t.Fatalf("%s: %+v %v", tk, f, err)
		}
	}
	if fy.cookieCalls != 0 || fy.crumbCalls != 0 {
		t.Error("Korean tickers must not touch Yahoo crumb flow")
	}
	if f, err := s.Get("999999.KS"); err != nil || !f.IsEmpty() || f.Source != "naver" {
		t.Errorf("404 -> empty: %+v %v", f, err)
	}
	if _, err := s.Get("500000.KS"); err == nil {
		t.Error("500 must be an error")
	}
	// 6자리 코드가 아니면 Yahoo 로 간다
	if _, err := s.Get("ABC.KS"); err != nil || fy.cookieCalls != 1 {
		t.Errorf("non-code .KS goes to yahoo: %v cookie=%d", err, fy.cookieCalls)
	}
}

func TestFundamentalsCacheBehaviour(t *testing.T) {
	s := NewFundamentalsService(nil)
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	var calls int32
	fail := true
	s.fetch = func(tk string) (*Fundamentals, error) {
		atomic.AddInt32(&calls, 1)
		if tk == "ERR" && fail {
			return nil, errors.New("boom")
		}
		if tk == "ETF" {
			return &Fundamentals{Source: "yahoo"}, nil // 빈 결과
		}
		return &Fundamentals{PER: 10, Source: "yahoo"}, nil
	}

	for i := 0; i < 3; i++ {
		if f, err := s.Get("aapl"); err != nil || f.PER != 10 {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Errorf("calls=%d want 1", calls)
	}
	// 빈 결과도 캐시
	s.Get("ETF")
	s.Get("ETF")
	if calls != 2 {
		t.Errorf("empty result must be cached: calls=%d", calls)
	}
	// 오류는 캐시하지 않는다
	if _, err := s.Get("ERR"); err == nil {
		t.Fatal("want error")
	}
	if _, err := s.Get("ERR"); err == nil || calls != 4 {
		t.Errorf("error must not be cached: calls=%d", calls)
	}
	fail = false
	if f, err := s.Get("ERR"); err != nil || f.PER != 10 {
		t.Errorf("recovers after error: %v", err)
	}
	// 12시간 경과 후 재조회
	now = now.Add(fundamentalsTTL + time.Minute)
	before := calls
	s.Get("AAPL")
	if calls != before+1 {
		t.Errorf("expired entry must be refetched: %d -> %d", before, calls)
	}
	if _, err := s.Get("  "); err == nil {
		t.Error("blank ticker")
	}
}

func TestFundamentalsGetManyConcurrencyAndFailures(t *testing.T) {
	s := NewFundamentalsService(nil)
	var cur, max int32
	s.fetch = func(tk string) (*Fundamentals, error) {
		n := atomic.AddInt32(&cur, 1)
		for {
			m := atomic.LoadInt32(&max)
			if n <= m || atomic.CompareAndSwapInt32(&max, m, n) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		atomic.AddInt32(&cur, -1)
		if tk == "BAD" {
			return nil, errors.New("x")
		}
		return &Fundamentals{PER: 1, Source: "yahoo"}, nil
	}
	tickers := []string{"A", "B", "C", "D", "E", "F", "G", "H", "a", "BAD", ""}
	out := s.GetMany(tickers)
	if len(out) != 8 || out["BAD"] != nil || out["A"] == nil {
		t.Errorf("%v", out)
	}
	if max > 5 || max < 2 {
		t.Errorf("max concurrency %d", max)
	}
}

func TestUpsertFundamentalSnapshotsIdempotent(t *testing.T) {
	db := newSignalTestDB(t)
	if err := db.AutoMigrate(&models.FundamentalSnapshot{}); err != nil {
		t.Fatal(err)
	}
	tickers := map[uint]string{1: "AAPL", 2: "005930.KS", 3: "SPY"}
	funds := map[string]*Fundamentals{
		"AAPL":      {PER: 30, PBR: 40, Source: "yahoo"},
		"005930.KS": {PER: 9, PBR: 2, EPS: 100, BPS: 200, ForwardPER: 5, Source: "naver"},
		"SPY":       {Source: "yahoo"}, // 값 없음 -> 저장하지 않음
	}
	for i := 0; i < 2; i++ {
		if err := UpsertFundamentalSnapshots(db, "2026-06-01", tickers, funds); err != nil {
			t.Fatal(err)
		}
	}
	var rows []models.FundamentalSnapshot
	db.Order("asset_id").Find(&rows)
	if len(rows) != 2 || rows[0].AssetID != 1 || rows[1].AssetID != 2 {
		t.Fatalf("rows %+v", rows)
	}
	// 같은 날 값이 바뀌면 갱신
	funds["AAPL"] = &Fundamentals{PER: 31, PBR: 41, Source: "yahoo"}
	if err := UpsertFundamentalSnapshots(db, "2026-06-01", tickers, funds); err != nil {
		t.Fatal(err)
	}
	var n int64
	db.Model(&models.FundamentalSnapshot{}).Count(&n)
	var a models.FundamentalSnapshot
	db.Where("asset_id = 1").First(&a)
	if n != 2 || a.PER != 31 || a.Ticker != "AAPL" || a.Source != "yahoo" {
		t.Errorf("n=%d %+v", n, a)
	}
	// 다음 날은 새 행
	UpsertFundamentalSnapshots(db, "2026-06-02", tickers, funds)
	db.Model(&models.FundamentalSnapshot{}).Count(&n)
	if n != 4 {
		t.Errorf("n=%d", n)
	}
	// 보낼 것이 없으면 no-op
	if err := UpsertFundamentalSnapshots(db, "2026-06-03", tickers, nil); err != nil {
		t.Error(err)
	}
}

func TestCaptureTodayStoresFundamentalsBestEffort(t *testing.T) {
	f := newDailyFixture(t)
	if err := f.db.AutoMigrate(&models.FundamentalSnapshot{}); err != nil {
		t.Fatal(err)
	}
	fs := NewFundamentalsService(nil)
	fs.fetch = func(tk string) (*Fundamentals, error) {
		if tk == "005930.KS" {
			return nil, errors.New("naver down") // 일부 실패해도 캡처는 성공
		}
		return &Fundamentals{PER: 30, PBR: 40, Source: "yahoo"}, nil
	}
	f.s.SetFundamentals(fs)
	if _, err := f.s.CaptureToday("manual"); err != nil {
		t.Fatal(err)
	}
	var rows []models.FundamentalSnapshot
	f.db.Find(&rows)
	if len(rows) != 1 || rows[0].Ticker != "AAPL" || rows[0].Date != "2026-10-31" || rows[0].AssetID != f.aapl.ID || rows[0].PER != 30 {
		t.Fatalf("%+v", rows)
	}
	// 재캡처해도 중복 없음
	if _, err := f.s.CaptureToday("cron"); err != nil {
		t.Fatal(err)
	}
	var n int64
	f.db.Model(&models.FundamentalSnapshot{}).Count(&n)
	if n != 1 {
		t.Errorf("n=%d", n)
	}
	// 테이블이 없어도(저장 실패) 캡처는 성공한다
	f.db.Migrator().DropTable(&models.FundamentalSnapshot{})
	if _, err := f.s.CaptureToday("cron"); err != nil {
		t.Fatalf("capture must not fail on fundamentals persistence error: %v", err)
	}
}
