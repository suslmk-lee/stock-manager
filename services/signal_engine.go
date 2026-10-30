package services

import (
	"sort"
	"strings"
	"time"

	"stock-manager/models"
)

const (
	SignalSell     = "SELL"
	SignalBuy      = "BUY"
	SignalHold     = "HOLD"
	SignalConflict = "CONFLICT"
	SignalNoPrice  = "NO_PRICE"
)

// SignalCheck 는 활성화된 규칙 하나의 평가 결과다.
type SignalCheck struct {
	Code      string  `json:"code"`
	Label     string  `json:"label"`
	Met       bool    `json:"met"`
	Value     float64 `json:"value"`
	Threshold float64 `json:"threshold"`
	Unit      string  `json:"unit"`
}

type SignalAccountBreakdown struct {
	AccountID      uint    `json:"account_id"`
	AccountName    string  `json:"account_name"`
	Broker         string  `json:"broker"`
	AccountType    string  `json:"account_type"`
	Restricted     bool    `json:"restricted"`
	Quantity       float64 `json:"quantity"`
	AvgPrice       float64 `json:"avg_price"`
	MarketValueKRW float64 `json:"market_value_krw"`
}

type SignalItem struct {
	AssetID    uint   `json:"asset_id"`
	Ticker     string `json:"ticker"`
	Name       string `json:"name"`
	Currency   string `json:"currency"`
	Action     string `json:"action"`
	RuleSource string `json:"rule_source"`

	RestrictedOnly bool `json:"restricted_only"`

	Quantity     float64 `json:"quantity"`
	AvgPrice     float64 `json:"avg_price"`
	CurrentPrice float64 `json:"current_price"`

	MarketValueKRW  float64 `json:"market_value_krw"`
	CostKRW         float64 `json:"cost_krw"`
	TotalReturnKRW  float64 `json:"total_return_krw"`
	DividendsKRW    float64 `json:"dividends_krw"`
	Dividends12mKRW float64 `json:"dividends_12m_krw"`
	UnrealizedPct   float64 `json:"unrealized_pct"`
	TotalReturnPct  float64 `json:"total_return_pct"`
	DividendPayback float64 `json:"dividend_payback_pct"`
	CurrentYieldPct float64 `json:"current_yield_pct"`
	YieldOnCostPct  float64 `json:"yield_on_cost_pct"`
	WeightPct       float64 `json:"weight_pct"`
	FromAvgPct      float64 `json:"from_avg_pct"`

	SellChecks []SignalCheck            `json:"sell_checks"`
	BuyChecks  []SignalCheck            `json:"buy_checks"`
	Accounts   []SignalAccountBreakdown `json:"accounts"`
}

type SignalSummary struct {
	Sell     int `json:"sell"`
	Buy      int `json:"buy"`
	Hold     int `json:"hold"`
	Conflict int `json:"conflict"`
	NoPrice  int `json:"no_price"`
}

type SignalReport struct {
	GeneratedAt string        `json:"generated_at"`
	USDKRW      float64       `json:"usd_krw"`
	Summary     SignalSummary `json:"summary"`
	Items       []SignalItem  `json:"items"`
}

// ---- 엔진 입력 (DB/네트워크와 무관한 순수 데이터) ----

type SignalHoldingInput struct {
	AccountID   uint
	AccountName string
	Broker      string
	AccountType models.AccountType
	Quantity    float64
	AvgPrice    float64 // 종목 통화 기준
}

type SignalPnLInput struct {
	Profit      float64
	BuyAvgPrice float64
	Quantity    float64
	Currency    string
}

type SignalDividendInput struct {
	Amount   float64
	Tax      float64
	Currency string
	Date     time.Time
}

type SignalAssetInput struct {
	AssetID       uint
	Ticker        string
	Name          string
	Price         float64 // 0 이하면 시세 없음
	PriceCurrency string  // 비어 있으면 티커로 추정
	Holdings      []SignalHoldingInput
	PnLs          []SignalPnLInput
	Dividends     []SignalDividendInput
	Rule          models.SignalRule
	RuleSource    string // "default" | "asset"
}

// CurrencyForTicker 는 통화 정보가 없을 때 티커 접미사로 통화를 추정한다.
func CurrencyForTicker(ticker string) string {
	t := strings.ToUpper(ticker)
	if strings.HasSuffix(t, ".KS") || strings.HasSuffix(t, ".KQ") {
		return "KRW"
	}
	return "USD"
}

func toKRW(amount float64, currency, ticker string, usdKRW float64) float64 {
	c := strings.ToUpper(strings.TrimSpace(currency))
	if c == "" {
		c = CurrencyForTicker(ticker)
	}
	if c == "USD" {
		return amount * usdKRW
	}
	return amount
}

func safeDiv(a, b float64) float64 {
	if b == 0 {
		return 0
	}
	return a / b
}

// BuildSignalReport 는 입력으로부터 지표를 계산하고 규칙을 평가한다 (순수 함수).
// 수량이 0 이하인 종목은 제외한다.
func BuildSignalReport(inputs []SignalAssetInput, usdKRW float64, now time.Time) SignalReport {
	items := make([]SignalItem, 0, len(inputs))
	rules := make(map[uint]models.SignalRule, len(inputs))
	var totalMV float64

	for _, in := range inputs {
		item, ok := computeSignalMetrics(in, usdKRW, now)
		if !ok {
			continue
		}
		rules[in.AssetID] = in.Rule
		if item.Action != SignalNoPrice {
			totalMV += item.MarketValueKRW
		}
		items = append(items, item)
	}

	report := SignalReport{
		GeneratedAt: now.Format(time.RFC3339),
		USDKRW:      usdKRW,
		Items:       items,
	}

	for i := range report.Items {
		it := &report.Items[i]
		if it.Action == SignalNoPrice {
			report.Summary.NoPrice++
			continue
		}
		it.WeightPct = safeDiv(it.MarketValueKRW, totalMV) * 100
		it.Action = evaluateSignalRule(it, rules[it.AssetID])
		switch it.Action {
		case SignalSell:
			report.Summary.Sell++
		case SignalBuy:
			report.Summary.Buy++
		case SignalConflict:
			report.Summary.Conflict++
		default:
			report.Summary.Hold++
		}
	}

	order := map[string]int{SignalSell: 0, SignalConflict: 1, SignalBuy: 2, SignalHold: 3, SignalNoPrice: 4}
	sort.SliceStable(report.Items, func(i, j int) bool {
		a, b := report.Items[i], report.Items[j]
		if order[a.Action] != order[b.Action] {
			return order[a.Action] < order[b.Action]
		}
		return a.MarketValueKRW > b.MarketValueKRW
	})
	return report
}

// computeSignalMetrics 는 한 종목의 지표를 집계한다 (비중/규칙 평가 전).
func computeSignalMetrics(in SignalAssetInput, usdKRW float64, now time.Time) (SignalItem, bool) {
	var qty, costHolding float64
	for _, h := range in.Holdings {
		qty += h.Quantity
		costHolding += h.Quantity * h.AvgPrice
	}
	if qty <= 0 {
		return SignalItem{}, false
	}

	priceCur := strings.ToUpper(strings.TrimSpace(in.PriceCurrency))
	if priceCur == "" {
		priceCur = CurrencyForTicker(in.Ticker)
	}

	item := SignalItem{
		AssetID:    in.AssetID,
		Ticker:     in.Ticker,
		Name:       in.Name,
		Currency:   priceCur,
		RuleSource: in.RuleSource,
		Quantity:   qty,
		AvgPrice:   safeDiv(costHolding, qty),
		SellChecks: []SignalCheck{},
		BuyChecks:  []SignalCheck{},
		Accounts:   []SignalAccountBreakdown{},
	}
	if item.RuleSource == "" {
		item.RuleSource = "default"
	}

	costHoldingKRW := toKRW(costHolding, priceCur, in.Ticker, usdKRW)

	allRestricted := len(in.Holdings) > 0
	for _, h := range in.Holdings {
		restricted := h.AccountType.IsWithdrawalRestricted()
		if !restricted {
			allRestricted = false
		}
		item.Accounts = append(item.Accounts, SignalAccountBreakdown{
			AccountID:      h.AccountID,
			AccountName:    h.AccountName,
			Broker:         h.Broker,
			AccountType:    string(h.AccountType),
			Restricted:     restricted,
			Quantity:       h.Quantity,
			AvgPrice:       h.AvgPrice,
			MarketValueKRW: toKRW(h.Quantity*in.Price, priceCur, in.Ticker, usdKRW),
		})
	}
	item.RestrictedOnly = allRestricted

	var realizedKRW, costSoldKRW, dividendsKRW, div12mKRW float64
	for _, p := range in.PnLs {
		realizedKRW += toKRW(p.Profit, p.Currency, in.Ticker, usdKRW)
		costSoldKRW += toKRW(p.BuyAvgPrice*p.Quantity, p.Currency, in.Ticker, usdKRW)
	}
	cutoff := now.AddDate(0, 0, -365)
	for _, d := range in.Dividends {
		net := toKRW(d.Amount-d.Tax, d.Currency, in.Ticker, usdKRW)
		dividendsKRW += net
		if !d.Date.Before(cutoff) && !d.Date.After(now) {
			div12mKRW += net
		}
	}
	item.DividendsKRW = dividendsKRW
	item.Dividends12mKRW = div12mKRW

	if in.Price <= 0 {
		item.Action = SignalNoPrice
		item.CostKRW = costHoldingKRW + costSoldKRW
		item.DividendPayback = safeDiv(dividendsKRW, item.CostKRW) * 100
		for i := range item.Accounts {
			item.Accounts[i].MarketValueKRW = 0
		}
		return item, true
	}

	item.CurrentPrice = in.Price
	item.MarketValueKRW = toKRW(qty*in.Price, priceCur, in.Ticker, usdKRW)
	unrealizedKRW := item.MarketValueKRW - costHoldingKRW
	item.CostKRW = costHoldingKRW + costSoldKRW
	item.TotalReturnKRW = unrealizedKRW + realizedKRW + dividendsKRW
	item.UnrealizedPct = safeDiv(unrealizedKRW, costHoldingKRW) * 100
	item.TotalReturnPct = safeDiv(item.TotalReturnKRW, item.CostKRW) * 100
	item.DividendPayback = safeDiv(dividendsKRW, item.CostKRW) * 100
	item.CurrentYieldPct = safeDiv(div12mKRW, item.MarketValueKRW) * 100
	item.YieldOnCostPct = safeDiv(div12mKRW, costHoldingKRW) * 100
	if item.AvgPrice > 0 {
		item.FromAvgPct = (in.Price - item.AvgPrice) / item.AvgPrice * 100
	}
	item.Action = SignalHold
	return item, true
}

// evaluateSignalRule 은 item 의 지표(비중 포함)로 규칙을 평가해 Checks 를 채우고 액션을 돌려준다.
func evaluateSignalRule(it *SignalItem, r models.SignalRule) string {
	sell := []SignalCheck{}
	buy := []SignalCheck{}

	if r.TakeProfitEnabled {
		sell = append(sell, SignalCheck{"take_profit", "목표 수익률", it.TotalReturnPct >= r.TakeProfitPct, it.TotalReturnPct, r.TakeProfitPct, "%"})
	}
	if r.StopLossEnabled {
		sell = append(sell, SignalCheck{"stop_loss", "손절선", it.TotalReturnPct <= r.StopLossPct, it.TotalReturnPct, r.StopLossPct, "%"})
	}
	if r.WeightEnabled && r.TargetWeightPct > 0 {
		th := r.TargetWeightPct + r.WeightBandPct
		sell = append(sell, SignalCheck{"weight_over", "비중 초과", it.WeightPct >= th, it.WeightPct, th, "%"})
	}
	if r.DividendPaybackEnabled {
		met := it.DividendPayback >= r.DividendPaybackPct && it.TotalReturnPct >= r.DividendPaybackMinReturnPct
		sell = append(sell, SignalCheck{"dividend_payback", "배당 회수", met, it.DividendPayback, r.DividendPaybackPct, "%"})
	}
	if r.LowYieldEnabled {
		met := it.Dividends12mKRW > 0 && it.CurrentYieldPct <= r.LowYieldPct
		sell = append(sell, SignalCheck{"low_yield", "배당수익률 하락", met, it.CurrentYieldPct, r.LowYieldPct, "%"})
	}

	if r.BuyDipEnabled {
		buy = append(buy, SignalCheck{"buy_dip", "평단 대비 하락", it.FromAvgPct <= r.BuyDipPct, it.FromAvgPct, r.BuyDipPct, "%"})
	}
	if r.WeightEnabled && r.TargetWeightPct > 0 {
		th := r.TargetWeightPct - r.WeightBandPct
		buy = append(buy, SignalCheck{"weight_under", "비중 미달", it.WeightPct <= th, it.WeightPct, th, "%"})
	}
	if r.HighYieldEnabled {
		buy = append(buy, SignalCheck{"high_yield", "배당수익률 상승", it.CurrentYieldPct >= r.HighYieldPct, it.CurrentYieldPct, r.HighYieldPct, "%"})
	}

	it.SellChecks = sell
	it.BuyChecks = buy

	sellHit := checksHit(sell, r.SellMode)
	buyHit := checksHit(buy, r.BuyMode)
	switch {
	case sellHit && buyHit:
		return SignalConflict
	case sellHit:
		return SignalSell
	case buyHit:
		return SignalBuy
	}
	return SignalHold
}

func checksHit(checks []SignalCheck, mode string) bool {
	if len(checks) == 0 {
		return false
	}
	if mode == "all" {
		for _, c := range checks {
			if !c.Met {
				return false
			}
		}
		return true
	}
	for _, c := range checks {
		if c.Met {
			return true
		}
	}
	return false
}
