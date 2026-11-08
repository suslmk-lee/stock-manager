package services

import (
	"errors"
	"testing"
	"time"
)

const monthlyChartBody = `{
 "chart": {
  "result": [
   {
    "meta": {
     "symbol": "005930.KS",
     "currency": "KRW",
     "gmtoffset": 32400,
     "longName": "Samsung Electronics Co., Ltd.",
     "shortName": "SamsungElec",
     "instrumentType": "EQUITY",
     "exchangeName": "KSC"
    },
    "timestamp": [1790780400, 1793372400, 1793890800],
    "events": {
     "dividends": {
      "1793372400": {"amount": 370.0, "date": 1793545200},
      "1785423600": {"amount": 365.0}
     }
    },
    "indicators": {
     "quote": [{"close": [180000.0, null, 188700.0]}],
     "adjclose": [{"adjclose": [178000.0, null, 188700.0]}]
    }
   }
  ]
 }
}`

func TestParseMonthlySeries(t *testing.T) {
	s, err := parseMonthlySeries([]byte(monthlyChartBody), "005930.KS", "max")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.Symbol != "005930.KS" || s.Currency != "KRW" || s.GmtOffset != 32400 {
		t.Fatalf("meta mismatch: %+v", s)
	}
	if s.Name != "Samsung Electronics Co., Ltd." || s.Type != "EQUITY" || s.Exchange != "KSC" || s.Range != "max" {
		t.Fatalf("name/type/exchange mismatch: %+v", s)
	}
	// null 종가 막대는 건너뛴다 (분할 반영 close 를 쓰고 adjclose 는 쓰지 않는다)
	if len(s.Points) != 2 || s.Points[0].Close != 180000 || s.Points[1].Close != 188700 {
		t.Fatalf("points mismatch: %+v", s.Points)
	}
	// 배당은 날짜 오름차순, date 가 없으면 키를 쓴다
	if len(s.Dividends) != 2 || s.Dividends[0].Time != 1785423600 || s.Dividends[1].Amount != 370 {
		t.Fatalf("dividends mismatch: %+v", s.Dividends)
	}
}

func TestParseMonthlySeriesFallsBackToShortName(t *testing.T) {
	body := `{"chart":{"result":[{"meta":{"symbol":"SCHD","currency":"USD","shortName":"Schwab US Dividend"},"timestamp":[1],"indicators":{"quote":[{"close":[27.1]}]}}]}}`
	s, err := parseMonthlySeries([]byte(body), "SCHD", "10y")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.Name != "Schwab US Dividend" || len(s.Dividends) != 0 {
		t.Fatalf("unexpected: %+v", s)
	}
}

func TestGetMonthlySeriesCached(t *testing.T) {
	calls := 0
	now := time.Unix(1_800_000_000, 0)
	svc := NewTickerService()
	svc.monthlyCache.now = func() time.Time { return now }
	svc.monthlyCache.fetch = func(ticker, rangeStr string) (*MonthlySeries, error) {
		calls++
		if ticker == "FAIL" {
			return nil, errors.New("boom")
		}
		return &MonthlySeries{Symbol: ticker, Range: rangeStr}, nil
	}

	if _, err := svc.GetMonthlySeriesCached("spy", ""); err != nil {
		t.Fatal(err)
	}
	s, _ := svc.GetMonthlySeriesCached("SPY", "max")
	if calls != 1 || s.Symbol != "SPY" || s.Range != "max" {
		t.Fatalf("expected one cached fetch with uppercase key and max range, calls=%d s=%+v", calls, s)
	}

	now = now.Add(monthlySeriesTTL + time.Second)
	if _, err := svc.GetMonthlySeriesCached("SPY", "max"); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("expected refetch after TTL, calls=%d", calls)
	}

	if _, err := svc.GetMonthlySeriesCached("SPY", "3y"); err == nil {
		t.Fatal("expected unsupported range error")
	}
	if _, err := svc.GetMonthlySeriesCached("FAIL", "max"); err == nil {
		t.Fatal("expected fetch error")
	}
	if _, err := svc.GetMonthlySeriesCached("FAIL", "max"); err == nil || calls != 4 {
		t.Fatalf("errors must not be cached, calls=%d", calls)
	}
}
