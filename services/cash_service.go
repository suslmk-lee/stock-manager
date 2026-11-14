package services

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

// 예수금 관리 — 현금 원장(입금·출금·환전·이자·조정)에 매매·배당을 더해 계좌의 원화·달러 잔액을 계산한다.
//
//   잔액 = 현금 기록 합 + 매도 수령액(수수료 뺌) − 매수 지불액(수수료 포함) + 수령한 배당(세후)
//
// 미국 주식은 계좌의 예수금 구성(ForeignSettle)을 따른다:
//   USD = 외화예수금(달러)에서 · KRW = 그날 환율로 원화예수금에서 · AFX = 달러 먼저, 모자란 만큼 원화에서 자동 환전.
// 자동으로 바꿀 때(KRW·AFX)는 계좌의 자동 환전 수수료(%)를 환율에 얹는다 (살 때 +, 받을 때 −).
// 지난 입금 기록이 없으면 계산 잔액이 실제와 다르므로 '잔액 맞추기'로 증권사 잔액을 넣어 차이를 조정 기록으로 남긴다.

// CashInputError 는 입력이 잘못된 경우 (HTTP 400).
type CashInputError struct{ msg string }

func (e *CashInputError) Error() string { return e.msg }

func cashInputErr(format string, a ...any) error { return &CashInputError{fmt.Sprintf(format, a...)} }

// ErrCashNotFound 는 계좌나 기록을 찾지 못한 경우 (HTTP 404).
var ErrCashNotFound = errors.New("계좌 또는 예수금 기록을 찾을 수 없습니다")

type CashService struct {
	db     *gorm.DB
	ticker *TickerService

	// 시험용 주입 (nil 이면 실제 조회)
	fxHistory func() (*PriceHistory, error)
	prices    func(tickers []string) map[string]float64
	now       func() time.Time
}

func NewCashService(db *gorm.DB, ticker *TickerService) *CashService {
	return &CashService{db: db, ticker: ticker}
}

func (s *CashService) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

// fxLookup: 날짜별 USD→KRW (실패하면 nil)
func (s *CashService) fxLookup() func(time.Time) float64 {
	var h *PriceHistory
	var err error
	switch {
	case s.fxHistory != nil:
		h, err = s.fxHistory()
	case s.ticker != nil:
		h, err = s.ticker.GetFxHistoryCached()
	default:
		return nil
	}
	if err != nil || h == nil || len(h.Points) == 0 {
		return nil
	}
	return NewFxLookup(h, 0)
}

func (s *CashService) currentPrices(tickers []string) map[string]float64 {
	if s.prices != nil {
		return s.prices(tickers)
	}
	out := map[string]float64{}
	if s.ticker == nil || len(tickers) == 0 {
		return out
	}
	for t, p := range s.ticker.GetCurrentPrices(tickers) {
		if p != nil && p.Price > 0 {
			out[strings.ToUpper(t)] = p.Price
		}
	}
	return out
}

// ───────────────────────── 흐름 계산 ─────────────────────────

// CashFlow 는 예수금이 움직인 한 건 (현금 기록 · 매매 · 배당)
type CashFlow struct {
	Date     string  `json:"date"`
	Kind     string  `json:"kind"` // deposit | withdraw | exchange | interest | adjust | buy | sell | dividend
	Currency string  `json:"currency"`
	Amount   float64 `json:"amount"`  // 부호 있음
	Balance  float64 `json:"balance"` // 이 건 뒤의 그 통화 잔액
	Label    string  `json:"label"`   // 종목 이름 등
	Detail   string  `json:"detail,omitempty"`
	Fx       float64 `json:"fx,omitempty"` // 원화 결제로 바꾼 환율
	EntryID  *uint   `json:"entry_id,omitempty"`
	TxID     *uint   `json:"transaction_id,omitempty"`
	PlanFill bool    `json:"plan_fill,omitempty"` // 주식 모으기 자동 기록
	Notes    string  `json:"notes,omitempty"`

	order  int // 같은 날 정렬: 들어오는 것 → 나가는 것 → 조정
	seq    uint
	ticker string // 매매 종목 (결제일 계산)
}

// 같은 날에는 들어오는 돈을 먼저, 잔액 맞추기는 그날 마지막에 둔다
var cashKindOrder = map[string]int{
	models.CashDeposit: 0, models.CashExchange: 1, models.CashInterest: 2, "dividend": 3, "sell": 4,
	"autofx": 5, "buy": 5, models.CashWithdraw: 6, models.CashAdjust: 9,
}

func fmtQty(q float64) string {
	s := fmt.Sprintf("%.6f", q)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	return s + "주"
}

func fmtMoney(v float64, ccy string) string {
	if ccy == "KRW" {
		return fmt.Sprintf("₩%s", commaInt(math.Round(v)))
	}
	return fmt.Sprintf("$%.2f", v)
}

func commaInt(v float64) string {
	neg := v < 0
	n := int64(math.Abs(v))
	str := fmt.Sprintf("%d", n)
	var b strings.Builder
	for i, c := range str {
		if i > 0 && (len(str)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

func assetLabel(a models.Asset) string {
	if a.Name != "" && IsFundTicker(a.Ticker) {
		return a.Name // 펀드는 티커(FUND:…)가 아니라 이름
	}
	if a.Name != "" && !isKRTicker(a.Ticker) {
		return a.Ticker
	}
	if a.Name != "" {
		return a.Name
	}
	return a.Ticker
}

// flows: 계좌의 모든 현금 흐름 (오래된 것부터, 통화별 누적 잔액 포함)
func (s *CashService) flows(account *models.Account) ([]CashFlow, error) {
	var entries []models.CashEntry
	if err := s.db.Where("account_id = ?", account.ID).Find(&entries).Error; err != nil {
		return nil, err
	}
	var txs []models.Transaction
	if err := s.db.Preload("Asset").Where("account_id = ?", account.ID).Find(&txs).Error; err != nil {
		return nil, err
	}
	var divs []models.Dividend
	if err := s.db.Preload("Asset").Where("account_id = ? AND is_received = ?", account.ID, true).Find(&divs).Error; err != nil {
		return nil, err
	}

	mode := account.ForeignSettle
	settleKRW := mode == models.SettleKRW
	fee := account.FxFeePct / 100
	var fxAt func(time.Time) float64
	needFx := false
	if settleKRW || mode == models.SettleAutoFX {
		for _, t := range txs {
			if tickerCurrency(t.Asset.Ticker) == "USD" {
				needFx = true
				break
			}
		}
		for _, d := range divs {
			if d.Currency == "USD" {
				needFx = true
				break
			}
		}
	}
	if needFx {
		fxAt = s.fxLookup()
		if fxAt == nil {
			return nil, errors.New("미국 주식을 원화로 바꿀 환율을 가져오지 못했습니다 (원화 결제·자동 환전 계좌)")
		}
	}

	// 원화로 바로(KRW) 계좌면 달러 금액을 그날 환율(+수수료)로 원화로 — 나가는 돈은 비싸게, 들어오는 돈은 싸게
	settle := func(ccy string, amount float64, d time.Time) (string, float64, float64) {
		if settleKRW && ccy == "USD" {
			fx := withFxFee(fxAt(d), fee, amount < 0)
			return "KRW", amount * fx, fx
		}
		return ccy, amount, 0
	}

	out := make([]CashFlow, 0, len(entries)+len(txs)+len(divs))
	for i := range entries {
		e := entries[i]
		id := e.ID
		label := map[string]string{
			models.CashDeposit: "입금", models.CashWithdraw: "출금", models.CashExchange: "환전",
			models.CashInterest: "이자", models.CashAdjust: "잔액 맞추기",
		}[e.Kind]
		out = append(out, CashFlow{
			Date: dayString(e.Date), Kind: e.Kind, Currency: e.Currency, Amount: e.Amount, Label: label,
			EntryID: &id, Notes: e.Notes, order: cashKindOrder[e.Kind], seq: e.ID,
		})
	}
	for i := range txs {
		t := txs[i]
		id := t.ID
		gross := t.Price * t.Quantity
		amount := gross + t.Fee
		kind := "buy"
		if t.Type == models.TransactionTypeSell {
			kind = "sell"
			amount = gross - t.Fee
		} else {
			amount = -amount
		}
		assetCcy := tickerCurrency(t.Asset.Ticker)
		ccy, amt, fx := settle(assetCcy, amount, t.Date)
		qty := fmtQty(t.Quantity)
		if IsFundTicker(t.Asset.Ticker) {
			qty = strings.TrimSuffix(fmtQty(math.Round(t.Quantity*100)/100), "주") + "좌"
		}
		detail := fmt.Sprintf("%s × %s", qty, fmtMoney(t.Price, assetCcy))
		if t.Fee > 0 {
			detail += " · 수수료 " + fmtMoney(t.Fee, assetCcy)
		}
		out = append(out, CashFlow{
			Date: dayString(t.Date), Kind: kind, Currency: ccy, Amount: amt, Fx: fx,
			Label: assetLabel(t.Asset), Detail: detail, TxID: &id, PlanFill: t.PlanID != nil,
			order: cashKindOrder[kind], seq: t.ID, ticker: t.Asset.Ticker,
		})
	}
	for i := range divs {
		d := divs[i]
		net := d.Amount - d.Tax
		ccy := d.Currency
		if ccy == "" {
			ccy = tickerCurrency(d.Asset.Ticker)
		}
		c, amt, fx := settle(ccy, net, d.Date)
		out = append(out, CashFlow{
			Date: dayString(d.Date), Kind: "dividend", Currency: c, Amount: amt, Fx: fx,
			Label: assetLabel(d.Asset), Detail: "배당 (세후)", order: cashKindOrder["dividend"], seq: d.ID,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date < out[j].Date
		}
		if out[i].order != out[j].order {
			return out[i].order < out[j].order
		}
		return out[i].seq < out[j].seq
	})
	if mode == models.SettleAutoFX && fxAt != nil {
		out = autoExchange(out, fxAt, fee)
	}
	bal := map[string]float64{}
	for i := range out {
		bal[out[i].Currency] += out[i].Amount
		out[i].Balance = math.Round(bal[out[i].Currency]*1e6) / 1e6
	}
	return out, nil
}

// withFxFee: 자동 환전 수수료를 얹은 환율 (원화가 나갈 때는 비싸게, 들어올 때는 싸게)
func withFxFee(fx, fee float64, paying bool) float64 {
	if paying {
		return fx * (1 + fee)
	}
	return fx * (1 - fee)
}

// autoExchange: 자동 환전(통합증거금) — 달러 매수에 외화예수금이 모자라면 모자란 만큼(센트 올림)을
// 그날 환율(+수수료)로 원화예수금에서 바꾼다. 바꾼 기록은 그 매수 바로 앞에 '자동 환전' 두 줄(원화 −, 달러 +)로 넣는다.
// 증권사가 주문 때 임시 환율로 더 잡아 두었다가 다음 날 정산해 돌려주는 차액은 넣지 않는다 (최종 금액만 남긴다).
func autoExchange(in []CashFlow, fxAt func(time.Time) float64, fee float64) []CashFlow {
	out := make([]CashFlow, 0, len(in)+4)
	usd := 0.0
	for _, f := range in {
		if f.Currency == "USD" && f.Kind == "buy" && f.Amount < 0 {
			short := math.Ceil((-f.Amount-math.Max(usd, 0))*100-1e-6) / 100
			if d, ok := parseDay(f.Date); ok && short > 0 {
				fx := withFxFee(fxAt(d), fee, true)
				krw := math.Round(short * fx)
				detail := fmt.Sprintf("%s 매수에 모자란 %s", f.Label, fmtMoney(short, "USD"))
				out = append(out,
					CashFlow{Date: f.Date, Kind: "autofx", Currency: "KRW", Amount: -krw, Label: "원화 → 달러", Detail: detail, Fx: fx, order: f.order, seq: f.seq},
					CashFlow{Date: f.Date, Kind: "autofx", Currency: "USD", Amount: short, Label: "원화 → 달러", Detail: detail, Fx: fx, order: f.order, seq: f.seq},
				)
				usd += short
			}
		}
		if f.Currency == "USD" {
			usd += f.Amount
		}
		out = append(out, f)
	}
	return out
}

// ───────────────────────── 조회 ─────────────────────────

type CashBalance struct {
	AccountID uint    `json:"account_id"`
	KRW       float64 `json:"krw"`
	USD       float64 `json:"usd"`
	TotalKRW  float64 `json:"total_krw"` // 달러는 현재 환율로
	// 마지막 잔액 맞추기 날짜 (없으면 빈칸 — 계산 잔액이 실제와 다를 수 있음)
	LastAdjusted string `json:"last_adjusted,omitempty"`
	// 출금 가능 금액: 예수금에서 아직 결제되지 않은 매도 대금을 뺀 것 (0 아래로는 내려가지 않음)
	WithdrawableKRW float64 `json:"withdrawable_krw"`
	WithdrawableUSD float64 `json:"withdrawable_usd"`
	FlowCount       int     `json:"flow_count"` // 현금 흐름 건수 (0 이면 기록 없음)
}

type CashSummary struct {
	Account models.Account `json:"account"`
	CashBalance
	UsdKrw        float64         `json:"usd_krw"`
	StockValueKRW *float64        `json:"stock_value_krw,omitempty"` // 보유 주식 평가금 (시세 실패 시 없음)
	TotalKRW      *float64        `json:"account_total_krw,omitempty"`
	Pending       []PendingSettle `json:"pending,omitempty"` // 결제 전 매도 대금 (결제일 순)
	Flows         []CashFlow      `json:"flows"`             // 최근 것부터
}

// PendingSettle 은 아직 결제되지 않은 매도 대금 한 건
type PendingSettle struct {
	Date       string  `json:"date"`        // 매도일
	SettleDate string  `json:"settle_date"` // 결제 예정일 (이 날부터 출금 가능)
	Currency   string  `json:"currency"`
	Amount     float64 `json:"amount"`
	Label      string  `json:"label"`
	TxID       *uint   `json:"transaction_id,omitempty"`
}

// settleDay: 매도 대금 결제 예정일 — 국내 주식 2영업일, 미국 주식 1영업일 뒤 (주말만 건너뛴다. 휴장일은 모른다)
func settleDay(tradeDay, ticker string) string {
	d, ok := parseDay(tradeDay)
	if !ok {
		return tradeDay
	}
	n := 1
	if isKRTicker(ticker) {
		n = 2
	}
	for n > 0 {
		d = d.AddDate(0, 0, 1)
		if wd := d.Weekday(); wd != time.Saturday && wd != time.Sunday {
			n--
		}
	}
	return dayString(d)
}

// pendingSells: 오늘(KST) 아직 결제되지 않은 매도 대금
func pendingSells(flows []CashFlow, today string) []PendingSettle {
	var out []PendingSettle
	for _, f := range flows {
		if f.Kind != "sell" || f.Amount <= 0 {
			continue
		}
		if sd := settleDay(f.Date, f.ticker); sd > today {
			out = append(out, PendingSettle{Date: f.Date, SettleDate: sd, Currency: f.Currency, Amount: f.Amount, Label: f.Label, TxID: f.TxID})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SettleDate < out[j].SettleDate })
	return out
}

// withdrawable: 잔액 − 결제 전 매도 대금 (0 아래면 0)
func withdrawable(balance float64, pending []PendingSettle, ccy string) float64 {
	v := balance
	for _, p := range pending {
		if p.Currency == ccy {
			v -= p.Amount
		}
	}
	return math.Max(0, math.Round(v*100)/100)
}

func (s *CashService) currentFx() float64 {
	if look := s.fxLookup(); look != nil {
		return look(s.clock())
	}
	return 0
}

// balanceOf: 잔액·마지막 맞춤일·출금 가능 금액 (today 는 KST 날짜 — 결제 전 매도 대금을 가린다)
func balanceOf(accountID uint, flows []CashFlow, fx float64, today string) CashBalance {
	b := CashBalance{AccountID: accountID, FlowCount: len(flows)}
	for _, f := range flows {
		switch f.Currency {
		case "KRW":
			b.KRW += f.Amount
		case "USD":
			b.USD += f.Amount
		}
		if (f.Kind == models.CashAdjust || (f.Kind == models.CashInterest && strings.Contains(f.Notes, cashSyncMark))) && f.Date > b.LastAdjusted {
			b.LastAdjusted = f.Date
		}
	}
	b.KRW = math.Round(b.KRW*100) / 100
	b.USD = math.Round(b.USD*100) / 100
	b.TotalKRW = b.KRW + b.USD*fx
	pending := pendingSells(flows, today)
	b.WithdrawableKRW = withdrawable(b.KRW, pending, "KRW")
	b.WithdrawableUSD = withdrawable(b.USD, pending, "USD")
	return b
}

func (s *CashService) account(id uint) (*models.Account, error) {
	var a models.Account
	if err := s.db.First(&a, id).Error; err != nil {
		return nil, ErrCashNotFound
	}
	return &a, nil
}

// GetSummary: 계좌의 예수금 잔액, 주식 평가금, 계좌 총액, 현금 흐름
func (s *CashService) GetSummary(accountID uint) (*CashSummary, error) {
	acc, err := s.account(accountID)
	if err != nil {
		return nil, err
	}
	flows, err := s.flows(acc)
	if err != nil {
		return nil, err
	}
	fx := s.currentFx()
	today := todayKST(s.clock())
	sum := &CashSummary{Account: *acc, CashBalance: balanceOf(acc.ID, flows, fx, today), UsdKrw: fx}
	sum.Pending = pendingSells(flows, today)

	// 보유 주식 평가금 (종목 통화 → 원화)
	var hs []models.Holding
	if err := s.db.Preload("Asset").Where("account_id = ? AND quantity > 0", acc.ID).Find(&hs).Error; err == nil {
		tickers := make([]string, 0, len(hs))
		for _, h := range hs {
			tickers = append(tickers, h.Asset.Ticker)
		}
		prices := s.currentPrices(tickers)
		val, ok := 0.0, true
		for _, h := range hs {
			p, found := prices[strings.ToUpper(h.Asset.Ticker)]
			if !found {
				ok = false
				break
			}
			v := p * h.Quantity
			if tickerCurrency(h.Asset.Ticker) == "USD" {
				if fx <= 0 {
					ok = false
					break
				}
				v *= fx
			}
			val += v
		}
		if ok {
			sum.StockValueKRW = ptr(math.Round(val))
			sum.TotalKRW = ptr(math.Round(val + sum.CashBalance.TotalKRW))
		}
	}

	// 최근 것부터
	for i, j := 0, len(flows)-1; i < j; i, j = i+1, j-1 {
		flows[i], flows[j] = flows[j], flows[i]
	}
	sum.Flows = flows
	return sum, nil
}

// GetBalances: 모든 계좌의 예수금 (자산 합계에 더할 때)
func (s *CashService) GetBalances() ([]CashBalance, float64, error) {
	var accounts []models.Account
	if err := s.db.Find(&accounts).Error; err != nil {
		return nil, 0, err
	}
	fx := s.currentFx()
	today := todayKST(s.clock())
	out := make([]CashBalance, 0, len(accounts))
	for i := range accounts {
		flows, err := s.flows(&accounts[i])
		if err != nil {
			return nil, 0, err
		}
		out = append(out, balanceOf(accounts[i].ID, flows, fx, today))
	}
	return out, fx, nil
}

// ───────────────────────── 날짜별 잔액 (자산 추이 그래프) ─────────────────────────

// CashTimeline 은 한 계좌의 날짜별 예수금 (그날 마감 잔액)
type CashTimeline struct {
	AccountID  uint
	Restricted bool   // 인출 제한 계좌 (연금 등)
	Start      string // 이 날부터 그래프에 넣는다
	days       []string
	krw, usd   []float64
}

// At: day(YYYY-MM-DD) 마감 잔액. 시작일 전이면 ok=false.
func (t *CashTimeline) At(day string) (krw, usd float64, ok bool) {
	if day < t.Start {
		return 0, 0, false
	}
	i := sort.SearchStrings(t.days, day) // day 이상인 첫 자리
	if i < len(t.days) && t.days[i] == day {
		return t.krw[i], t.usd[i], true
	}
	if i == 0 {
		return 0, 0, true
	}
	return t.krw[i-1], t.usd[i-1], true
}

// buildTimeline: 흐름(오래된 것부터)에서 날짜별 마감 잔액을 만든다.
// 시작일은 첫 '잔액 맞추기' 날 — 그 전은 지난 입금 기록이 빠져 계산이 틀릴 수 있다.
// 잔액 맞추기가 없으면 첫 현금 기록 날, 현금 기록이 하나도 없으면 매매로만 계산한 값이라 넣지 않는다 (nil).
func buildTimeline(acc models.Account, flows []CashFlow) *CashTimeline {
	start, firstEntry := "", ""
	for _, f := range flows {
		if f.EntryID == nil {
			continue
		}
		if firstEntry == "" {
			firstEntry = f.Date
		}
		if f.Kind == models.CashAdjust {
			start = f.Date
			break
		}
	}
	if start == "" {
		start = firstEntry
	}
	if start == "" {
		return nil
	}
	t := &CashTimeline{AccountID: acc.ID, Restricted: acc.AccountType.IsWithdrawalRestricted(), Start: start}
	krw, usd := 0.0, 0.0
	for _, f := range flows {
		switch f.Currency {
		case "KRW":
			krw += f.Amount
		case "USD":
			usd += f.Amount
		}
		if n := len(t.days); n > 0 && t.days[n-1] == f.Date {
			t.krw[n-1], t.usd[n-1] = krw, usd
			continue
		}
		t.days = append(t.days, f.Date)
		t.krw = append(t.krw, krw)
		t.usd = append(t.usd, usd)
	}
	return t
}

// Timelines: 자산 추이 그래프에 더할 계좌별 날짜별 예수금. 계산하지 못한 계좌(환율 실패 등)는 건너뛴다.
func (s *CashService) Timelines() []CashTimeline {
	var accounts []models.Account
	if err := s.db.Find(&accounts).Error; err != nil {
		return nil
	}
	var out []CashTimeline
	for i := range accounts {
		flows, err := s.flows(&accounts[i])
		if err != nil {
			continue
		}
		if t := buildTimeline(accounts[i], flows); t != nil {
			out = append(out, *t)
		}
	}
	return out
}

// ───────────────────────── 기록 ─────────────────────────

type CashEntryRequest struct {
	Currency string  `json:"currency"`
	Date     string  `json:"date"`
	Kind     string  `json:"kind"`   // deposit | withdraw | interest
	Amount   float64 `json:"amount"` // 양수로 입력 (출금도 양수, 부호는 종류로 정한다)
	Notes    string  `json:"notes"`
}

func parseCashDate(s string, now time.Time) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		s = todayKST(now)
	}
	d, ok := parseDay(s)
	if !ok {
		return time.Time{}, cashInputErr("날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)")
	}
	return d, nil
}

func validCurrency(c string) bool { return c == "KRW" || c == "USD" }

// CreateEntry: 입금·출금·이자
func (s *CashService) CreateEntry(accountID uint, req CashEntryRequest) (*models.CashEntry, error) {
	if _, err := s.account(accountID); err != nil {
		return nil, err
	}
	req.Currency = strings.ToUpper(strings.TrimSpace(req.Currency))
	if !validCurrency(req.Currency) {
		return nil, cashInputErr("통화는 KRW 또는 USD 여야 합니다")
	}
	if req.Amount <= 0 || !finite(req.Amount) {
		return nil, cashInputErr("금액은 0보다 커야 합니다")
	}
	amount := req.Amount
	switch req.Kind {
	case models.CashDeposit, models.CashInterest:
	case models.CashWithdraw:
		amount = -amount
	default:
		return nil, cashInputErr("종류는 입금·출금·이자 중 하나여야 합니다")
	}
	d, err := parseCashDate(req.Date, s.clock())
	if err != nil {
		return nil, err
	}
	e := models.CashEntry{AccountID: accountID, Currency: req.Currency, Date: d, Kind: req.Kind, Amount: amount, Notes: strings.TrimSpace(req.Notes)}
	if err := s.db.Create(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

type CashExchangeRequest struct {
	Date         string  `json:"date"`
	FromCurrency string  `json:"from_currency"`
	FromAmount   float64 `json:"from_amount"` // 내준 금액 (양수)
	ToAmount     float64 `json:"to_amount"`   // 받은 금액 (양수)
	Notes        string  `json:"notes"`
}

// CreateExchange: 환전 — 내준 통화 −, 받은 통화 + 두 줄을 한 쌍으로
func (s *CashService) CreateExchange(accountID uint, req CashExchangeRequest) ([]models.CashEntry, error) {
	if _, err := s.account(accountID); err != nil {
		return nil, err
	}
	from := strings.ToUpper(strings.TrimSpace(req.FromCurrency))
	if !validCurrency(from) {
		return nil, cashInputErr("환전할 통화는 KRW 또는 USD 여야 합니다")
	}
	to := "USD"
	if from == "USD" {
		to = "KRW"
	}
	if req.FromAmount <= 0 || req.ToAmount <= 0 || !finite(req.FromAmount) || !finite(req.ToAmount) {
		return nil, cashInputErr("환전 금액은 0보다 커야 합니다")
	}
	d, err := parseCashDate(req.Date, s.clock())
	if err != nil {
		return nil, err
	}
	rate := req.FromAmount / req.ToAmount
	if from == "USD" {
		rate = req.ToAmount / req.FromAmount
	}
	note := strings.TrimSpace(req.Notes)
	auto := fmt.Sprintf("환율 %.2f", rate)
	if note == "" {
		note = auto
	} else {
		note = auto + " · " + note
	}
	out := []models.CashEntry{
		{AccountID: accountID, Currency: from, Date: d, Kind: models.CashExchange, Amount: -req.FromAmount, Notes: note},
		{AccountID: accountID, Currency: to, Date: d, Kind: models.CashExchange, Amount: req.ToAmount, Notes: note},
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&out[0]).Error; err != nil {
			return err
		}
		if err := tx.Create(&out[1]).Error; err != nil {
			return err
		}
		if err := tx.Model(&out[0]).Update("pair_id", out[1].ID).Error; err != nil {
			return err
		}
		return tx.Model(&out[1]).Update("pair_id", out[0].ID).Error
	})
	if err != nil {
		return nil, err
	}
	out[0].PairID, out[1].PairID = &out[1].ID, &out[0].ID
	return out, nil
}

type CashReconcileRequest struct {
	Currency string  `json:"currency"`
	Balance  float64 `json:"balance"` // 증권사 앱에 보이는 예수금
	Date     string  `json:"date"`    // 이 날 장 마감 기준 (기본 오늘)
}

// cashSyncMark: 잔액을 맞춘 기록의 메모 끝말 (맞춰서 남긴 이자도 '잔액을 맞춘 날'로 본다)
const cashSyncMark = "에 맞춤"

// Reconcile: 증권사 잔액과 계산 잔액의 차이를 '잔액 맞추기' 기록으로 남긴다. 차이가 없으면 nil.
func (s *CashService) Reconcile(accountID uint, req CashReconcileRequest) (*models.CashEntry, error) {
	return s.reconcile(accountID, req, "")
}

// ReconcileInterest: 잔액 맞추기와 같되 늘어난 차이는 '이자'로 남긴다 (퇴직연금 현금성자산처럼 설명 안 되는 차이가 이자뿐일 때).
// label: 메모 앞말 (예: 현금성자산)
func (s *CashService) ReconcileInterest(accountID uint, req CashReconcileRequest, label string) (*models.CashEntry, error) {
	return s.reconcile(accountID, req, label)
}

// BalanceKRW: 한 계좌의 지금 원화 예수금 (계산 잔액)
func (s *CashService) BalanceKRW(accountID uint) (float64, error) {
	acc, err := s.account(accountID)
	if err != nil {
		return 0, err
	}
	flows, err := s.flows(acc)
	if err != nil {
		return 0, err
	}
	return balanceOf(acc.ID, flows, 0, todayKST(s.clock())).KRW, nil
}

func (s *CashService) reconcile(accountID uint, req CashReconcileRequest, interestLabel string) (*models.CashEntry, error) {
	acc, err := s.account(accountID)
	if err != nil {
		return nil, err
	}
	req.Currency = strings.ToUpper(strings.TrimSpace(req.Currency))
	if !validCurrency(req.Currency) {
		return nil, cashInputErr("통화는 KRW 또는 USD 여야 합니다")
	}
	if !finite(req.Balance) {
		return nil, cashInputErr("잔액이 올바르지 않습니다")
	}
	d, err := parseCashDate(req.Date, s.clock())
	if err != nil {
		return nil, err
	}
	flows, err := s.flows(acc)
	if err != nil {
		return nil, err
	}
	day := dayString(d)
	computed := 0.0
	for _, f := range flows {
		if f.Currency == req.Currency && f.Date <= day {
			computed += f.Amount
		}
	}
	diff := math.Round((req.Balance-computed)*100) / 100
	if math.Abs(diff) < 0.005 {
		return nil, nil
	}
	e := models.CashEntry{
		AccountID: accountID, Currency: req.Currency, Date: d, Kind: models.CashAdjust, Amount: diff,
		Notes: fmt.Sprintf("증권사 잔액 %s %s", fmtMoney(req.Balance, req.Currency), cashSyncMark),
	}
	if interestLabel != "" {
		if diff > 0 {
			e.Kind = models.CashInterest
			e.Notes = fmt.Sprintf("%s 이자 (은행 앱 %s %s)", interestLabel, fmtMoney(req.Balance, req.Currency), cashSyncMark)
		} else {
			e.Notes = fmt.Sprintf("%s 은행 앱 %s %s", interestLabel, fmtMoney(req.Balance, req.Currency), cashSyncMark)
		}
	}
	if err := s.db.Create(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// DeleteEntry: 현금 기록 지우기 (환전은 짝도 함께)
func (s *CashService) DeleteEntry(id uint) error {
	var e models.CashEntry
	if err := s.db.First(&e, id).Error; err != nil {
		return ErrCashNotFound
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if e.PairID != nil {
			if err := tx.Delete(&models.CashEntry{}, *e.PairID).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&models.CashEntry{}, e.ID).Error
	})
}
