package services

import (
	"strings"
	"time"
)

// 여러 통화의 원화 환율 — 달러는 KRW=X(지금까지와 같다), 그 밖의 통화(엔화 등)는 {통화}KRW=X 시세.
// 펜스(GBp)처럼 1/100 단위로 시세가 나오는 통화는 배수를 곱한다.
// 원화·달러가 아닌 종목(예: 도쿄 상장 2621.T)을 달러 환율로 평가하던 문제를 고치려고 둔다.

// isKRW: 원화인지 (빈 값은 아니다)
func isKRW(ccy string) bool { return strings.EqualFold(strings.TrimSpace(ccy), "KRW") }

// isUSD: 달러인지
func isUSD(ccy string) bool { return strings.EqualFold(strings.TrimSpace(ccy), "USD") }

// fxSymbol: 통화 1단위의 원화 값을 주는 시세 티커와 배수 (원화·빈 값은 "")
func fxSymbol(ccy string) (symbol string, mult float64) {
	c := strings.TrimSpace(ccy)
	switch c {
	case "", "KRW", "krw":
		return "", 1
	case "GBp", "GBX": // 런던 펜스
		return "GBPKRW=X", 0.01
	case "ILA": // 이스라엘 아고롯
		return "ILSKRW=X", 0.01
	case "ZAc": // 남아공 센트
		return "ZARKRW=X", 0.01
	}
	c = strings.ToUpper(c)
	if c == "USD" {
		return "KRW=X", 1
	}
	return c + "KRW=X", 1
}

// tickerCurrencyBySuffix: 시세에 통화가 없을 때 거래소 꼬리표로 짐작한 통화 (모르면 "")
func tickerCurrencyBySuffix(ticker string) string {
	u := strings.ToUpper(strings.TrimSpace(ticker))
	if strings.HasPrefix(u, fundTickerPrefix) { // 국내 펀드
		return "KRW"
	}
	for _, m := range []struct{ suf, ccy string }{
		{".KS", "KRW"}, {".KQ", "KRW"}, {".T", "JPY"}, {".HK", "HKD"}, {".SS", "CNY"}, {".SZ", "CNY"},
		{".TWO", "TWD"}, {".TW", "TWD"}, {".L", "GBp"}, {".TO", "CAD"}, {".AX", "AUD"}, {".SI", "SGD"}, {".DE", "EUR"}, {".PA", "EUR"},
	} {
		if strings.HasSuffix(u, m.suf) {
			return m.ccy
		}
	}
	return ""
}

// FxRateNow: 통화 1단위의 지금 원화 값 (원화 1, 못 구하면 0)
func (s *TickerService) FxRateNow(ccy string) float64 {
	sym, mult := fxSymbol(ccy)
	if sym == "" {
		return 1
	}
	if p := s.GetCurrentPrices([]string{sym})[sym]; p != nil && finite(p.Price) && p.Price > 0 {
		return p.Price * mult
	}
	return 0
}

// FxLookupFor: 통화 1단위의 날짜별 원화 값 (일봉 5년, 캐시). 그날 값이 없으면 fallback.
func (s *TickerService) FxLookupFor(ccy string, fallback float64) func(time.Time) float64 {
	sym, mult := fxSymbol(ccy)
	if sym == "" {
		return func(time.Time) float64 { return 1 }
	}
	h, err := s.cachedHistory(sym, "5y", "1d")
	if err != nil {
		h = nil
	}
	look := NewFxLookup(h, 0)
	return func(t time.Time) float64 {
		if v := look(t); finite(v) && v > 0 {
			return v * mult
		}
		return fallback
	}
}

// fxBook: 통화별 원화 환율 (지금 · 날짜별). 달러는 기존 값(usdNow·usdAt)을 그대로 쓰고, 그 밖의 통화는 처음 쓸 때 한 번 받아 둔다.
type fxBook struct {
	usdNow float64
	usdAt  func(time.Time) float64 // nil 이면 usdNow
	nowFor func(ccy string) float64
	atFor  func(ccy string, fallback float64) func(time.Time) float64

	nowCache map[string]float64
	atCache  map[string]func(time.Time) float64
}

func newFxBook(usdNow float64, usdAt func(time.Time) float64, nowFor func(string) float64, atFor func(string, float64) func(time.Time) float64) *fxBook {
	return &fxBook{usdNow: usdNow, usdAt: usdAt, nowFor: nowFor, atFor: atFor, nowCache: map[string]float64{}, atCache: map[string]func(time.Time) float64{}}
}

// now: 지금 환율 (원화 1, 모르면 0)
func (b *fxBook) now(ccy string) float64 {
	switch {
	case isKRW(ccy) || strings.TrimSpace(ccy) == "":
		return 1
	case isUSD(ccy):
		return b.usdNow
	}
	key := strings.TrimSpace(ccy)
	if v, ok := b.nowCache[key]; ok {
		return v
	}
	v := 0.0
	if b.nowFor != nil {
		v = b.nowFor(key)
	}
	b.nowCache[key] = v
	return v
}

// at: 그날 환율 (없으면 지금 환율, 그것도 없으면 0)
func (b *fxBook) at(ccy string, t time.Time) float64 {
	switch {
	case isKRW(ccy) || strings.TrimSpace(ccy) == "":
		return 1
	case isUSD(ccy):
		return fxOrNow(b.usdAt, b.usdNow, t)
	}
	key := strings.TrimSpace(ccy)
	f, ok := b.atCache[key]
	if !ok {
		if b.atFor != nil {
			f = b.atFor(key, b.now(key))
		}
		b.atCache[key] = f
	}
	if f != nil {
		if v := f(t); finite(v) && v > 0 {
			return v
		}
	}
	return b.now(key)
}
