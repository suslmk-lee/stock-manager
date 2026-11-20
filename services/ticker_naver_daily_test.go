package services

import (
	"testing"
	"time"
)

func TestKRCode(t *testing.T) {
	for in, want := range map[string]string{"475720.KS": "475720", "028300.kq": "028300", "0137W0.KS": "0137W0", "NVDA": "", "7203.T": "", "12345.KS": ""} {
		got, ok := krCode(in)
		if (want == "") == ok || got != want && ok {
			t.Errorf("%s → %q %v, want %q", in, got, ok, want)
		}
	}
}

func TestKRHistoryTooShort(t *testing.T) {
	pts := func(n int) *PriceHistory { return &PriceHistory{Points: make([]PricePoint, n)} }
	cases := []struct {
		h     *PriceHistory
		rng   string
		short bool
	}{
		{pts(1), "10y", true},    // 475720.KS: Yahoo 하루치
		{pts(232), "10y", false}, // 상장 1년이 안 된 ETF 도 1년 기준 절반(122일)을 넘으면 그대로
		{pts(100), "1y", true},
		{pts(200), "1y", false},
		{pts(30), "3mo", false}, // 3달 기준 절반(30일)
		{pts(29), "3mo", true},
		{pts(3), "1mo", false}, // 한 달은 판단하지 않음
		{nil, "1y", true},
	}
	for i, c := range cases {
		if got := krHistoryTooShort(c.h, c.rng); got != c.short {
			t.Errorf("case %d: %v", i, got)
		}
	}
}

// 네이버 일봉 → Yahoo 와 같은 봉 시각 (그날 00:00 UTC = 09:00 KST), 종가 없는 날은 뺀다
func TestParseNaverDaily(t *testing.T) {
	body := []byte(`[{"localDate":"20240305","closePrice":6317.0,"openPrice":6369.0,"highPrice":6369.0,"lowPrice":6317.0,"accumulatedTradingVolume":390772},
		{"localDate":"20240306","closePrice":0,"highPrice":0,"lowPrice":0,"accumulatedTradingVolume":0},
		{"localDate":"20261120","closePrice":9000.0,"highPrice":9160.0,"lowPrice":8915.0,"accumulatedTradingVolume":655690}]`)
	h, err := parseNaverDaily(body, "475720.ks", "10y")
	if err != nil {
		t.Fatal(err)
	}
	if h.Symbol != "475720.KS" || h.Currency != "KRW" || h.Interval != "1d" || len(h.Points) != 2 {
		t.Fatalf("%+v", h)
	}
	if p := h.Points[0]; p.Time != time.Date(2024, 3, 5, 0, 0, 0, 0, time.UTC).Unix() || p.Close != 6317 || p.High != 6369 || p.Volume != 390772 {
		t.Fatalf("first = %+v", p)
	}
	if _, err := parseNaverDaily([]byte(`{"error":"x"}`), "475720.KS", "1y"); err == nil {
		t.Fatal("want parse error")
	}
}

func TestPickKRDaily(t *testing.T) {
	pts := func(n int) *PriceHistory { return &PriceHistory{Points: make([]PricePoint, n)} }
	y1, n661 := pts(1), pts(661)
	if pickKRDaily(y1, n661) != n661 {
		t.Fatal("Yahoo 하루치면 네이버")
	}
	y232, n240 := pts(232), pts(240)
	if pickKRDaily(y232, n240) != y232 {
		t.Fatal("비슷하면 Yahoo 그대로")
	}
	if pickKRDaily(nil, n240) != n240 || pickKRDaily(y232, nil) != y232 || pickKRDaily(y232, pts(0)) != y232 {
		t.Fatal("한쪽이 없으면 있는 것")
	}
}
