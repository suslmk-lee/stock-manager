package services

import "testing"

func TestResolveCurrency(t *testing.T) {
	tests := []struct {
		currency, ticker, want string
	}{
		{"USD", "AAPL", "USD"},
		{"", "AAPL", "USD"},
		{"krw", "AAPL", "KRW"}, // 미국 티커라도 기록이 원화면 기록을 따른다
		{"KRW", "005930.KS", "KRW"},
		{"", "005930.KS", "KRW"},
		{"USD", "379800.KS", "KRW"}, // 국내 상장은 기록된 통화와 관계없이 원화
		{" usd ", "091990.kq", "KRW"},
	}
	for _, tc := range tests {
		if got := ResolveCurrency(tc.currency, tc.ticker); got != tc.want {
			t.Errorf("ResolveCurrency(%q, %q) = %q, want %q", tc.currency, tc.ticker, got, tc.want)
		}
	}
}

func TestToKRWIgnoresUSDForKoreanTicker(t *testing.T) {
	if got := toKRW(24_738, "USD", "379800.KS", 1350); got != 24_738 {
		t.Errorf("국내 상장 종목 금액에 환율이 곱해졌다: %v", got)
	}
	if got := toKRW(10, "USD", "AAPL", 1350); got != 13_500 {
		t.Errorf("미국 종목 환산이 틀렸다: %v", got)
	}
}
