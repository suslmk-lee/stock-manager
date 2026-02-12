package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type TickerService struct{}

func NewTickerService() *TickerService {
	return &TickerService{}
}

type TickerInfo struct {
	Symbol      string  `json:"symbol"`
	Name        string  `json:"name"`
	Type        string  `json:"type"`
	Sector      string  `json:"sector"`
	Currency    string  `json:"currency"`
	Exchange    string  `json:"exchange"`
	Price       float64 `json:"price"`
	MarketCap   float64 `json:"market_cap"`
	Description string  `json:"description"`
}

type CurrentPrice struct {
	Symbol           string  `json:"symbol"`
	Price            float64 `json:"price"`
	Currency         string  `json:"currency"`
	Change           float64 `json:"change"`
	ChangePercent    float64 `json:"change_percent"`
	PreviousClose    float64 `json:"previous_close"`
	MarketState      string  `json:"market_state"`
}

// Yahoo Finance API를 사용한 티커 정보 조회
func (s *TickerService) GetTickerInfo(ticker string) (*TickerInfo, error) {
	ticker = strings.TrimSpace(strings.ToUpper(ticker))
	if ticker == "" {
		return nil, fmt.Errorf("ticker symbol is required")
	}

	// Yahoo Finance Query API 사용
	baseURL := "https://query2.finance.yahoo.com/v1/finance/search"
	params := url.Values{}
	params.Add("q", ticker)
	params.Add("quotesCount", "1")
	params.Add("newsCount", "0")

	fullURL := fmt.Sprintf("%s?%s", baseURL, params.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch ticker info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result struct {
		Quotes []struct {
			Symbol      string  `json:"symbol"`
			ShortName   string  `json:"shortname"`
			LongName    string  `json:"longname"`
			QuoteType   string  `json:"quoteType"`
			Sector      string  `json:"sector"`
			Industry    string  `json:"industry"`
			Exchange    string  `json:"exchange"`
			Currency    string  `json:"currency"`
			MarketCap   float64 `json:"marketCap"`
		} `json:"quotes"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if len(result.Quotes) == 0 {
		return nil, fmt.Errorf("ticker not found: %s", ticker)
	}

	quote := result.Quotes[0]
	
	name := quote.LongName
	if name == "" {
		name = quote.ShortName
	}

	assetType := "Stock"
	if quote.QuoteType == "ETF" {
		assetType = "ETF"
	}

	sector := quote.Sector
	if sector == "" {
		sector = quote.Industry
	}

	return &TickerInfo{
		Symbol:    quote.Symbol,
		Name:      name,
		Type:      assetType,
		Sector:    sector,
		Currency:  quote.Currency,
		Exchange:  quote.Exchange,
		MarketCap: quote.MarketCap,
	}, nil
}

// 간단한 티커 검색 (자동완성용)
// GetCurrentPrice returns the current price for a ticker
func (s *TickerService) GetCurrentPrice(ticker string) (*CurrentPrice, error) {
	ticker = strings.TrimSpace(strings.ToUpper(ticker))
	if ticker == "" {
		return nil, fmt.Errorf("ticker symbol is required")
	}

	// Yahoo Finance Quote API
	baseURL := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s", url.QueryEscape(ticker))

	req, err := http.NewRequest("GET", baseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch price: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result struct {
		Chart struct {
			Result []struct {
				Meta struct {
					Symbol                string  `json:"symbol"`
					Currency              string  `json:"currency"`
					RegularMarketPrice    float64 `json:"regularMarketPrice"`
					PreviousClose         float64 `json:"previousClose"`
					MarketState           string  `json:"marketState"`
				} `json:"meta"`
			} `json:"result"`
		} `json:"chart"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if len(result.Chart.Result) == 0 {
		return nil, fmt.Errorf("no price data found for ticker: %s", ticker)
	}

	meta := result.Chart.Result[0].Meta
	change := meta.RegularMarketPrice - meta.PreviousClose
	changePercent := 0.0
	if meta.PreviousClose > 0 {
		changePercent = (change / meta.PreviousClose) * 100
	}

	return &CurrentPrice{
		Symbol:        meta.Symbol,
		Price:         meta.RegularMarketPrice,
		Currency:      meta.Currency,
		Change:        change,
		ChangePercent: changePercent,
		PreviousClose: meta.PreviousClose,
		MarketState:   meta.MarketState,
	}, nil
}

func (s *TickerService) SearchTicker(query string) ([]TickerInfo, error) {
	query = strings.TrimSpace(strings.ToUpper(query))
	if query == "" || len(query) < 1 {
		return []TickerInfo{}, nil
	}

	baseURL := "https://query2.finance.yahoo.com/v1/finance/search"
	params := url.Values{}
	params.Add("q", query)
	params.Add("quotesCount", "10")
	params.Add("newsCount", "0")

	fullURL := fmt.Sprintf("%s?%s", baseURL, params.Encode())

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	client := &http.Client{}
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

	var result struct {
		Quotes []struct {
			Symbol    string `json:"symbol"`
			ShortName string `json:"shortname"`
			LongName  string `json:"longname"`
			QuoteType string `json:"quoteType"`
			Sector    string `json:"sector"`
			Industry  string `json:"industry"`
			Exchange  string `json:"exchange"`
		} `json:"quotes"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	tickers := make([]TickerInfo, 0, len(result.Quotes))
	for _, quote := range result.Quotes {
		name := quote.LongName
		if name == "" {
			name = quote.ShortName
		}

		assetType := "Stock"
		if quote.QuoteType == "ETF" {
			assetType = "ETF"
		}

		sector := quote.Sector
		if sector == "" {
			sector = quote.Industry
		}

		tickers = append(tickers, TickerInfo{
			Symbol:   quote.Symbol,
			Name:     name,
			Type:     assetType,
			Sector:   sector,
			Exchange: quote.Exchange,
		})
	}

	return tickers, nil
}
