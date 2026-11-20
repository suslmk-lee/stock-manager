package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// 국내 종목 일봉 보완 — Yahoo 가 이력을 거의 주지 않는 국내 ETF 가 있다 (예: RISE 200위클리커버드콜 475720.KS 는 하루치만).
// .KS/.KQ 일봉에서 Yahoo 이력이 그 기간(최대 1년)에 있어야 할 거래일의 절반도 안 되면 네이버 일봉을 받아,
// 네이버가 확실히 더 길면(1.2배 넘게) 네이버 것을 쓴다. 상장한 지 얼마 안 된 종목은 둘 다 짧아 Yahoo 그대로.
// 네이버 일봉에는 배당이 없다 (가격대의 총수익은 Yahoo 배당이 있으면 그것으로).

const naverDailyURL = "https://api.stock.naver.com/chart/domestic/item/%s/day?startDateTime=%s0000&endDateTime=%s0000"

// krCode: 국내 종목 코드 (005930.KS → 005930). 아니면 false.
func krCode(ticker string) (string, bool) {
	t := strings.ToUpper(strings.TrimSpace(ticker))
	for _, suf := range []string{".KS", ".KQ"} {
		if strings.HasSuffix(t, suf) {
			code := strings.TrimSuffix(t, suf)
			return code, len(code) == 6
		}
	}
	return "", false
}

// rangeDays: Yahoo range 문자열의 달력 일수 (모르면 0)
func rangeDays(rangeStr string) int {
	switch strings.ToLower(rangeStr) {
	case "1mo":
		return 30
	case "3mo":
		return 91
	case "6mo":
		return 182
	case "1y", "ytd":
		return 365
	case "2y":
		return 730
	case "5y":
		return 1826
	case "10y":
		return 3652
	case "max":
		return 3652 * 3
	}
	return 0
}

// krHistoryTooShort: Yahoo 일봉이 그 기간(최대 1년)에 있어야 할 거래일(1년 약 245일)의 절반도 안 되나.
// 1년으로 자르는 것은 상장 몇 년 안 된 ETF 가 10년 이력을 받을 때마다 네이버를 부르지 않게 하려는 것.
func krHistoryTooShort(h *PriceHistory, rangeStr string) bool {
	expected := min(rangeDays(rangeStr), 365) * 245 / 365
	if expected < 40 { // 한 달처럼 짧은 기간은 판단하지 않는다
		return false
	}
	return h == nil || len(h.Points) < expected/2
}

// parseNaverDaily: 네이버 일봉 응답 → PriceHistory (봉 시각은 Yahoo 와 같게 그날 09:00 KST = 00:00 UTC)
func parseNaverDaily(body []byte, ticker, rangeStr string) (*PriceHistory, error) {
	var rows []struct {
		LocalDate string  `json:"localDate"`
		Close     float64 `json:"closePrice"`
		High      float64 `json:"highPrice"`
		Low       float64 `json:"lowPrice"`
		Volume    float64 `json:"accumulatedTradingVolume"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("failed to parse naver daily: %w", err)
	}
	h := &PriceHistory{Symbol: strings.ToUpper(ticker), Currency: "KRW", Range: rangeStr, Interval: "1d", GmtOffset: 9 * 3600}
	for _, r := range rows {
		d, err := time.Parse("20060102", r.LocalDate)
		if err != nil || r.Close <= 0 {
			continue
		}
		h.Points = append(h.Points, PricePoint{Time: d.Unix(), Close: r.Close, High: r.High, Low: r.Low, Volume: r.Volume})
	}
	return h, nil
}

// naverDaily: 네이버 일봉 (rangeStr 기간, 오늘까지)
func naverDaily(ticker, rangeStr string, now time.Time) (*PriceHistory, error) {
	code, ok := krCode(ticker)
	if !ok {
		return nil, fmt.Errorf("국내 종목이 아님: %s", ticker)
	}
	days := rangeDays(rangeStr)
	if days == 0 {
		days = 365
	}
	k := now.In(kst)
	fullURL := fmt.Sprintf(naverDailyURL, code, k.AddDate(0, 0, -days).Format("20060102"), k.Format("20060102"))
	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("naver daily status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseNaverDaily(body, ticker, rangeStr)
}

// pickKRDaily: Yahoo 일봉(없을 수 있음)과 네이버 일봉 가운데 쓸 것 — 네이버가 1.2배 넘게 길 때만 네이버
func pickKRDaily(yahoo, naver *PriceHistory) *PriceHistory {
	if naver == nil || len(naver.Points) == 0 {
		return yahoo
	}
	if yahoo == nil || float64(len(naver.Points)) > float64(len(yahoo.Points))*1.2 {
		return naver
	}
	return yahoo
}

// withKRDailyFallback: 국내 종목 일봉에서 Yahoo 이력이 너무 짧거나 받지 못했으면 네이버 일봉으로 보완한다.
// 네이버도 실패하면 Yahoo 결과(와 오류)를 그대로 돌려준다.
func withKRDailyFallback(ticker, rangeStr, interval string, h *PriceHistory, err error) (*PriceHistory, error) {
	if interval != "1d" {
		return h, err
	}
	if _, ok := krCode(ticker); !ok || (err == nil && !krHistoryTooShort(h, rangeStr)) {
		return h, err
	}
	n, nerr := naverDaily(ticker, rangeStr, time.Now())
	if nerr != nil || n == nil || len(n.Points) == 0 {
		return h, err
	}
	if err != nil {
		return n, nil
	}
	return pickKRDaily(h, n), nil
}
