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
// 미국 주식은 계좌의 결제 통화(ForeignSettle)를 따른다: USD = 달러 예수금, KRW = 그날 환율로 원화 예수금.
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

	order int // 같은 날 정렬: 들어오는 것 → 나가는 것 → 조정
	seq   uint
}

// 같은 날에는 들어오는 돈을 먼저, 잔액 맞추기는 그날 마지막에 둔다
var cashKindOrder = map[string]int{
	models.CashDeposit: 0, models.CashExchange: 1, models.CashInterest: 2, "dividend": 3, "sell": 4,
	"buy": 5, models.CashWithdraw: 6, models.CashAdjust: 9,
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

	settleKRW := account.ForeignSettle == "KRW"
	var fxAt func(time.Time) float64
	needFx := false
	if settleKRW {
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
			return nil, errors.New("원화 결제 계좌의 미국 주식을 원화로 바꿀 환율을 가져오지 못했습니다")
		}
	}

	// 원화 결제 계좌면 달러 금액을 그날 환율로 원화로
	settle := func(ccy string, amount float64, d time.Time) (string, float64, float64) {
		if settleKRW && ccy == "USD" {
			fx := fxAt(d)
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
		detail := fmt.Sprintf("%s × %s", fmtQty(t.Quantity), fmtMoney(t.Price, assetCcy))
		if t.Fee > 0 {
			detail += " · 수수료 " + fmtMoney(t.Fee, assetCcy)
		}
		out = append(out, CashFlow{
			Date: dayString(t.Date), Kind: kind, Currency: ccy, Amount: amt, Fx: fx,
			Label: assetLabel(t.Asset), Detail: detail, TxID: &id, PlanFill: t.PlanID != nil,
			order: cashKindOrder[kind], seq: t.ID,
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
	bal := map[string]float64{}
	for i := range out {
		bal[out[i].Currency] += out[i].Amount
		out[i].Balance = math.Round(bal[out[i].Currency]*1e6) / 1e6
	}
	return out, nil
}

// ───────────────────────── 조회 ─────────────────────────

type CashBalance struct {
	AccountID uint    `json:"account_id"`
	KRW       float64 `json:"krw"`
	USD       float64 `json:"usd"`
	TotalKRW  float64 `json:"total_krw"` // 달러는 현재 환율로
	// 마지막 잔액 맞추기 날짜 (없으면 빈칸 — 계산 잔액이 실제와 다를 수 있음)
	LastAdjusted string `json:"last_adjusted,omitempty"`
}

type CashSummary struct {
	Account models.Account `json:"account"`
	CashBalance
	UsdKrw        float64    `json:"usd_krw"`
	StockValueKRW *float64   `json:"stock_value_krw,omitempty"` // 보유 주식 평가금 (시세 실패 시 없음)
	TotalKRW      *float64   `json:"account_total_krw,omitempty"`
	Flows         []CashFlow `json:"flows"` // 최근 것부터
}

func (s *CashService) currentFx() float64 {
	if look := s.fxLookup(); look != nil {
		return look(s.clock())
	}
	return 0
}

func balanceOf(accountID uint, flows []CashFlow, fx float64) CashBalance {
	b := CashBalance{AccountID: accountID}
	for _, f := range flows {
		switch f.Currency {
		case "KRW":
			b.KRW += f.Amount
		case "USD":
			b.USD += f.Amount
		}
		if f.Kind == models.CashAdjust && f.Date > b.LastAdjusted {
			b.LastAdjusted = f.Date
		}
	}
	b.KRW = math.Round(b.KRW*100) / 100
	b.USD = math.Round(b.USD*100) / 100
	b.TotalKRW = b.KRW + b.USD*fx
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
	sum := &CashSummary{Account: *acc, CashBalance: balanceOf(acc.ID, flows, fx), UsdKrw: fx}

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
	out := make([]CashBalance, 0, len(accounts))
	for i := range accounts {
		flows, err := s.flows(&accounts[i])
		if err != nil {
			return nil, 0, err
		}
		out = append(out, balanceOf(accounts[i].ID, flows, fx))
	}
	return out, fx, nil
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

// Reconcile: 증권사 잔액과 계산 잔액의 차이를 '잔액 맞추기' 기록으로 남긴다. 차이가 없으면 nil.
func (s *CashService) Reconcile(accountID uint, req CashReconcileRequest) (*models.CashEntry, error) {
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
		Notes: fmt.Sprintf("증권사 잔액 %s 에 맞춤", fmtMoney(req.Balance, req.Currency)),
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
