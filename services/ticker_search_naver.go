package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

// 한글 종목 검색 :: Yahoo 검색은 한글 이름("삼성전자", "애플")을 받지 못하므로
// 네이버 증권 자동완성으로 찾고 Yahoo 심볼로 바꿔 돌려준다.
//   - 국내 KOSPI → 005930.KS, KOSDAQ → 086520.KQ
//   - 미국 NYSE · NASDAQ · AMEX → 그대로 (공백 · 점은 Yahoo 표기 '-' 로 :: "BRK B" → BRK-B)
//   - 그 밖의 시장은 건너뛴다

const naverAutocompleteURL = "https://ac.stock.naver.com/ac"

func containsHangul(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Hangul, r) {
			return true
		}
	}
	return false
}

type naverACItem struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	TypeCode   string `json:"typeCode"`
	NationCode string `json:"nationCode"`
}

// naverItemToTicker 는 자동완성 한 건을 Yahoo 심볼 기준 TickerInfo 로 바꾼다. 지원하지 않는 시장이면 false.
func naverItemToTicker(it naverACItem) (TickerInfo, bool) {
	code := strings.TrimSpace(it.Code)
	if code == "" {
		return TickerInfo{}, false
	}
	info := TickerInfo{Name: it.Name, Type: "Stock", Exchange: it.TypeCode}
	switch it.NationCode {
	case "KOR":
		switch it.TypeCode {
		case "KOSPI":
			info.Symbol = code + ".KS"
		case "KOSDAQ":
			info.Symbol = code + ".KQ"
		default:
			return TickerInfo{}, false
		}
		info.Currency = "KRW"
	case "USA":
		info.Symbol = strings.NewReplacer(" ", "-", ".", "-").Replace(strings.ToUpper(code))
		info.Currency = "USD"
	default:
		return TickerInfo{}, false
	}
	return info, true
}

func parseNaverAutocomplete(body []byte, limit int) ([]TickerInfo, error) {
	var result struct {
		Items []naverACItem `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	out := make([]TickerInfo, 0, len(result.Items))
	for _, it := range result.Items {
		if info, ok := naverItemToTicker(it); ok {
			out = append(out, info)
			if len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

func searchTickerNaver(query string) ([]TickerInfo, error) {
	params := url.Values{}
	params.Add("q", query)
	params.Add("target", "stock,etf")
	req, err := http.NewRequest("GET", naverAutocompleteURL+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to search ticker: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	return parseNaverAutocomplete(body, 10)
}
