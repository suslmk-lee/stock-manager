package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// 주당 재무 이력(EPS/BPS) 조회.
//   - 국내(.KS/.KQ): 네이버 모바일 API https://m.stock.naver.com/api/stock/{code}/finance/{annual|quarter}
//     trTitleList(기간, isConsensus Y = 추정치) + rowList(EPS/BPS 행의 columns[기간키].value). 추정 열은 버린다.
//     관측: 삼성전자(005930) 기준 연간 실적 3개(+추정 1), 분기 실적 5개(+추정 1).
//   - 그 외: Yahoo fundamentals-timeseries (crumb 은 있으면 붙이고 없어도 동작).
//     관측: AAPL 기준 분기 EPS 5개, 연간 EPS 4개, 분기 자기자본/발행주식수 5개.

// PeriodValue 는 회계 기간 종료일 기준 값 하나다.
type PeriodValue struct {
	End   time.Time // 기간 종료일 (UTC 자정)
	Value float64
}

// FundamentalHistory 는 종목의 보고된 주당 재무 이력이다. 각 슬라이스는 End 오름차순이다.
type FundamentalHistory struct {
	Source       string
	Currency     string        // 재무제표 통화 (Yahoo 만, 비어 있으면 모름)
	QuarterlyEPS []PeriodValue // 분기 단독 EPS
	AnnualEPS    []PeriodValue // 회계연도 EPS
	QuarterlyBPS []PeriodValue // 분기말 BPS (네이버) 또는 자기자본/주식수 (Yahoo)
	AnnualBPS    []PeriodValue // 연말 BPS (네이버)
}

func sortPeriods(v []PeriodValue) {
	sort.Slice(v, func(i, j int) bool { return v[i].End.Before(v[j].End) })
}

// GetHistory 는 종목의 EPS/BPS 이력을 조회한다. 캐시는 ValuationService 가 맡는다.
func (s *FundamentalsService) GetHistory(ticker string) (*FundamentalHistory, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if ticker == "" {
		return nil, fmt.Errorf("ticker symbol is required")
	}
	if m := naverKRXCode.FindStringSubmatch(ticker); m != nil {
		return s.fetchNaverHistory(m[1])
	}
	return s.fetchYahooHistory(ticker)
}

// ---- 네이버 ----

func (s *FundamentalsService) fetchNaverHistory(code string) (*FundamentalHistory, error) {
	h := &FundamentalHistory{Source: fundamentalsSourceNaver, Currency: "KRW"}
	var firstErr error
	okAny := false
	for _, period := range []string{"annual", "quarter"} {
		status, body, err := s.get(fmt.Sprintf(s.naverFinanceURL, url.PathEscape(code), period))
		if err == nil && status != http.StatusOK && status != http.StatusNotFound {
			err = fmt.Errorf("naver finance API returned status code: %d", status)
		}
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("failed to fetch naver %s finance: %w", period, err)
			}
			continue
		}
		okAny = true
		if status == http.StatusNotFound {
			continue
		}
		eps, bps, err := parseNaverFinance(body)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if period == "annual" {
			h.AnnualEPS, h.AnnualBPS = eps, bps
		} else {
			h.QuarterlyEPS, h.QuarterlyBPS = eps, bps
		}
	}
	if !okAny {
		return nil, firstErr // 둘 다 실패해야 오류 (한쪽만 되면 가진 것으로 계속)
	}
	return h, nil
}

// parseNaverFinance 는 finance/annual|quarter 응답에서 실적(비추정) EPS/BPS 를 기간 종료일 기준으로 뽑는다.
// 기간 키는 "202512" (연월), 값은 "6,564" / "-" 같은 문자열이다. 분기 종료일은 해당 월의 말일로 본다.
func parseNaverFinance(body []byte) (eps, bps []PeriodValue, err error) {
	var res struct {
		FinanceInfo struct {
			TrTitleList []struct {
				IsConsensus string `json:"isConsensus"`
				Key         string `json:"key"`
			} `json:"trTitleList"`
			RowList []struct {
				Title   string `json:"title"`
				Columns map[string]struct {
					Value string `json:"value"`
				} `json:"columns"`
			} `json:"rowList"`
		} `json:"financeInfo"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, nil, fmt.Errorf("failed to parse naver finance response: %w", err)
	}
	ends := map[string]time.Time{}
	for _, t := range res.FinanceInfo.TrTitleList {
		if strings.EqualFold(t.IsConsensus, "Y") {
			continue // 추정(컨센서스) 열은 무시
		}
		ym, perr := time.Parse("200601", t.Key)
		if perr != nil {
			continue
		}
		ends[t.Key] = ym.AddDate(0, 1, -1) // 월말
	}
	for _, row := range res.FinanceInfo.RowList {
		var dst *[]PeriodValue
		switch strings.ToUpper(strings.TrimSpace(row.Title)) {
		case "EPS":
			dst = &eps
		case "BPS":
			dst = &bps
		default:
			continue
		}
		for key, col := range row.Columns {
			end, ok := ends[key]
			if !ok {
				continue
			}
			if v := parseLooseNumber(col.Value); v != 0 {
				*dst = append(*dst, PeriodValue{End: end, Value: v})
			}
		}
		sortPeriods(*dst)
	}
	return eps, bps, nil
}

// ---- Yahoo ----

func (s *FundamentalsService) fetchYahooHistory(ticker string) (*FundamentalHistory, error) {
	// crumb 은 필수는 아니지만 있으면 붙인다. 얻지 못해도 crumb 없이 시도한다.
	crumb, _ := s.currentCrumb()
	now := s.clock()
	for attempt := 0; ; attempt++ {
		u := fmt.Sprintf("%s/%s?type=quarterlyDilutedEPS,annualDilutedEPS,quarterlyStockholdersEquity,quarterlyOrdinarySharesNumber&period1=%d&period2=%d",
			s.yahooSeriesURL, url.PathEscape(ticker), now.AddDate(-6, 0, 0).Unix(), now.Unix())
		if crumb != "" {
			u += "&crumb=" + url.QueryEscape(crumb)
		}
		status, body, err := s.get(u)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch yahoo fundamentals history: %w", err)
		}
		switch {
		case status == http.StatusOK:
			return parseYahooTimeseries(body)
		case status == http.StatusNotFound:
			return &FundamentalHistory{Source: fundamentalsSourceYahoo}, nil
		case (status == http.StatusUnauthorized || status == http.StatusForbidden) && attempt == 0:
			c, rerr := s.refreshCrumb()
			if rerr != nil {
				return nil, rerr
			}
			crumb = c
		default:
			return nil, fmt.Errorf("yahoo timeseries API returned status code: %d", status)
		}
	}
}

// parseYahooTimeseries 는 fundamentals-timeseries 응답을 EPS/BPS 이력으로 바꾼다.
// BPS 는 같은 asOfDate 의 StockholdersEquity / OrdinarySharesNumber 이다.
func parseYahooTimeseries(body []byte) (*FundamentalHistory, error) {
	var res struct {
		Timeseries struct {
			Result []map[string]json.RawMessage `json:"result"`
		} `json:"timeseries"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("failed to parse yahoo timeseries response: %w", err)
	}
	type item struct {
		AsOfDate      string   `json:"asOfDate"`
		CurrencyCode  string   `json:"currencyCode"`
		ReportedValue yahooNum `json:"reportedValue"`
	}
	h := &FundamentalHistory{Source: fundamentalsSourceYahoo}
	read := func(key string) (out []PeriodValue) {
		for _, r := range res.Timeseries.Result {
			raw, ok := r[key]
			if !ok {
				continue
			}
			var items []item
			if json.Unmarshal(raw, &items) != nil {
				continue
			}
			for _, it := range items {
				end, err := time.Parse("2006-01-02", it.AsOfDate)
				if err != nil || it.ReportedValue == 0 {
					continue
				}
				if h.Currency == "" && it.CurrencyCode != "" && strings.HasSuffix(key, "EPS") {
					h.Currency = strings.ToUpper(it.CurrencyCode)
				}
				out = append(out, PeriodValue{End: end, Value: float64(it.ReportedValue)})
			}
		}
		sortPeriods(out)
		return out
	}
	h.QuarterlyEPS = read("quarterlyDilutedEPS")
	h.AnnualEPS = read("annualDilutedEPS")
	equity, shares := read("quarterlyStockholdersEquity"), read("quarterlyOrdinarySharesNumber")
	shareAt := map[time.Time]float64{}
	for _, p := range shares {
		shareAt[p.End] = p.Value
	}
	for _, e := range equity {
		if n := shareAt[e.End]; n > 0 && e.Value > 0 {
			h.QuarterlyBPS = append(h.QuarterlyBPS, PeriodValue{End: e.End, Value: e.Value / n})
		}
	}
	return h, nil
}
