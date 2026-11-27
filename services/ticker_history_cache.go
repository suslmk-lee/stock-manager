package services

import (
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
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
	// 같은 종목·기간을 이미 받고 있으면 그 결과를 기다려 함께 쓴다 (앱을 켠 직후 신호·오늘·가격대·자산 추이가 한꺼번에 받을 때)
	flight singleflight.Group
	// test hooks (nil in production)
	fetch func(ticker, rangeStr, interval string) (*PriceHistory, error)
	now   func() time.Time
}

func (s *TickerService) cachedHistory(ticker, rangeStr, interval string) (*PriceHistory, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	v, err, _ := s.histCache2.flight.Do(ticker+"|"+rangeStr+"|"+interval, func() (any, error) {
		return s.cachedHistoryLoad(ticker, rangeStr, interval)
	})
	if err != nil {
		return nil, err
	}
	h, _ := v.(*PriceHistory)
	return h, nil
}

// cachedHistoryLoad: 캐시에 있으면 그것, 없으면 받아서 넣는다 (같은 키는 한 번에 하나만 — cachedHistory)
func (s *TickerService) cachedHistoryLoad(ticker, rangeStr, interval string) (*PriceHistory, error) {
	if IsFundTicker(ticker) { // 펀드: 캐시하지 않고 앱 기준가로
		return s.localHistory(ticker)
	}
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

// GetDailyHistory2yCached fetches range=2y interval=1d (cached 6h per ticker).
func (s *TickerService) GetDailyHistory2yCached(ticker string) (*PriceHistory, error) {
	return s.cachedHistory(ticker, "2y", "1d")
}

// GetDailyHistoriesCached fetches many tickers concurrently (max 5 in flight); failures are omitted.
func (s *TickerService) GetDailyHistoriesCached(tickers []string) map[string]*PriceHistory {
	return s.getDailyHistoriesRangeCached(tickers, "1y")
}

// GetDailyHistoriesRangeCached 는 지정 range(예: 2y, 5y)의 일봉을 동시 조회한다 (일별 총자산 백필용).
func (s *TickerService) GetDailyHistoriesRangeCached(tickers []string, rangeStr string) map[string]*PriceHistory {
	return s.getDailyHistoriesRangeCached(tickers, rangeStr)
}

func (s *TickerService) getDailyHistoriesRangeCached(tickers []string, rangeStr string) map[string]*PriceHistory {
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
			if h, err := s.cachedHistory(k, rangeStr, "1d"); err == nil && h != nil {
				mu.Lock()
				out[k] = h
				mu.Unlock()
			}
		}(k)
	}
	wg.Wait()
	return out
}
