package services

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// GetZoneHistory: 사기 좋은 가격 계산용 10년 일봉과 그 기간 주당 배당을 Yahoo chart API 한 번으로 받는다.
// (캐시하지 않는다 — 백그라운드 계산이 몇 시간에 한 번 부른다)
func (s *TickerService) GetZoneHistory(ticker string) (*PriceHistory, []DividendEvent, error) {
	ticker = strings.TrimSpace(strings.ToUpper(ticker))
	if ticker == "" || IsFundTicker(ticker) {
		return nil, nil, fmt.Errorf("이력을 받을 수 없는 종목: %s", ticker)
	}
	params := url.Values{}
	params.Add("range", "10y")
	params.Add("interval", "1d")
	params.Add("events", "div")
	fullURL := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?%s", url.QueryEscape(ticker), params.Encode())
	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to fetch price history: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}
	h, err := parsePriceHistory(body, ticker, "10y", "1d")
	if err != nil {
		return nil, nil, err
	}
	divs, err := parseYahooDividends(body)
	if err != nil {
		return nil, nil, err
	}
	return h, divs, nil
}
