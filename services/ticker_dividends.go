package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// 시장(Yahoo) 주당 배당 이벤트 조회와 캐시.

const dividendEventsTTL = 12 * time.Hour

// DividendEvent 는 Yahoo chart API 의 배당 이벤트 1건이다 (주당, 종목 통화).
type DividendEvent struct {
	Time   int64   `json:"time"` // unix seconds
	Amount float64 `json:"amount"`
}

type dividendEventsEntry struct {
	events    []DividendEvent
	fetchedAt time.Time
}

// dividendEventsStore 는 12시간 캐시다. 영값으로 바로 쓸 수 있다.
type dividendEventsStore struct {
	mu      sync.Mutex
	entries map[string]dividendEventsEntry
	// 테스트 훅 (운영에서는 nil)
	fetch func(ticker string) ([]DividendEvent, error)
	now   func() time.Time
}

// parseYahooDividends 는 chart API(events=div) 응답에서 배당 이벤트를 뽑아 날짜 오름차순으로 돌려준다.
// events.dividends 는 타임스탬프 문자열을 키로 하는 객체이며, 값의 date 가 없으면 키를 쓴다.
func parseYahooDividends(body []byte) ([]DividendEvent, error) {
	var result struct {
		Chart struct {
			Result []struct {
				Events struct {
					Dividends map[string]struct {
						Amount float64 `json:"amount"`
						Date   int64   `json:"date"`
					} `json:"dividends"`
				} `json:"events"`
			} `json:"result"`
		} `json:"chart"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	out := []DividendEvent{}
	if len(result.Chart.Result) == 0 {
		return out, nil
	}
	for k, d := range result.Chart.Result[0].Events.Dividends {
		ts := d.Date
		if ts == 0 {
			fmt.Sscan(k, &ts)
		}
		if ts <= 0 || !finite(d.Amount) || d.Amount <= 0 {
			continue
		}
		out = append(out, DividendEvent{Time: ts, Amount: d.Amount})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	return out, nil
}

// GetDividendEvents 는 Yahoo chart API 에서 최근 5년 주당 배당 이벤트를 가져온다.
func (s *TickerService) GetDividendEvents(ticker string) ([]DividendEvent, error) {
	ticker = strings.TrimSpace(strings.ToUpper(ticker))
	if ticker == "" {
		return nil, fmt.Errorf("ticker symbol is required")
	}
	params := url.Values{}
	params.Add("range", "5y")
	params.Add("interval", "1d")
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
		return nil, fmt.Errorf("failed to fetch dividend events: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	return parseYahooDividends(body)
}

// GetDividendEventsCached 는 12시간 캐시로 배당 이벤트를 조회한다. 실패는 오류로 돌려주되 캐시하지 않는다.
// 배당이 없는 종목(빈 결과)은 정상 응답으로 캐시한다.
func (s *TickerService) GetDividendEventsCached(ticker string) ([]DividendEvent, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	st := &s.divEvCache
	st.mu.Lock()
	now := time.Now
	if st.now != nil {
		now = st.now
	}
	if e, ok := st.entries[ticker]; ok && now().Sub(e.fetchedAt) <= dividendEventsTTL {
		st.mu.Unlock()
		return e.events, nil
	}
	fetch := st.fetch
	st.mu.Unlock()
	if fetch == nil {
		fetch = s.GetDividendEvents
	}
	ev, err := fetch(ticker)
	if err != nil {
		return nil, err
	}
	st.mu.Lock()
	if st.entries == nil {
		st.entries = map[string]dividendEventsEntry{}
	}
	st.entries[ticker] = dividendEventsEntry{ev, now()}
	st.mu.Unlock()
	return ev, nil
}

// GetDividendEventsCachedMany 는 여러 종목을 동시에(최대 5개) 조회한다. 실패한 종목은 결과에서 빠진다.
func (s *TickerService) GetDividendEventsCachedMany(tickers []string) map[string][]DividendEvent {
	out := map[string][]DividendEvent{}
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
			if ev, err := s.GetDividendEventsCached(k); err == nil && len(ev) > 0 {
				mu.Lock()
				out[k] = ev
				mu.Unlock()
			}
		}(k)
	}
	wg.Wait()
	return out
}
