package services

import (
	"strings"
	"sync"
	"time"
)

const dailyHistoryTTL = 6 * time.Hour

type dailyHistoryEntry struct {
	h         *PriceHistory
	fetchedAt time.Time
}

// dailyHistoryStore is a mutex-protected 6h cache; the zero value is ready to use.
type dailyHistoryStore struct {
	mu      sync.Mutex
	entries map[string]dailyHistoryEntry
	// test hooks (nil in production)
	fetch func(ticker, rangeStr, interval string) (*PriceHistory, error)
	now   func() time.Time
}

func (s *TickerService) cachedHistory(ticker, rangeStr, interval string) (*PriceHistory, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	key := ticker + "|" + rangeStr + "|" + interval
	st := &s.histCache2
	st.mu.Lock()
	now := time.Now
	if st.now != nil {
		now = st.now
	}
	if e, ok := st.entries[key]; ok && now().Sub(e.fetchedAt) <= dailyHistoryTTL {
		st.mu.Unlock()
		return e.h, nil
	}
	fetch := st.fetch
	st.mu.Unlock()
	if fetch == nil {
		fetch = s.GetPriceHistory
	}
	h, err := fetch(ticker, rangeStr, interval)
	if err != nil {
		return nil, err
	}
	st.mu.Lock()
	if st.entries == nil {
		st.entries = map[string]dailyHistoryEntry{}
	}
	st.entries[key] = dailyHistoryEntry{h, now()}
	st.mu.Unlock()
	return h, nil
}

// GetDailyHistoryCached fetches range=1y interval=1d (cached 6h per ticker, uppercase key).
func (s *TickerService) GetDailyHistoryCached(ticker string) (*PriceHistory, error) {
	return s.cachedHistory(ticker, "1y", "1d")
}

// GetFxHistoryCached fetches "KRW=X" range=5y interval=1d (cached 6h).
func (s *TickerService) GetFxHistoryCached() (*PriceHistory, error) {
	return s.cachedHistory("KRW=X", "5y", "1d")
}

// GetDailyHistoriesCached fetches many tickers concurrently (max 5 in flight); failures are omitted.
func (s *TickerService) GetDailyHistoriesCached(tickers []string) map[string]*PriceHistory {
	out := map[string]*PriceHistory{}
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
			if h, err := s.GetDailyHistoryCached(k); err == nil && h != nil {
				mu.Lock()
				out[k] = h
				mu.Unlock()
			}
		}(k)
	}
	wg.Wait()
	return out
}
