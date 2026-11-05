package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 펀더멘털(PER/PBR 등) 조회와 캐시.
//   - 국내(.KS/.KQ): 네이버 모바일 API https://m.stock.naver.com/api/stock/{code}/integration 의 totalInfos
//     (per, eps, cnsPer(추정PER), pbr, bps)
//   - 그 외: Yahoo quoteSummary (summaryDetail, defaultKeyStatistics). crumb + 쿠키가 필요하다.

const (
	fundamentalsTTL = 12 * time.Hour
	fundamentalsUA  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

	fundamentalsSourceYahoo = "yahoo"
	fundamentalsSourceNaver = "naver"
)

// Fundamentals 는 종목 하나의 밸류에이션 지표다. 0 은 "없음"(적자·ETF·조회 불가 등)이다.
type Fundamentals struct {
	PER        float64   `json:"per"`
	ForwardPER float64   `json:"forward_per"`
	PBR        float64   `json:"pbr"`
	EPS        float64   `json:"eps"`
	BPS        float64   `json:"bps"`
	Source     string    `json:"source"` // "yahoo" | "naver"
	AsOf       time.Time `json:"as_of"`
}

// IsEmpty 는 사용할 수 있는 값이 하나도 없는지 알려준다.
func (f *Fundamentals) IsEmpty() bool {
	return f == nil || (f.PER == 0 && f.ForwardPER == 0 && f.PBR == 0 && f.EPS == 0 && f.BPS == 0)
}

type fundamentalsEntry struct {
	f         *Fundamentals
	fetchedAt time.Time
}

// FundamentalsService 는 12시간 캐시를 가진 펀더멘털 조회 서비스다.
// 빈 결과(ETF 등)는 캐시하고, 오류는 캐시하지 않는다.
type FundamentalsService struct {
	client *http.Client

	mu      sync.Mutex
	entries map[string]fundamentalsEntry

	crumbMu sync.Mutex
	crumb   string

	// 엔드포인트 (테스트에서 교체)
	naverURL        string // {code} 를 %s 로 받는 형식
	yahooCookieURL  string
	yahooCrumbURL   string
	yahooSummaryURL string // 뒤에 /{ticker}?modules=...&crumb=... 가 붙는다
	naverFinanceURL string // {code}, {annual|quarter} 를 %s 두 개로 받는 형식
	yahooSeriesURL  string // 뒤에 /{ticker}?type=...&period1=...&period2=... 가 붙는다

	// 테스트 훅 (운영에서는 nil)
	fetch func(ticker string) (*Fundamentals, error)
	now   func() time.Time
}

// NewFundamentalsService 는 서비스를 만든다. client 가 nil 이면 쿠키 저장소가 있는 기본 클라이언트를 쓴다.
// 넘겨받은 client 에 Jar 가 없으면 복사본에 쿠키 저장소를 붙인다 (Yahoo crumb 이 쿠키에 묶여 있다).
func NewFundamentalsService(client *http.Client) *FundamentalsService {
	jar, _ := cookiejar.New(nil)
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second, Jar: jar}
	} else if client.Jar == nil {
		c := *client
		c.Jar = jar
		client = &c
	}
	return &FundamentalsService{
		client:          client,
		entries:         map[string]fundamentalsEntry{},
		naverURL:        "https://m.stock.naver.com/api/stock/%s/integration",
		yahooCookieURL:  "https://fc.yahoo.com",
		yahooCrumbURL:   "https://query2.finance.yahoo.com/v1/test/getcrumb",
		yahooSummaryURL: "https://query2.finance.yahoo.com/v10/finance/quoteSummary",
		naverFinanceURL: "https://m.stock.naver.com/api/stock/%s/finance/%s",
		yahooSeriesURL:  "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries",
	}
}

func (s *FundamentalsService) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

var naverKRXCode = regexp.MustCompile(`^([0-9A-Z]{6})\.(KS|KQ)$`)

// Get 은 캐시를 우선해 펀더멘털을 조회한다. 실패는 오류로 돌려주되 캐시하지 않는다.
func (s *FundamentalsService) Get(ticker string) (*Fundamentals, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if ticker == "" {
		return nil, fmt.Errorf("ticker symbol is required")
	}
	s.mu.Lock()
	if e, ok := s.entries[ticker]; ok && s.clock().Sub(e.fetchedAt) <= fundamentalsTTL {
		s.mu.Unlock()
		return e.f, nil
	}
	fetch := s.fetch
	s.mu.Unlock()
	if fetch == nil {
		fetch = s.fetchLive
	}
	f, err := fetch(ticker)
	if err != nil {
		return nil, err
	}
	if f == nil {
		f = &Fundamentals{}
	}
	if f.AsOf.IsZero() {
		f.AsOf = s.clock()
	}
	s.mu.Lock()
	s.entries[ticker] = fundamentalsEntry{f, s.clock()}
	s.mu.Unlock()
	return f, nil
}

// GetMany 는 여러 종목을 동시에(최대 5개) 조회한다. 실패한 종목은 결과에서 빠진다 (빈 결과는 포함).
func (s *FundamentalsService) GetMany(tickers []string) map[string]*Fundamentals {
	out := map[string]*Fundamentals{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 5)
	seen := map[string]bool{}
	for _, t := range tickers {
		k := strings.ToUpper(strings.TrimSpace(t))
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		wg.Add(1)
		sem <- struct{}{}
		go func(k string) {
			defer wg.Done()
			defer func() { <-sem }()
			if f, err := s.Get(k); err == nil && f != nil {
				mu.Lock()
				out[k] = f
				mu.Unlock()
			}
		}(k)
	}
	wg.Wait()
	return out
}

func (s *FundamentalsService) fetchLive(ticker string) (*Fundamentals, error) {
	if m := naverKRXCode.FindStringSubmatch(ticker); m != nil {
		return s.fetchNaver(m[1])
	}
	return s.fetchYahoo(ticker)
}

func (s *FundamentalsService) get(rawURL string) (int, []byte, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("User-Agent", fundamentalsUA)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	resp, err := s.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, body, err
}

// ---- 네이버 ----

func (s *FundamentalsService) fetchNaver(code string) (*Fundamentals, error) {
	status, body, err := s.get(fmt.Sprintf(s.naverURL, url.PathEscape(code)))
	if err != nil {
		return nil, fmt.Errorf("failed to fetch naver fundamentals: %w", err)
	}
	if status == http.StatusNotFound {
		return &Fundamentals{Source: fundamentalsSourceNaver}, nil // 종목 없음/미지원: 빈 결과
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("naver API returned status code: %d", status)
	}
	return parseNaverFundamentals(body)
}

// parseNaverFundamentals 는 integration 응답의 totalInfos 에서 per/eps/cnsPer/pbr/bps 를 뽑는다.
// 값은 "9.04배", "22,292원", "N/A", "-" 같은 문자열이다.
func parseNaverFundamentals(body []byte) (*Fundamentals, error) {
	var res struct {
		TotalInfos []struct {
			Code  string `json:"code"`
			Value string `json:"value"`
		} `json:"totalInfos"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("failed to parse naver response: %w", err)
	}
	f := &Fundamentals{Source: fundamentalsSourceNaver}
	for _, it := range res.TotalInfos {
		v := parseLooseNumber(it.Value)
		switch it.Code {
		case "per":
			f.PER = v
		case "cnsPer":
			f.ForwardPER = v
		case "pbr":
			f.PBR = v
		case "eps":
			f.EPS = v
		case "bps":
			f.BPS = v
		}
	}
	return f, nil
}

var looseNumberRe = regexp.MustCompile(`-?\d[\d,]*(?:\.\d+)?|-?\.\d+`)

// parseLooseNumber 는 "12.34배", "1,234원", "-3.5" 처럼 단위가 붙은 문자열에서 첫 숫자를 뽑는다.
// "N/A", "-", 빈 문자열 등 숫자가 없으면 0 이다.
func parseLooseNumber(s string) float64 {
	m := looseNumberRe.FindString(strings.TrimSpace(s))
	if m == "" {
		return 0
	}
	v, err := strconv.ParseFloat(strings.ReplaceAll(m, ",", ""), 64)
	if err != nil || !finite(v) {
		return 0
	}
	return v
}

// ---- Yahoo ----

type yahooNum float64

// UnmarshalJSON 은 {"raw": 1.2, "fmt": "1.20"} / 숫자 / {} / 문자열("Infinity" 등) 을 모두 받아들이고, 못 읽으면 0 이다.
func (n *yahooNum) UnmarshalJSON(b []byte) error {
	*n = 0
	var obj struct {
		Raw json.RawMessage `json:"raw"`
	}
	raw := b
	if len(b) > 0 && b[0] == '{' {
		if err := json.Unmarshal(b, &obj); err != nil || len(obj.Raw) == 0 {
			return nil
		}
		raw = obj.Raw
	}
	var f float64
	if err := json.Unmarshal(raw, &f); err == nil && finite(f) {
		*n = yahooNum(f)
	}
	return nil
}

func parseYahooFundamentals(body []byte) (*Fundamentals, error) {
	var res struct {
		QuoteSummary struct {
			Result []struct {
				SummaryDetail struct {
					TrailingPE yahooNum `json:"trailingPE"`
					ForwardPE  yahooNum `json:"forwardPE"`
				} `json:"summaryDetail"`
				DefaultKeyStatistics struct {
					ForwardPE   yahooNum `json:"forwardPE"`
					PriceToBook yahooNum `json:"priceToBook"`
					TrailingEps yahooNum `json:"trailingEps"`
					BookValue   yahooNum `json:"bookValue"`
				} `json:"defaultKeyStatistics"`
			} `json:"result"`
		} `json:"quoteSummary"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("failed to parse yahoo response: %w", err)
	}
	f := &Fundamentals{Source: fundamentalsSourceYahoo}
	if len(res.QuoteSummary.Result) == 0 {
		return f, nil
	}
	r := res.QuoteSummary.Result[0]
	f.PER = float64(r.SummaryDetail.TrailingPE)
	f.ForwardPER = float64(r.SummaryDetail.ForwardPE)
	if f.ForwardPER == 0 {
		f.ForwardPER = float64(r.DefaultKeyStatistics.ForwardPE)
	}
	f.PBR = float64(r.DefaultKeyStatistics.PriceToBook)
	f.EPS = float64(r.DefaultKeyStatistics.TrailingEps)
	f.BPS = float64(r.DefaultKeyStatistics.BookValue)
	return f, nil
}

// refreshCrumb 는 쿠키(fc.yahoo.com, 404 여도 쿠키는 저장됨)와 crumb 을 새로 받는다.
func (s *FundamentalsService) refreshCrumb() (string, error) {
	s.crumbMu.Lock()
	defer s.crumbMu.Unlock()
	if _, _, err := s.get(s.yahooCookieURL); err != nil {
		return "", fmt.Errorf("failed to fetch yahoo cookie: %w", err)
	}
	status, body, err := s.get(s.yahooCrumbURL)
	if err != nil {
		return "", fmt.Errorf("failed to fetch yahoo crumb: %w", err)
	}
	crumb := strings.TrimSpace(string(body))
	if status != http.StatusOK || crumb == "" || len(crumb) > 64 || strings.ContainsAny(crumb, "<{ ") {
		return "", fmt.Errorf("yahoo crumb unavailable (status %d)", status)
	}
	s.crumb = crumb
	return crumb, nil
}

func (s *FundamentalsService) currentCrumb() (string, error) {
	s.crumbMu.Lock()
	c := s.crumb
	s.crumbMu.Unlock()
	if c != "" {
		return c, nil
	}
	return s.refreshCrumb()
}

func (s *FundamentalsService) fetchYahoo(ticker string) (*Fundamentals, error) {
	crumb, err := s.currentCrumb()
	if err != nil {
		return nil, err
	}
	for attempt := 0; ; attempt++ {
		u := fmt.Sprintf("%s/%s?modules=summaryDetail,defaultKeyStatistics&crumb=%s", s.yahooSummaryURL, url.PathEscape(ticker), url.QueryEscape(crumb))
		status, body, err := s.get(u)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch yahoo fundamentals: %w", err)
		}
		switch {
		case status == http.StatusOK:
			return parseYahooFundamentals(body)
		case status == http.StatusNotFound:
			return &Fundamentals{Source: fundamentalsSourceYahoo}, nil // 알 수 없는 심볼: 빈 결과
		case (status == http.StatusUnauthorized || status == http.StatusForbidden) && attempt == 0:
			// crumb/쿠키 만료: 한 번만 갱신해 재시도
			if crumb, err = s.refreshCrumb(); err != nil {
				return nil, err
			}
		default:
			return nil, fmt.Errorf("yahoo API returned status code: %d", status)
		}
	}
}

// applyFundamentals 는 펀더멘털을 신호 항목에 채운다 (없으면 그대로).
func applyFundamentals(item *SignalItem, f *Fundamentals) {
	if f == nil || f.IsEmpty() {
		return
	}
	item.PER, item.ForwardPER, item.PBR, item.EPS, item.BPS = f.PER, f.ForwardPER, f.PBR, f.EPS, f.BPS
	item.FundamentalsSource = f.Source
	if !f.AsOf.IsZero() {
		item.FundamentalsAsOf = kstDateString(f.AsOf)
	}
}
