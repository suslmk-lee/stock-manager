package services

import (
	"math"
	"reflect"
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
	RuleSource string `json:"rule_source"` // "asset" | "profile" | "default"

	ProfileID    uint   `json:"profile_id"`
	ProfileKey   string `json:"profile_key"`
	ProfileName  string `json:"profile_name"`
	ProfileKind  string `json:"profile_kind"`
	SellDisabled bool   `json:"sell_disabled"` // 적용된 규칙에 켜진 매도 체크가 없음
	// 보유 수량이 규칙의 기준(주) 이하라 매도 검토에서 제외됨 (매도 조건 표시는 그대로 둔다)
	SellExcludedSmallQty bool    `json:"sell_excluded_small_qty,omitempty"`
	MinSellQty           float64 `json:"min_sell_qty,omitempty"`

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

	// 시세 추세 (종목 통화, 0 = 없음)
	High52w        float64 `json:"high_52w"`
	Low52w         float64 `json:"low_52w"`
	MA200          float64 `json:"ma200"`
	FromHighPct    float64 `json:"from_high_pct"`
	FromLowPct     float64 `json:"from_low_pct"`
	VsMA200Pct     float64 `json:"vs_ma200_pct"`
	PriceHistoryOK bool    `json:"price_history_ok"`

	// 익절 지표: 고점(보유 시작일 이후 일봉 종가 + 현재가), 평균 보유일, 연환산 수익률, 원가 비중
	PeakPrice           float64 `json:"peak_price"`
	PeakDate            string  `json:"peak_date,omitempty"`
	PeakGainPct         float64 `json:"peak_gain_pct"`
	FromPeakPct         float64 `json:"from_peak_pct"`
	HoldingDays         int     `json:"holding_days"`
	AnnualizedReturnPct float64 `json:"annualized_return_pct"`
	CostWeightPct       float64 `json:"cost_weight_pct"`

	// 매도 신호 시 일부 매도/리밸런싱 제안 (이익 실현 성격의 신호만 충족된 경우)
	SuggestedSellQty  float64 `json:"suggested_sell_qty,omitempty"`
	SuggestedSellKRW  float64 `json:"suggested_sell_krw,omitempty"`
	SuggestedSellKind string  `json:"suggested_sell_kind,omitempty"` // "partial" | "rebalance"

	// 마지막 매수 (전 계좌 중 가장 최근 매수 거래, 종목 통화). 규칙이 꺼져 있어도 매수 이력이 있으면 채운다.
	LastBuyDate      string  `json:"last_buy_date,omitempty"`
	LastBuyPrice     float64 `json:"last_buy_price,omitempty"`
	FromLastBuyPct   float64 `json:"from_last_buy_pct,omitempty"`
	DaysSinceLastBuy int     `json:"days_since_last_buy,omitempty"`

	// 매수 제외 (쿨다운 / 최대 비중): 매수 조건이 충족돼도 매수 검토에서 뺀다
	BuyExcludedReason string  `json:"buy_excluded_reason,omitempty"` // "cooldown" | "max_weight" | "no_rebound"
	BuyMaxWeightPct   float64 `json:"buy_max_weight_pct,omitempty"`
	BuyCooldownDays   int     `json:"buy_cooldown_days,omitempty"`

	// 매수 신호 시 추가 매수 수량 제안
	SuggestedBuyQty  float64 `json:"suggested_buy_qty,omitempty"`
	SuggestedBuyKRW  float64 `json:"suggested_buy_krw,omitempty"`
	SuggestedBuyKind string  `json:"suggested_buy_kind,omitempty"` // "amount" | "target_weight" | "lower_avg"

	// 단기 흐름: 최근 저점 대비 반등(매수 확인)과 최근 N거래일 변화율. 시세 이력이 있으면 규칙과 무관하게 채운다.
	RecentLowPrice   float64 `json:"recent_low_price,omitempty"`
	FromRecentLowPct float64 `json:"from_recent_low_pct,omitempty"`
	MA20             float64 `json:"ma20,omitempty"`
	// 하회 후 반등 지표: 200일선 괴리 최솟값 / 20일 이평 상승 / 200일선 상향 돌파 후 경과 / 52주 고점 대비 최대 낙폭 / 저점 대비 반등 폭
	MA200MinDevPct      float64 `json:"ma200_min_dev_pct,omitempty"`
	MA20Rising          bool    `json:"ma20_rising,omitempty"`
	MA200ReclaimDaysAgo int     `json:"ma200_reclaim_days_ago,omitempty"`
	FromHighDeepestPct  float64 `json:"from_high_deepest_pct,omitempty"`
	FromLowReboundPct   float64 `json:"from_low_rebound_pct,omitempty"`
	ReboundConfirmed    bool    `json:"rebound_confirmed,omitempty"`
	ReboundLookbackDays int     `json:"rebound_lookback_days,omitempty"`
	ShortChangePct      float64 `json:"short_change_pct,omitempty"`
	ShortChangeDays     int     `json:"short_change_days,omitempty"`

	// RSI / MFI: 이력의 마지막 종가 기준(오늘 실시간 가격 제외), 계산 가능하면 규칙과 무관하게 채운다. *Min 은 rule.osc_lookback_days 구간 최솟값.
	RSI    float64 `json:"rsi,omitempty"`
	RSIMin float64 `json:"rsi_min,omitempty"`
	MFI    float64 `json:"mfi,omitempty"`
	MFIMin float64 `json:"mfi_min,omitempty"`

	// 펀더멘털 (0 = 없음). 소스는 "yahoo" | "naver", AsOf 는 조회 일자(YYYY-MM-DD, KST)
	PER                float64 `json:"per,omitempty"`
	ForwardPER         float64 `json:"forward_per,omitempty"`
	PBR                float64 `json:"pbr,omitempty"`
	EPS                float64 `json:"eps,omitempty"`
	BPS                float64 `json:"bps,omitempty"`
	FundamentalsSource string  `json:"fundamentals_source,omitempty"`
	FundamentalsAsOf   string  `json:"fundamentals_as_of,omitempty"`

	trend TrendMetrics // 하회 후 반등 판단 지표 (JSON 제외)

	hasLastBuy bool // 마지막 매수 거래 존재 여부 (DaysSinceLastBuy 0 과 구분)

	// 주당 배당 추세 (세전, 종목 통화)
	DPS12m            float64 `json:"dps_12m"`
	DPSPrev12m        float64 `json:"dps_prev_12m"`
	DividendChangePct float64 `json:"dividend_change_pct"`
	DividendTrendOK   bool    `json:"dividend_trend_ok"`

	// 배당수익률 압축(최근 24개월 월말 평균 대비 현재)과 변동성 대비 200일 이평 괴리
	DividendYieldAvgPct   float64 `json:"dividend_yield_avg_pct,omitempty"`
	DividendYieldVsAvgPct float64 `json:"dividend_yield_vs_avg_pct,omitempty"`
	DividendYieldPoints   int     `json:"dividend_yield_points,omitempty"`
	DividendYieldSource   string  `json:"dividend_yield_source,omitempty"` // "market" | "records"
	VolatilityPct         float64 `json:"volatility_pct,omitempty"`        // 연환산 %
	MA200Sigma            float64 `json:"ma200_sigma,omitempty"`

	// 매수 시점 환율 기준 수익
	CostKRWFx        float64 `json:"cost_krw_fx"`
	TotalReturnPctFx float64 `json:"total_return_pct_fx"`
	FxEffectKRW      float64 `json:"fx_effect_krw"`
	FxCoveragePct    float64 `json:"fx_coverage_pct"`
	ReturnBasis      string  `json:"return_basis"` // "fx" | "current"

	TaxHint *TaxHint `json:"tax_hint"`

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
	Tax         *TaxSummary   `json:"tax"`

	// Candidates 는 보유 종목별 배당 장기보유 후보 평가 (내부용: 알림/후보 API).
	Candidates []DividendCandidate `json:"-"`
}

// SignalContext 는 순수 엔진에 주입하는 외부 데이터(환율 이력, 양도세 요약)다.
type SignalContext struct {
	FxAt func(time.Time) float64 // 날짜별 USD/KRW. nil 이면 환율 이력 없음
	FxOK bool                    // 환율 이력이 실제로 로드됐는가
	Tax  *TaxSummary
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

type SignalTxnInput struct {
	AccountID uint
	Type      models.TransactionType
	Date      time.Time
	Quantity  float64
	Price     float64
	Fee       float64
}

type SignalPnLInput struct {
	Date        time.Time
	Profit      float64
	BuyAvgPrice float64
	Quantity    float64
	Currency    string
}

type SignalDividendInput struct {
	AccountID uint
	Amount    float64
	Tax       float64
	Currency  string
	Date      time.Time
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
	Txns          []SignalTxnInput
	Fundamentals  *Fundamentals   // PER/PBR 등. nil 이면 없음
	History       []PricePoint    // 일봉 종가 (종목 통화). 비어 있으면 추세 지표 없음
	DivEvents     []DividendEvent // 시장(Yahoo) 주당배당 이벤트. 비어 있으면 사용자 배당 기록으로 대체
	Rule          models.SignalRuleConfig
	RuleSource    string // "asset" | "profile" | "default"
	Sector        string
	ProfileID     uint
	ProfileKey    string
	ProfileName   string
	ProfileKind   string
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
func BuildSignalReport(inputs []SignalAssetInput, usdKRW float64, now time.Time, ctx SignalContext) SignalReport {
	items := make([]SignalItem, 0, len(inputs))
	rules := make(map[uint]models.SignalRuleConfig, len(inputs))
	var totalMV, totalCost float64
	var candidates []DividendCandidate
	priced := map[uint]bool{}
	eligible := map[uint]bool{}

	for _, in := range inputs {
		item, ok := computeSignalMetrics(in, usdKRW, now, ctx)
		if !ok {
			continue
		}
		rules[in.AssetID] = in.Rule
		cand := ScoreDividendCandidate(candidateInputOf(in, item, now))
		cand.ProfileID, cand.ProfileName = item.ProfileID, item.ProfileName
		cand.HasOverride = item.RuleSource == "asset"
		candidates = append(candidates, cand)
		priced[in.AssetID] = item.Action != SignalNoPrice
		eligible[in.AssetID] = item.RuleSource == "default"
		if item.Action != SignalNoPrice {
			totalMV += item.MarketValueKRW
			totalCost += item.CostKRW
		}
		items = append(items, item)
	}

	report := SignalReport{
		GeneratedAt: now.Format(time.RFC3339),
		USDKRW:      usdKRW,
		Items:       items,
		Tax:         ctx.Tax,
		Candidates:  candidates,
	}
	for i := range report.Candidates {
		id := report.Candidates[i].AssetID
		report.Candidates[i].priced = priced[id]
		report.Candidates[i].unassigned = eligible[id]
	}

	for i := range report.Items {
		it := &report.Items[i]
		if it.Action == SignalNoPrice {
			report.Summary.NoPrice++
			continue
		}
		it.WeightPct = safeDiv(it.MarketValueKRW, totalMV) * 100
		it.CostWeightPct = safeDiv(it.CostKRW, totalCost) * 100
		it.Action = evaluateSignalRule(it, rules[it.AssetID])
		applySellSuggestion(it, rules[it.AssetID], totalMV)
		applyBuySuggestion(it, rules[it.AssetID], totalMV)
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
func computeSignalMetrics(in SignalAssetInput, usdKRW float64, now time.Time, ctx SignalContext) (SignalItem, bool) {
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
		ProfileID:  in.ProfileID, ProfileKey: in.ProfileKey, ProfileName: in.ProfileName, ProfileKind: in.ProfileKind,
		Quantity:   qty,
		AvgPrice:   safeDiv(costHolding, qty),
		SellChecks: []SignalCheck{},
		BuyChecks:  []SignalCheck{},
		Accounts:   []SignalAccountBreakdown{},

		ReturnBasis: "current",
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

	// 배당 추세: 전 계좌 세전 배당, 계좌별 현재 수량에서 역추적한 당시 수량 사용.
	currentQty := map[uint]float64{}
	for _, h := range in.Holdings {
		currentQty[h.AccountID] += h.Quantity
	}
	acctTxns := make([]AcctTxn, 0, len(in.Txns))
	for _, tx := range in.Txns {
		acctTxns = append(acctTxns, AcctTxn{AccountID: tx.AccountID, Type: tx.Type, Date: tx.Date, Quantity: tx.Quantity})
	}
	divEvents := make([]DivEvent, 0, len(in.Dividends))
	for _, d := range in.Dividends {
		divEvents = append(divEvents, DivEvent{AccountID: d.AccountID, Date: d.Date, Amount: d.Amount})
	}
	if len(divEvents) > 0 {
		tr := DividendTrendOf(divEvents, QuantityAtFunc(currentQty, acctTxns), now)
		item.DPS12m, item.DPSPrev12m = tr.DPS12m, tr.DPSPrev12m
		item.DividendTrendOK = tr.OK
		if tr.OK {
			item.DividendChangePct = tr.ChangePct
		}
	}

	applyLastBuy(&item, in.Txns, in.Price, now)

	if in.Price <= 0 {
		item.Action = SignalNoPrice
		item.CostKRW = costHoldingKRW + costSoldKRW
		item.CostKRWFx = item.CostKRW
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

	// 평균 보유일 / 고점: 현재 보유 로트를 거래에서 FIFO 로 재구성한다.
	lots := heldLotsFIFO(in.Txns, in.Holdings)
	item.HoldingDays = int(math.Round(weightedHoldingDays(lots, now)))
	if len(in.History) > 0 {
		since, _ := firstBuyDate(lots) // 거래 정보가 없으면 zero -> 조회된 전체 구간
		peak, peakDate := peakCloseSince(in.History, since, now)
		if in.Price >= peak { // 오늘 현재가도 고점 후보
			peak, peakDate = in.Price, now.In(time.FixedZone("KST", kstOffsetSec)).Format("2006-01-02")
		}
		if peak > 0 {
			item.PeakPrice, item.PeakDate = peak, peakDate
			item.FromPeakPct = (in.Price/peak - 1) * 100
			if item.AvgPrice > 0 {
				item.PeakGainPct = (peak/item.AvgPrice - 1) * 100
			}
		}
	}

	// 시세 추세
	if len(in.History) > 0 {
		st := ComputePriceStats(in.History, now)
		item.High52w, item.Low52w, item.MA200 = st.High52w, st.Low52w, st.MA200
		item.PriceHistoryOK = st.High52w > 0 && st.Points >= 20
		if item.PriceHistoryOK {
			item.FromHighPct = (in.Price/st.High52w - 1) * 100
		}
		if item.PriceHistoryOK && st.Low52w > 0 {
			item.FromLowPct = (in.Price/st.Low52w - 1) * 100
		}
		if st.MA200 > 0 {
			item.VsMA200Pct = (in.Price/st.MA200 - 1) * 100
		}
	}

	computeShortTermMetrics(&item, in, now)
	computeTrendMetrics(&item, in, now)
	computeOscMetrics(&item, in, now)
	applyFundamentals(&item, in.Fundamentals)
	computeYieldMetrics(&item, in, QuantityAtFunc(currentQty, acctTxns), now)
	computeVolMetrics(&item, in, now)

	computeFxMetrics(&item, in, priceCur, usdKRW, ctx)

	// 양도세 힌트: 해외상장(USD) 종목의 일반계좌 평가손익 기준
	if ctx.Tax != nil && in.Rule.TaxHarvestEnabled {
		var generalUnrealizedKRW float64
		for _, h := range in.Holdings {
			if h.AccountType == models.AccountTypeGeneral {
				generalUnrealizedKRW += toKRW(h.Quantity*(in.Price-h.AvgPrice), priceCur, in.Ticker, usdKRW)
			}
		}
		item.TaxHint = TaxHintFor(*ctx.Tax, priceCur == "USD", generalUnrealizedKRW)
	}
	return item, true
}

// computeFxMetrics 는 매수 시점 환율 기준 수익을 계산한다.
// 단순화 규정: 보유분 원가는 ReplayKRWCost(이동평균, 매수일 환율), 매도분 원가는
// BuyAvgPrice×수량×매도일 환율, 실현손익은 Profit×매도일 환율, 배당은 (세전-세)×지급일 환율.
// USD 종목이 아니거나 환율 이력이 없으면 fx 필드는 현재 환율 기준 값과 같다.
func computeFxMetrics(item *SignalItem, in SignalAssetInput, priceCur string, usdKRW float64, ctx SignalContext) {
	item.CostKRWFx = item.CostKRW
	item.TotalReturnPctFx = item.TotalReturnPct
	item.FxEffectKRW = 0
	if priceCur != "USD" {
		item.FxCoveragePct = 100
		return
	}
	if !ctx.FxOK || ctx.FxAt == nil {
		return
	}
	fxAt := func(t time.Time) float64 {
		if v := ctx.FxAt(t); finite(v) && v > 0 {
			return v
		}
		return usdKRW
	}
	conv := func(amount float64, cur string, t time.Time) float64 {
		c := strings.ToUpper(strings.TrimSpace(cur))
		if c == "" {
			c = CurrencyForTicker(in.Ticker)
		}
		if c == "USD" {
			return amount * fxAt(t)
		}
		return amount
	}

	var holdCostFx, covered, totalQty float64
	for _, h := range in.Holdings {
		var txns []FxTxn
		for _, tx := range in.Txns {
			if tx.AccountID == h.AccountID {
				txns = append(txns, FxTxn{Type: tx.Type, Date: tx.Date, Quantity: tx.Quantity, Price: tx.Price, Fee: tx.Fee})
			}
		}
		c, cov := ReplayKRWCost(txns, h.Quantity, h.AvgPrice, "USD", fxAt, usdKRW)
		holdCostFx += c
		covered += cov
		totalQty += h.Quantity
	}
	var realizedFx, soldCostFx, divFx float64
	for _, p := range in.PnLs {
		realizedFx += conv(p.Profit, p.Currency, p.Date)
		soldCostFx += conv(p.BuyAvgPrice*p.Quantity, p.Currency, p.Date)
	}
	for _, d := range in.Dividends {
		divFx += conv(d.Amount-d.Tax, d.Currency, d.Date)
	}
	costFx := holdCostFx + soldCostFx
	totalFx := item.MarketValueKRW - holdCostFx + realizedFx + divFx
	item.CostKRWFx = costFx
	item.TotalReturnPctFx = safeDiv(totalFx, costFx) * 100
	item.FxEffectKRW = totalFx - item.TotalReturnKRW
	item.FxCoveragePct = safeDiv(covered, totalQty) * 100
	if in.Rule.FxHistorical {
		item.ReturnBasis = "fx"
	}
}

// evaluateSignalRule 은 item 의 지표(비중 포함)로 규칙을 평가해 Checks 를 채우고 액션을 돌려준다.
func evaluateSignalRule(it *SignalItem, r models.SignalRuleConfig) string {
	sell := []SignalCheck{}
	buy := []SignalCheck{}

	ret := it.TotalReturnPct
	if it.ReturnBasis == "fx" {
		ret = it.TotalReturnPctFx
	}

	if r.TakeProfitEnabled {
		sell = append(sell, SignalCheck{"take_profit", "목표 수익률", ret >= r.TakeProfitPct, ret, r.TakeProfitPct, "%"})
	}
	if r.StopLossEnabled {
		sell = append(sell, SignalCheck{"stop_loss", "손절선", ret <= r.StopLossPct, ret, r.StopLossPct, "%"})
	}
	if r.VolStopEnabled {
		th := -r.VolStopK * it.VolatilityPct
		sell = append(sell, SignalCheck{"vol_stop", "변동성 기준 손절", it.VolatilityPct > 0 && ret <= th, ret, th, "%"})
	}
	if r.CrashEnabled {
		sell = append(sell, SignalCheck{"crash", "큰 폭락 경고", ret <= r.CrashPct, ret, r.CrashPct, "%"})
	}
	if r.WeightEnabled && r.TargetWeightPct > 0 {
		th := r.TargetWeightPct + r.WeightBandPct
		sell = append(sell, SignalCheck{"weight_over", "비중 초과", it.WeightPct >= th, it.WeightPct, th, "%"})
	}
	if r.DividendPaybackEnabled {
		met := it.DividendPayback >= r.DividendPaybackPct && ret >= r.DividendPaybackMinReturnPct
		sell = append(sell, SignalCheck{"dividend_payback", "배당 회수", met, it.DividendPayback, r.DividendPaybackPct, "%"})
	}
	if r.LowYieldEnabled {
		met := it.Dividends12mKRW > 0 && it.CurrentYieldPct <= r.LowYieldPct
		sell = append(sell, SignalCheck{"low_yield", "배당수익률 하락", met, it.CurrentYieldPct, r.LowYieldPct, "%"})
	}
	if r.TrailingEnabled {
		met := it.PriceHistoryOK && it.PeakPrice > 0 && it.PeakGainPct >= r.TrailingActivatePct && it.FromPeakPct <= r.TrailingDropPct
		sell = append(sell, SignalCheck{"trailing_stop", "고점 대비 되돌림", met, it.FromPeakPct, r.TrailingDropPct, "%"})
	}
	it.AnnualizedReturnPct = annualizedReturnPct(ret, float64(it.HoldingDays))
	if r.AnnualizedEnabled {
		met := it.HoldingDays >= r.AnnualizedMinDays && ret >= r.AnnualizedMinReturnPct && it.AnnualizedReturnPct >= r.AnnualizedPct
		sell = append(sell, SignalCheck{"annualized_return", "연환산 수익률", met, it.AnnualizedReturnPct, r.AnnualizedPct, "%"})
	}
	if r.DriftEnabled && r.DriftPct > 0 {
		drift := it.WeightPct - it.CostWeightPct
		sell = append(sell, SignalCheck{"weight_drift", "비중 쏠림", drift >= r.DriftPct, drift, r.DriftPct, "%p"})
	}
	if r.AboveMAEnabled {
		met := it.PriceHistoryOK && it.MA200 > 0 && it.VsMA200Pct >= r.AboveMAPct
		sell = append(sell, SignalCheck{"above_ma", "장기 이평 과열", met, it.VsMA200Pct, r.AboveMAPct, "%"})
	}
	if r.YieldCompressionEnabled {
		met := it.DividendYieldPoints >= yieldMinPoints && it.DividendYieldVsAvgPct <= -r.YieldCompressionPct
		sell = append(sell, SignalCheck{"yield_compression", "배당수익률 압축", met, it.DividendYieldVsAvgPct, -r.YieldCompressionPct, "%"})
	}
	if r.VolOverheatEnabled {
		met := it.VolatilityPct > 0 && it.MA200 > 0 && it.MA200Sigma >= r.VolOverheatSigma
		sell = append(sell, SignalCheck{"vol_overheat", "변동성 대비 과열", met, it.MA200Sigma, r.VolOverheatSigma, "σ"})
	}
	if r.TimeStopEnabled {
		met := it.HoldingDays > 0 && it.HoldingDays >= r.TimeStopDays && ret <= r.TimeStopMaxReturnPct
		sell = append(sell, SignalCheck{"time_stop", "시간 손절", met, ret, r.TimeStopMaxReturnPct, "%"})
	}
	if r.ShortDropEnabled {
		met := it.ShortChangeDays > 0 && it.ShortChangePct <= r.ShortDropPct
		sell = append(sell, SignalCheck{"short_drop", "단기 급락", met, it.ShortChangePct, r.ShortDropPct, "%"})
	}
	if r.RsiSellEnabled {
		sell = append(sell, SignalCheck{"rsi_overbought", "RSI 과열", it.RSI > 0 && it.RSI >= r.RsiSellLevel, it.RSI, r.RsiSellLevel, ""})
	}
	if r.MfiSellEnabled {
		sell = append(sell, SignalCheck{"mfi_overbought", "MFI 과열", it.MFI > 0 && it.MFI >= r.MfiSellLevel, it.MFI, r.MfiSellLevel, ""})
	}
	if r.PerSellEnabled {
		sell = append(sell, SignalCheck{"per_high", "PER 고평가", it.PER > 0 && it.PER >= r.PerSellMin, it.PER, r.PerSellMin, "배"})
	}
	if r.PbrSellEnabled {
		sell = append(sell, SignalCheck{"pbr_high", "PBR 고평가", it.PBR > 0 && it.PBR >= r.PbrSellMin, it.PBR, r.PbrSellMin, "배"})
	}
	if r.DividendCutEnabled {
		met := it.DividendTrendOK && it.DividendChangePct <= -r.DividendCutPct
		sell = append(sell, SignalCheck{"dividend_cut", "배당 삭감", met, it.DividendChangePct, -r.DividendCutPct, "%"})
	}

	if r.BuyDipEnabled {
		buy = append(buy, SignalCheck{"buy_dip", "평단 대비 하락", it.FromAvgPct <= r.BuyDipPct, it.FromAvgPct, r.BuyDipPct, "%"})
	}
	if r.LastBuyDipEnabled {
		met := it.hasLastBuy && it.FromLastBuyPct <= r.LastBuyDipPct
		buy = append(buy, SignalCheck{"last_buy_dip", "마지막 매수가 대비 하락", met, it.FromLastBuyPct, r.LastBuyDipPct, "%"})
	}
	if r.WeightEnabled && r.TargetWeightPct > 0 {
		th := r.TargetWeightPct - r.WeightBandPct
		buy = append(buy, SignalCheck{"weight_under", "비중 미달", it.WeightPct <= th, it.WeightPct, th, "%"})
	}
	if r.HighYieldEnabled {
		buy = append(buy, SignalCheck{"high_yield", "배당수익률 상승", it.CurrentYieldPct >= r.HighYieldPct, it.CurrentYieldPct, r.HighYieldPct, "%"})
	}
	if r.FromHighEnabled {
		met, label := it.PriceHistoryOK && it.FromHighPct <= r.FromHighPct, "52주 고점 대비 하락"
		if r.FromHighMode == trendModeRebound {
			label = "52주 고점 대비 하락 후 반등"
			met = it.PriceHistoryOK && FromHighReboundMet(it.trend, it.trend.Price, r.FromHighPct, it.FromHighPct, r.FromHighReboundPct, r.FromHighStillBelowPct)
		}
		buy = append(buy, SignalCheck{"from_high", label, met, it.FromHighPct, r.FromHighPct, "%"})
	}
	if r.BelowMAEnabled {
		met, label, thr := it.MA200 > 0 && it.VsMA200Pct <= r.BelowMAPct, "장기 이평 하회", r.BelowMAPct
		switch r.BelowMAMode {
		case trendModeRebound:
			label = "장기 이평 하회 후 반등"
			met = it.MA200 > 0 && BelowMAMet(it.trend, r.BelowMAMode, it.trend.Price, it.VsMA200Pct, r.BelowMAPct, r.BelowMAMaxAbovePct, r.BelowMAReclaimDays)
		case trendModeReclaim:
			label, thr = "200일선 회복", 0
			met = it.MA200 > 0 && BelowMAMet(it.trend, r.BelowMAMode, it.trend.Price, it.VsMA200Pct, r.BelowMAPct, r.BelowMAMaxAbovePct, r.BelowMAReclaimDays)
		}
		buy = append(buy, SignalCheck{"below_ma", label, met, it.VsMA200Pct, thr, "%"})
	}

	if r.YieldExpansionEnabled {
		met := it.DividendYieldPoints >= yieldMinPoints && it.DividendYieldVsAvgPct >= r.YieldExpansionPct
		buy = append(buy, SignalCheck{"yield_expansion", "배당수익률 확대", met, it.DividendYieldVsAvgPct, r.YieldExpansionPct, "%"})
	}
	if r.VolOversoldEnabled {
		met := it.VolatilityPct > 0 && it.MA200 > 0 && it.MA200Sigma <= -r.VolOversoldSigma
		buy = append(buy, SignalCheck{"vol_oversold", "변동성 대비 과매도", met, it.MA200Sigma, -r.VolOversoldSigma, "σ"})
	}

	if r.RsiBuyEnabled {
		buy = append(buy, SignalCheck{"rsi_rebound", "RSI 과매도 반등", oscReboundMet(it.RSI, it.RSIMin, r.RsiBuyLevel), it.RSI, r.RsiBuyLevel, ""})
	}
	if r.MfiBuyEnabled {
		buy = append(buy, SignalCheck{"mfi_rebound", "MFI 과매도 반등", oscReboundMet(it.MFI, it.MFIMin, r.MfiBuyLevel), it.MFI, r.MfiBuyLevel, ""})
	}
	if r.PerBuyEnabled {
		buy = append(buy, SignalCheck{"per_low", "PER 저평가", it.PER > 0 && it.PER <= r.PerBuyMax, it.PER, r.PerBuyMax, "배"})
	}
	if r.PbrBuyEnabled {
		buy = append(buy, SignalCheck{"pbr_low", "PBR 저평가", it.PBR > 0 && it.PBR <= r.PbrBuyMax, it.PBR, r.PbrBuyMax, "배"})
	}

	it.SellChecks = sell
	it.BuyChecks = buy
	it.SellDisabled = len(sell) == 0

	var sellHit bool
	if r.SellMode == "group" {
		sellHit = groupSellHit(sell, r.SellProfitMinCount, r.SellRiskMinCount)
	} else {
		sellHit = checksHit(sell, r.SellMode, r.SellMinCount)
	}
	// 소량 보유(기준 주 이하)는 매도 검토에서 제외한다. 부동소수 오차를 감안해 아주 작은 여유를 둔다.
	if r.MinSellQtyEnabled && r.MinSellQty > 0 && len(sell) > 0 && it.Quantity <= r.MinSellQty+1e-9 {
		it.SellExcludedSmallQty = true
		it.MinSellQty = r.MinSellQty
		sellHit = false
	}
	buyHit := checksHit(buy, r.BuyMode, r.BuyMinCount)
	it.BuyExcludedReason, it.BuyMaxWeightPct, it.BuyCooldownDays = "", 0, 0
	if buyHit {
		// 재매수 쿨다운 / 최대 비중: 매수 조건이 충족돼도 매수 검토에서 제외한다 (사유는 쿨다운 우선, 상세는 둘 다 채움)
		if r.BuyCooldownEnabled && r.BuyCooldownDays > 0 && it.hasLastBuy && it.DaysSinceLastBuy < r.BuyCooldownDays {
			it.BuyExcludedReason = "cooldown"
			it.BuyCooldownDays = r.BuyCooldownDays
		}
		if r.BuyMaxWeightEnabled && r.BuyMaxWeightPct > 0 && it.WeightPct >= r.BuyMaxWeightPct {
			if it.BuyExcludedReason == "" {
				it.BuyExcludedReason = "max_weight"
			}
			it.BuyMaxWeightPct = r.BuyMaxWeightPct
		}
		// 반등 확인: 시세 이력이 없으면(최근 저점 계산 불가) 막지 않는다. 사유 우선순위는 cooldown > max_weight > no_rebound.
		if r.ReboundConfirmEnabled && it.RecentLowPrice > 0 && !it.ReboundConfirmed && it.BuyExcludedReason == "" {
			it.BuyExcludedReason = "no_rebound"
		}
		if it.BuyExcludedReason != "" {
			buyHit = false
		}
	}
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

// checksHit 는 켜진 조건 중 충족된 개수로 판정한다.
//   - any: 1개 이상, all: 전부, count: minCount 개 이상 (켜진 조건 수보다 크면 전부로 본다)
func checksHit(checks []SignalCheck, mode string, minCount int) bool {
	if len(checks) == 0 {
		return false
	}
	need := 1
	switch mode {
	case "all":
		need = len(checks)
	case "count":
		need = minCount
		if need < 1 {
			need = 1
		}
		if need > len(checks) {
			need = len(checks)
		}
	}
	met := 0
	for _, c := range checks {
		if c.Met {
			met++
		}
	}
	return met >= need
}

// sanitizeSignalReport 는 NaN/±Inf 를 0 으로 바꾼다. encoding/json 은 이런 값을
// 직렬화하지 못해 Wails/HTTP 응답 전체가 실패하므로, 비정상 DB 값 하나가 화면을 막지 않게 한다.
func sanitizeSignalReport(r *SignalReport) {
	sanitizeFloats(reflect.ValueOf(r).Elem())
}

func sanitizeFloats(v reflect.Value) {
	switch v.Kind() {
	case reflect.Float32, reflect.Float64:
		if f := v.Float(); math.IsNaN(f) || math.IsInf(f, 0) {
			v.SetFloat(0)
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Field(i).CanSet() {
				sanitizeFloats(v.Field(i))
			}
		}
	case reflect.Slice:
		for i := 0; i < v.Len(); i++ {
			sanitizeFloats(v.Index(i))
		}
	case reflect.Ptr:
		if !v.IsNil() {
			sanitizeFloats(v.Elem())
		}
	}
}
