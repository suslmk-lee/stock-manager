package services

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// 같은 종목을 여러 곳이 동시에 받으면 한 번만 받고 결과를 나눠 쓴다 (앱을 켠 직후 신호·오늘·가격대·자산 추이가 한꺼번에 받을 때)
func TestCachedHistorySharesInFlight(t *testing.T) {
	s := NewTickerService()
	var calls atomic.Int32
	s.histCache2.fetch = func(ticker, rangeStr, interval string) (*PriceHistory, error) {
		calls.Add(1)
		time.Sleep(80 * time.Millisecond)
		return &PriceHistory{Symbol: ticker, Points: []PricePoint{{Time: 1, Close: 10}}}, nil
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if h, err := s.cachedHistory("vici", "2y", "1d"); err != nil || h == nil || h.Symbol != "VICI" {
				t.Errorf("history = %+v %v", h, err)
			}
		}()
	}
	wg.Wait()
	if n := calls.Load(); n != 1 {
		t.Fatalf("동시에 8번 불렀는데 %d번 받음", n)
	}
	// 기간이 다르면 따로 받는다
	if _, err := s.cachedHistory("VICI", "1y", "1d"); err != nil || calls.Load() != 2 {
		t.Fatalf("다른 기간 = %v, 받은 횟수 %d", err, calls.Load())
	}
}

func TestFundamentalsSharesInFlight(t *testing.T) {
	s := NewFundamentalsService(nil)
	var calls atomic.Int32
	s.fetch = func(tk string) (*Fundamentals, error) {
		calls.Add(1)
		time.Sleep(80 * time.Millisecond)
		return &Fundamentals{PER: 5, Source: "naver"}, nil
	}
	got := s.GetMany([]string{"000270.KS", "000270.ks", "000270.KS"})
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if f, err := s.Get("005930.KS"); err != nil || f.PER != 5 {
				t.Errorf("get = %+v %v", f, err)
			}
		}()
	}
	wg.Wait()
	if len(got) != 1 || calls.Load() != 2 {
		t.Fatalf("결과 %d · 받은 횟수 %d (기아 1 + 삼성전자 1)", len(got), calls.Load())
	}
}
