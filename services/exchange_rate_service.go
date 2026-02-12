package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

type ExchangeRateService struct {
	cache      map[string]float64
	cacheTime  time.Time
	cacheMutex sync.RWMutex
}

func NewExchangeRateService() *ExchangeRateService {
	return &ExchangeRateService{
		cache: make(map[string]float64),
	}
}

type ExchangeRateResponse struct {
	Rates map[string]float64 `json:"rates"`
	Base  string             `json:"base"`
	Date  string             `json:"date"`
}

// GetUSDToKRW returns the current USD to KRW exchange rate
func (s *ExchangeRateService) GetUSDToKRW() (float64, error) {
	s.cacheMutex.RLock()
	if time.Since(s.cacheTime) < 1*time.Hour && s.cache["USDKRW"] > 0 {
		rate := s.cache["USDKRW"]
		s.cacheMutex.RUnlock()
		return rate, nil
	}
	s.cacheMutex.RUnlock()

	// Try exchangerate-api.com (free tier)
	rate, err := s.fetchFromExchangeRateAPI()
	if err == nil {
		s.cacheMutex.Lock()
		s.cache["USDKRW"] = rate
		s.cacheTime = time.Now()
		s.cacheMutex.Unlock()
		return rate, nil
	}

	// Fallback to a default rate if API fails
	defaultRate := 1300.0
	s.cacheMutex.Lock()
	s.cache["USDKRW"] = defaultRate
	s.cacheTime = time.Now()
	s.cacheMutex.Unlock()

	return defaultRate, nil
}

func (s *ExchangeRateService) fetchFromExchangeRateAPI() (float64, error) {
	url := "https://api.exchangerate-api.com/v4/latest/USD"

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to fetch exchange rate: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, fmt.Errorf("failed to read response: %w", err)
	}

	var result ExchangeRateResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, fmt.Errorf("failed to parse response: %w", err)
	}

	rate, ok := result.Rates["KRW"]
	if !ok {
		return 0, fmt.Errorf("KRW rate not found in response")
	}

	return rate, nil
}

// ConvertToKRW converts an amount from the given currency to KRW
func (s *ExchangeRateService) ConvertToKRW(amount float64, currency string) (float64, error) {
	if currency == "KRW" {
		return amount, nil
	}

	if currency == "USD" {
		rate, err := s.GetUSDToKRW()
		if err != nil {
			return 0, err
		}
		return amount * rate, nil
	}

	return 0, fmt.Errorf("unsupported currency: %s", currency)
}
