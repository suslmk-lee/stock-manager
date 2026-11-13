package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// 투자 시뮬레이션(mct-stock-ing)용 월봉 + 배당 이벤트.
// Yahoo chart API 한 번(interval=1mo, events=div)으로 둘 다 받는다.
// 종가는 분할만 반영된 값(close)이고 배당은 따로 내려주므로, 배당 재투자 · 세금은 받는 쪽이 계산한다.

const monthlySeriesTTL = 12 * time.Hour

// MonthlySeriesRanges 는 허용하는 기간이다. 빈 값이면 max.
var MonthlySeriesRanges = map[string]bool{"5y": true, "10y": true, "20y": true, "max": true}

type MonthlySeries struct {
	Symbol    string          `json:"symbol"`
	Name      string          `json:"name"`
	Currency  string          `json:"currency"`
	Exchange  string          `json:"exchange"`
	Type      string          `json:"type"` // Yahoo instrumentType (EQUITY, ETF ...)
	GmtOffset int64           `json:"gmtoffset"`
	Range     string          `json:"range"`
	Points    []PricePoint    `json:"points"`    // 월봉 종가 (마지막 달은 진행 중일 수 있고, 오늘 날짜 막대가 한 번 더 붙기도 한다)
	Dividends []DividendEvent `json:"dividends"` // 주당 배당 (배당락일, 종목 통화)
}

type monthlySeriesEntry struct {
	series    *MonthlySeries
	fetchedAt time.Time
}

// monthlySeriesStore 는 12시간 캐시다. 영값으로 바로 쓸 수 있다.
type monthlySeriesStore struct {
	mu      sync.Mutex
	entries map[string]monthlySeriesEntry
	// 테스트 훅 (운영에서는 nil)
	fetch func(ticker, rangeStr string) (*MonthlySeries, error)
	now   func() time.Time
}

// parseMonthlySeries 는 chart 응답에서 월봉 종가와 배당 이벤트, 이름 · 통화 등을 뽑는다.
func parseMonthlySeries(body []byte, ticker, rangeStr string) (*MonthlySeries, error) {
	hist, err := parsePriceHistory(body, ticker, rangeStr, "1mo")
	if err != nil {
		return nil, err
	}
	divs, err := parseYahooDividends(body)
	if err != nil {
		return nil, err
	}
	var meta struct {
		Chart struct {
			Result []struct {
				Meta struct {
					LongName       string `json:"longName"`
					ShortName      string `json:"shortName"`
					InstrumentType string `json:"instrumentType"`
					ExchangeName   string `json:"exchangeName"`
				} `json:"meta"`
			} `json:"result"`
		} `json:"chart"`
	}
	if err := json.Unmarshal(body, &meta); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	out := &MonthlySeries{
		Symbol:    hist.Symbol,
		Currency:  hist.Currency,
		GmtOffset: hist.GmtOffset,
		Range:     rangeStr,
		Points:    hist.Points,
		Dividends: divs,
	}
	if len(meta.Chart.Result) > 0 {
		m := meta.Chart.Result[0].Meta
		out.Name = m.LongName
		if out.Name == "" {
			out.Name = m.ShortName
		}
		out.Type = m.InstrumentType
		out.Exchange = m.ExchangeName
	}
	if out.Symbol == "" {
		out.Symbol = ticker
	}
	return out, nil
}

// GetMonthlySeries 는 월봉 종가와 같은 기간의 주당 배당 이벤트를 가져온다.
func (s *TickerService) GetMonthlySeries(ticker, rangeStr string) (*MonthlySeries, error) {
	ticker = strings.TrimSpace(strings.ToUpper(ticker))
	if ticker == "" {
		return nil, fmt.Errorf("ticker symbol is required")
	}
	if rangeStr == "" {
		rangeStr = "max"
	}
	if !MonthlySeriesRanges[rangeStr] {
		return nil, fmt.Errorf("unsupported range: %s", rangeStr)
	}
	if IsFundTicker(ticker) {
		return nil, fmt.Errorf("%s: 펀드는 월봉 시세가 없습니다", ticker)
	}
	params := url.Values{}
	params.Add("range", rangeStr)
	params.Add("interval", "1mo")
	params.Add("events", "div")
	fullURL := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?%s", url.QueryEscape(ticker), params.Encode())
	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch monthly series: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	return parseMonthlySeries(body, ticker, rangeStr)
}

// GetMonthlySeriesCached 는 12시간 캐시로 조회한다. 실패는 캐시하지 않는다.
func (s *TickerService) GetMonthlySeriesCached(ticker, rangeStr string) (*MonthlySeries, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if rangeStr == "" {
		rangeStr = "max"
	}
	if !MonthlySeriesRanges[rangeStr] {
		return nil, fmt.Errorf("unsupported range: %s", rangeStr)
	}
	key := ticker + "|" + rangeStr
	st := &s.monthlyCache
	st.mu.Lock()
	now := time.Now
	if st.now != nil {
		now = st.now
	}
	if e, ok := st.entries[key]; ok && now().Sub(e.fetchedAt) <= monthlySeriesTTL {
		st.mu.Unlock()
		return e.series, nil
	}
	fetch := st.fetch
	st.mu.Unlock()
	if fetch == nil {
		fetch = s.GetMonthlySeries
	}
	series, err := fetch(ticker, rangeStr)
	if err != nil {
		return nil, err
	}
	st.mu.Lock()
	if st.entries == nil {
		st.entries = map[string]monthlySeriesEntry{}
	}
	st.entries[key] = monthlySeriesEntry{series, now()}
	st.mu.Unlock()
	return series, nil
}
