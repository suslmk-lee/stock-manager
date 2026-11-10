package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

// 주식 모으기 (정기 소액 매수) — 계획 관리와 자동 기록.
//
// 앱은 주문을 넣지 않는다. 장이 끝난 거래일마다 "계획대로라면 샀을 회차"를 그날 종가로 계산해
// 매매 기록(PlanID 가 붙은 매수)으로 남긴다. 수량은 계획의 수량 단위(QtyStep)로 내림한다
// (카카오페이처럼 0.001주 단위로 1,000원을 넘지 않게 사는 곳은 금액이 917원·784원처럼 달라진다).
//
// 데스크톱 앱과 클라우드 서버가 같은 DB 를 쓰므로 어디서 몇 번 돌아도 같은 계획·같은 날은
// 한 건만 남는다 (transactions 의 idx_tx_plan_day 고유 인덱스).

const accumulationNote = "주식 모으기 자동 기록"

// 장 마감 뒤 이만큼 지나야 그날 종가를 확정으로 본다 (UTC 자정 기준 오프셋).
// 미국: 16:00 ET = 20:00/21:00 UTC → 22:00 UTC (서머타임과 무관하게 넉넉히)
// 한국: 15:30 KST = 06:30 UTC → 07:30 UTC
const (
	usCloseOffset = 22 * time.Hour
	krCloseOffset = 7*time.Hour + 30*time.Minute
)

// PlanInputError 는 입력값이 잘못된 경우 (HTTP 400).
type PlanInputError struct{ msg string }

func (e *PlanInputError) Error() string { return e.msg }

func planInputErr(format string, a ...any) error { return &PlanInputError{fmt.Sprintf(format, a...)} }

// ErrPlanNotFound 는 계획이나 회차를 찾지 못한 경우 (HTTP 404).
var ErrPlanNotFound = errors.New("주식 모으기 계획을 찾을 수 없습니다")

type AccumulationService struct {
	db     *gorm.DB
	txs    *TransactionService
	ticker *TickerService

	// 시험용 주입 (nil 이면 실제 조회)
	fetchHistory func(ticker, rangeStr string) (*PriceHistory, error) // 캐시 없이 일봉
	fxHistory    func() (*PriceHistory, error)
	histories    func(tickers []string) map[string]*PriceHistory // 화면 표시용 현재가 (캐시)
	now          func() time.Time

	runMu sync.Mutex
}

func NewAccumulationService(db *gorm.DB, ticker *TickerService) *AccumulationService {
	return &AccumulationService{db: db, txs: NewTransactionServiceWithDB(db), ticker: ticker}
}

func (s *AccumulationService) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *AccumulationService) getHistory(ticker, rangeStr string) (*PriceHistory, error) {
	if s.fetchHistory != nil {
		return s.fetchHistory(ticker, rangeStr)
	}
	if s.ticker == nil {
		return nil, errors.New("시세 서비스가 없습니다")
	}
	return s.ticker.GetPriceHistory(ticker, rangeStr, "1d")
}

func (s *AccumulationService) getFxLookup() (func(time.Time) float64, error) {
	var h *PriceHistory
	var err error
	switch {
	case s.fxHistory != nil:
		h, err = s.fxHistory()
	case s.ticker != nil:
		h, err = s.ticker.GetFxHistoryCached()
	default:
		err = errors.New("환율 서비스가 없습니다")
	}
	if err != nil {
		return nil, err
	}
	if h == nil || len(h.Points) == 0 {
		return nil, errors.New("환율 이력이 비어 있습니다")
	}
	return NewFxLookup(h, 0), nil
}

func (s *AccumulationService) cachedHistories(tickers []string) map[string]*PriceHistory {
	if s.histories != nil {
		return s.histories(tickers)
	}
	if s.ticker == nil {
		return map[string]*PriceHistory{}
	}
	return s.ticker.GetDailyHistoriesCached(tickers)
}

// ───────────────────────── 날짜 도우미 ─────────────────────────

func isKRTicker(ticker string) bool {
	u := strings.ToUpper(ticker)
	return strings.HasSuffix(u, ".KS") || strings.HasSuffix(u, ".KQ")
}

func tickerCurrency(ticker string) string { return currencyFor(ticker, "") }

func parseDay(s string) (time.Time, bool) {
	t, err := time.Parse(dateLayout, s)
	return t, err == nil
}

func dayString(t time.Time) string { return t.UTC().Format(dateLayout) }

func todayKST(now time.Time) string { return now.In(kst).Format(dateLayout) }

// sessionClosed: 거래일 day(YYYY-MM-DD)의 종가가 확정됐는지
func sessionClosed(ticker, day string, now time.Time) bool {
	d, ok := parseDay(day)
	if !ok {
		return false
	}
	off := usCloseOffset
	if isKRTicker(ticker) {
		off = krCloseOffset
	}
	return !now.Before(d.Add(off))
}

func daysInMonth(t time.Time) int {
	return time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// scheduledOn: 달력상 그날이 계획한 날인지 (휴장 여부는 따지지 않음)
func scheduledOn(p *models.AccumulationPlan, d time.Time) bool {
	switch p.Schedule {
	case models.PlanScheduleDaily:
		wd := d.Weekday()
		return wd != time.Saturday && wd != time.Sunday
	case models.PlanScheduleWeekly:
		return p.Weekdays&(1<<uint(d.Weekday())) != 0
	case models.PlanScheduleMonthly:
		target := p.MonthDay
		if dim := daysInMonth(d); target > dim {
			target = dim
		}
		return d.Day() == target
	}
	return false
}

// scheduleHit: 거래일 day 에 사는지. 매일 모으기는 거래일마다, 매주·매월은 계획한 날이 거래일일 때만 산다.
// 계획한 날이 휴장이면 그 회차는 건너뛴다 (카카오페이와 같음 — 다음 거래일로 미루지 않는다).
func scheduleHit(p *models.AccumulationPlan, day string) bool {
	if p.Schedule == models.PlanScheduleDaily {
		return true
	}
	d, ok := parseDay(day)
	return ok && scheduledOn(p, d)
}

// floorQty: 금액(종목 통화)으로 단위(step)에 맞춰 살 수 있는 최대 수량
func floorQty(amount, price, step float64) float64 {
	if amount <= 0 || price <= 0 || step <= 0 {
		return 0
	}
	n := math.Floor(amount/price/step + 1e-9)
	return math.Round(n*step*1e9) / 1e9
}

// convertAmount: from 통화 금액을 to 통화로 (fx = 1달러당 원)
func convertAmount(v float64, from, to string, fx float64) (float64, bool) {
	if from == to {
		return v, true
	}
	if fx <= 0 {
		return 0, false
	}
	switch {
	case from == "KRW" && to == "USD":
		return v / fx, true
	case from == "USD" && to == "KRW":
		return v * fx, true
	}
	return 0, false
}

type sessionBar struct {
	day   string
	close float64
}

// sessionBars: 일봉을 거래소 현지 날짜별 종가로 (오름차순, 같은 날은 마지막 봉)
func sessionBars(h *PriceHistory) []sessionBar {
	if h == nil {
		return nil
	}
	dp := buildDailyPrices(h.Symbol, h)
	out := make([]sessionBar, 0, len(dp.days))
	for i, d := range dp.days {
		out = append(out, sessionBar{time.Unix(d*86400, 0).UTC().Format(dateLayout), dp.closes[i]})
	}
	return out
}

func isUniqueViolation(err error) bool {
	m := strings.ToLower(err.Error())
	return strings.Contains(m, "unique") || strings.Contains(m, "duplicate")
}

// firstPending: 아직 처리하지 않은 첫 거래일 후보
func firstPending(p *models.AccumulationPlan) string {
	from := p.AutoFrom
	if pt, ok := parseDay(p.ProcessedThrough); ok {
		if next := dayString(pt.AddDate(0, 0, 1)); next > from {
			from = next
		}
	}
	return from
}

// ───────────────────────── 계획 CRUD ─────────────────────────

type AccumulationPlanRequest struct {
	AccountID       uint    `json:"account_id"`
	AssetID         uint    `json:"asset_id"`
	Amount          float64 `json:"amount"`
	AmountCurrency  string  `json:"amount_currency"`
	QtyStep         float64 `json:"qty_step"`
	Schedule        string  `json:"schedule"`
	Weekdays        int     `json:"weekdays"`
	MonthDay        int     `json:"month_day"`
	Condition       string  `json:"condition"`
	ConditionValue  float64 `json:"condition_value"`
	Status          string  `json:"status"`
	StartedOn       string  `json:"started_on"`
	AutoFrom        string  `json:"auto_from"`
	OpeningRounds   int     `json:"opening_rounds"`
	OpeningAmount   float64 `json:"opening_amount"`
	OpeningQuantity float64 `json:"opening_quantity"`
	// 등록할 때만: 지금까지 모은 수량을 보유에 더한다 (매매 기록에 아직 없을 때)
	AddOpeningToHoldings bool   `json:"add_opening_to_holdings"`
	Notes                string `json:"notes"`
}

func (s *AccumulationService) validate(req *AccumulationPlanRequest, now time.Time) error {
	req.AmountCurrency = strings.ToUpper(strings.TrimSpace(req.AmountCurrency))
	if req.Amount <= 0 || !finite(req.Amount) {
		return planInputErr("한 번에 살 금액을 입력하세요")
	}
	if req.AmountCurrency != "KRW" && req.AmountCurrency != "USD" {
		return planInputErr("금액 통화는 KRW 또는 USD 여야 합니다")
	}
	if req.QtyStep == 0 {
		req.QtyStep = 0.000001
	}
	if req.QtyStep < 0 || req.QtyStep > 1 || !finite(req.QtyStep) {
		return planInputErr("수량 단위는 0보다 크고 1주 이하여야 합니다")
	}
	switch req.Schedule {
	case models.PlanScheduleDaily:
		req.Weekdays, req.MonthDay = 0, 0
	case models.PlanScheduleWeekly:
		req.Weekdays &= 0x7f
		if req.Weekdays == 0 {
			return planInputErr("매주 살 요일을 고르세요")
		}
		req.MonthDay = 0
	case models.PlanScheduleMonthly:
		if req.MonthDay < 1 || req.MonthDay > 31 {
			return planInputErr("매월 살 날짜는 1~31일이어야 합니다")
		}
		req.Weekdays = 0
	default:
		return planInputErr("주기는 매일·매주·매월 중 하나여야 합니다")
	}
	switch req.Condition {
	case "", models.PlanConditionAlways:
		req.Condition, req.ConditionValue = models.PlanConditionAlways, 0
	case models.PlanConditionReturnBelow:
		if !finite(req.ConditionValue) || req.ConditionValue < -100 || req.ConditionValue > 1000 {
			return planInputErr("수익률 기준이 올바르지 않습니다")
		}
	case models.PlanConditionPriceBelow:
		if req.ConditionValue <= 0 || !finite(req.ConditionValue) {
			return planInputErr("주가 기준을 입력하세요")
		}
	default:
		return planInputErr("알 수 없는 조건입니다")
	}
	switch req.Status {
	case "":
		req.Status = models.PlanStatusActive
	case models.PlanStatusActive, models.PlanStatusPaused:
	default:
		return planInputErr("알 수 없는 상태입니다")
	}
	req.StartedOn = strings.TrimSpace(req.StartedOn)
	if req.StartedOn != "" {
		if _, ok := parseDay(req.StartedOn); !ok {
			return planInputErr("시작일 형식이 올바르지 않습니다 (YYYY-MM-DD)")
		}
	}
	req.AutoFrom = strings.TrimSpace(req.AutoFrom)
	if req.AutoFrom == "" {
		req.AutoFrom = todayKST(now)
	} else if _, ok := parseDay(req.AutoFrom); !ok {
		return planInputErr("자동 기록 시작일 형식이 올바르지 않습니다 (YYYY-MM-DD)")
	}
	if req.OpeningRounds < 0 || req.OpeningAmount < 0 || req.OpeningQuantity < 0 ||
		!finite(req.OpeningAmount) || !finite(req.OpeningQuantity) {
		return planInputErr("지금까지 모은 값은 0 이상이어야 합니다")
	}
	if len(req.Notes) > 500 {
		return planInputErr("메모는 500자 이하로 입력하세요")
	}
	return nil
}

// openingPrice: 지금까지 모은 금액·수량으로 종목 통화 평균 단가를 구한다 (환율은 오늘 기준)
func (s *AccumulationService) openingPrice(amount, qty float64, amountCcy, assetCcy string, now time.Time) (float64, error) {
	if qty <= 0 || amount <= 0 {
		return 0, planInputErr("보유에 더하려면 지금까지 모은 금액과 수량을 모두 입력하세요")
	}
	fx := 0.0
	if amountCcy != assetCcy {
		look, err := s.getFxLookup()
		if err != nil {
			return 0, fmt.Errorf("환율을 가져오지 못했습니다: %w", err)
		}
		fx = look(now)
	}
	v, ok := convertAmount(amount, amountCcy, assetCcy, fx)
	if !ok {
		return 0, errors.New("환율을 가져오지 못했습니다")
	}
	return v / qty, nil
}

func (s *AccumulationService) CreatePlan(req AccumulationPlanRequest) (*models.AccumulationPlan, error) {
	now := s.clock()
	if err := s.validate(&req, now); err != nil {
		return nil, err
	}
	var account models.Account
	if err := s.db.First(&account, req.AccountID).Error; err != nil {
		return nil, planInputErr("계좌를 찾을 수 없습니다")
	}
	var asset models.Asset
	if err := s.db.First(&asset, req.AssetID).Error; err != nil {
		return nil, planInputErr("종목을 찾을 수 없습니다")
	}

	plan := models.AccumulationPlan{
		AccountID: req.AccountID, AssetID: req.AssetID,
		Amount: req.Amount, AmountCurrency: req.AmountCurrency, QtyStep: req.QtyStep,
		Schedule: req.Schedule, Weekdays: req.Weekdays, MonthDay: req.MonthDay,
		Condition: req.Condition, ConditionValue: req.ConditionValue,
		Status: req.Status, StartedOn: req.StartedOn, AutoFrom: req.AutoFrom,
		OpeningRounds: req.OpeningRounds, OpeningAmount: req.OpeningAmount, OpeningQuantity: req.OpeningQuantity,
		Notes: strings.TrimSpace(req.Notes),
	}

	var openingPrice float64
	if req.AddOpeningToHoldings {
		p, err := s.openingPrice(req.OpeningAmount, req.OpeningQuantity, req.AmountCurrency, tickerCurrency(asset.Ticker), now)
		if err != nil {
			return nil, err
		}
		openingPrice = p
	}

	if err := s.db.Create(&plan).Error; err != nil {
		return nil, fmt.Errorf("계획을 저장하지 못했습니다: %w", err)
	}

	if req.AddOpeningToHoldings {
		day, _ := parseDay(todayKST(now))
		tx, err := s.txs.CreateTransaction(CreateTransactionRequest{
			AccountID: plan.AccountID, AssetID: plan.AssetID, Type: models.TransactionTypeBuy,
			Date: day, Price: openingPrice, Quantity: req.OpeningQuantity,
			Notes: fmt.Sprintf("주식 모으기 등록 전까지 모은 것 (%d회)", req.OpeningRounds),
		})
		if err != nil {
			s.db.Unscoped().Delete(&plan)
			return nil, fmt.Errorf("지금까지 모은 수량을 보유에 더하지 못했습니다: %w", err)
		}
		plan.OpeningTxID = &tx.ID
		if err := s.db.Model(&plan).Update("opening_tx_id", tx.ID).Error; err != nil {
			return nil, err
		}
	}
	return &plan, nil
}

func (s *AccumulationService) UpdatePlan(id uint, req AccumulationPlanRequest) (*models.AccumulationPlan, error) {
	now := s.clock()
	var plan models.AccumulationPlan
	if err := s.db.Preload("Asset").First(&plan, id).Error; err != nil {
		return nil, ErrPlanNotFound
	}
	// 계좌·종목은 바꾸지 않는다 (자동 기록이 이미 그 계좌·종목의 보유에 들어가 있음)
	req.AccountID, req.AssetID = plan.AccountID, plan.AssetID
	if strings.TrimSpace(req.AutoFrom) == "" {
		req.AutoFrom = plan.AutoFrom
	}
	if err := s.validate(&req, now); err != nil {
		return nil, err
	}

	autoFrom := req.AutoFrom
	// 중지했다가 다시 켜면 쉬던 기간은 채우지 않고 오늘부터 기록한다
	if plan.Status == models.PlanStatusPaused && req.Status == models.PlanStatusActive {
		if t := todayKST(now); t > autoFrom {
			autoFrom = t
		}
	}

	// 등록 때 보유에 더한 기록이 있으면 지금까지 모은 값을 고칠 때 같이 고친다
	if plan.OpeningTxID != nil && (req.OpeningAmount != plan.OpeningAmount || req.OpeningQuantity != plan.OpeningQuantity || req.AmountCurrency != plan.AmountCurrency) {
		var otx models.Transaction
		if err := s.db.First(&otx, *plan.OpeningTxID).Error; err == nil {
			if req.OpeningQuantity <= 0 || req.OpeningAmount <= 0 {
				if err := s.txs.DeleteTransaction(otx.ID); err != nil {
					return nil, fmt.Errorf("등록 때 더한 기록을 지우지 못했습니다: %w", err)
				}
				plan.OpeningTxID = nil
			} else {
				price, err := s.openingPrice(req.OpeningAmount, req.OpeningQuantity, req.AmountCurrency, tickerCurrency(plan.Asset.Ticker), now)
				if err != nil {
					return nil, err
				}
				if _, err := s.txs.UpdateTransaction(otx.ID, CreateTransactionRequest{
					Type: otx.Type, Date: otx.Date, Price: price, Quantity: req.OpeningQuantity, Fee: otx.Fee,
					Notes: fmt.Sprintf("주식 모으기 등록 전까지 모은 것 (%d회)", req.OpeningRounds),
				}); err != nil {
					return nil, fmt.Errorf("등록 때 더한 기록을 고치지 못했습니다: %w", err)
				}
			}
		} else {
			plan.OpeningTxID = nil // 매매 기록에서 이미 지운 경우
		}
	}

	updates := map[string]any{
		"amount": req.Amount, "amount_currency": req.AmountCurrency, "qty_step": req.QtyStep,
		"schedule": req.Schedule, "weekdays": req.Weekdays, "month_day": req.MonthDay,
		"condition": req.Condition, "condition_value": req.ConditionValue,
		"status": req.Status, "started_on": req.StartedOn, "auto_from": autoFrom,
		"opening_rounds": req.OpeningRounds, "opening_amount": req.OpeningAmount, "opening_quantity": req.OpeningQuantity,
		"opening_tx_id": plan.OpeningTxID, "notes": strings.TrimSpace(req.Notes),
	}
	if err := s.db.Model(&plan).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("계획을 저장하지 못했습니다: %w", err)
	}
	if err := s.db.First(&plan, id).Error; err != nil {
		return nil, err
	}
	return &plan, nil
}

// DeletePlan 은 계획만 지운다. 이미 남긴 매수 기록은 실제로 산 것이라 매매 기록에 그대로 둔다.
func (s *AccumulationService) DeletePlan(id uint) error {
	res := s.db.Delete(&models.AccumulationPlan{}, id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrPlanNotFound
	}
	return nil
}

// ───────────────────────── 목록·회차 ─────────────────────────

type AccumulationPlanView struct {
	models.AccumulationPlan
	AssetCurrency    string   `json:"asset_currency"`
	Rounds           int      `json:"rounds"`      // 지금까지 모은 회차 + 자동 기록 회차
	AutoRounds       int      `json:"auto_rounds"` // 앱이 남긴 회차
	Invested         float64  `json:"invested"`    // 금액 통화
	Quantity         float64  `json:"quantity"`
	CurrentPrice     float64  `json:"current_price"` // 종목 통화 (0 = 시세 없음)
	PriceDate        string   `json:"price_date,omitempty"`
	Value            *float64 `json:"value,omitempty"` // 금액 통화
	PnL              *float64 `json:"pnl,omitempty"`
	PnLPct           *float64 `json:"pnl_pct,omitempty"`
	HoldingQuantity  float64  `json:"holding_quantity"`
	HoldingAvgPrice  float64  `json:"holding_avg_price"`
	HoldingReturnPct *float64 `json:"holding_return_pct,omitempty"` // 종목 통화 기준 (조건 판단과 같은 값)
	ConditionMet     *bool    `json:"condition_met,omitempty"`      // 지금 가격이면 사는지
	LastFillDate     string   `json:"last_fill_date,omitempty"`
	NextDate         string   `json:"next_date,omitempty"` // 다음 예정 거래일 (휴장일은 모름)
	MonthlyMax       float64  `json:"monthly_max"`         // 조건을 늘 만족할 때 한 달 금액 (금액 통화)
	// 지금 가격에서 수량 단위 하나를 사는 데 드는 금액 (금액 통화). 한 회차 금액이 이보다 작으면 사지 못한다.
	MinAmount float64 `json:"min_amount,omitempty"`
}

type AccumulationFill struct {
	TransactionID uint    `json:"transaction_id"`
	Round         int     `json:"round"`
	Date          string  `json:"date"`
	Price         float64 `json:"price"` // 종목 통화
	Quantity      float64 `json:"quantity"`
	Amount        float64 `json:"amount"` // 금액 통화
	Fx            float64 `json:"fx,omitempty"`
	Edited        bool    `json:"edited"`
}

func monthlyCount(p *models.AccumulationPlan) float64 {
	switch p.Schedule {
	case models.PlanScheduleDaily:
		return 21
	case models.PlanScheduleWeekly:
		n := 0
		for d := 1; d <= 5; d++ { // 월~금
			if p.Weekdays&(1<<uint(d)) != 0 {
				n++
			}
		}
		return float64(n) * 52 / 12
	case models.PlanScheduleMonthly:
		return 1
	}
	return 0
}

// nextScheduled: 아직 처리하지 않은 날 가운데 계획한 첫 평일 (휴장일은 고려하지 않음)
func nextScheduled(p *models.AccumulationPlan, now time.Time) string {
	from, ok := parseDay(firstPending(p))
	if !ok {
		return ""
	}
	if t, ok := parseDay(todayKST(now)); ok && from.Before(t.AddDate(0, 0, -7)) {
		from = t.AddDate(0, 0, -7) // 오래 밀린 경우에도 가까운 날만 찾는다
	}
	for i := 0; i < 70; i++ {
		d := from.AddDate(0, 0, i)
		// 계획한 날이 주말이면 그 회차는 건너뛰므로 다음 계획일을 찾는다
		if wd := d.Weekday(); wd == time.Saturday || wd == time.Sunday || !scheduledOn(p, d) {
			continue
		}
		return dayString(d)
	}
	return ""
}

func ptr[T any](v T) *T { return &v }

func (s *AccumulationService) ListPlans() ([]AccumulationPlanView, error) {
	now := s.clock()
	var plans []models.AccumulationPlan
	if err := s.db.Preload("Account").Preload("Asset").Order("id").Find(&plans).Error; err != nil {
		return nil, err
	}
	out := make([]AccumulationPlanView, 0, len(plans))
	if len(plans) == 0 {
		return out, nil
	}

	ids := make([]uint, 0, len(plans))
	tickerSet := map[string]bool{}
	needFx := false
	for _, p := range plans {
		ids = append(ids, p.ID)
		tickerSet[p.Asset.Ticker] = true
		if p.AmountCurrency != tickerCurrency(p.Asset.Ticker) {
			needFx = true
		}
	}
	var fills []models.Transaction
	if err := s.db.Where("plan_id IN ?", ids).Order("date").Find(&fills).Error; err != nil {
		return nil, err
	}
	byPlan := map[uint][]models.Transaction{}
	for _, f := range fills {
		byPlan[*f.PlanID] = append(byPlan[*f.PlanID], f)
	}

	var fxAt func(time.Time) float64
	if needFx {
		if look, err := s.getFxLookup(); err == nil {
			fxAt = look
		}
	}
	tickers := make([]string, 0, len(tickerSet))
	for t := range tickerSet {
		tickers = append(tickers, t)
	}
	sort.Strings(tickers)
	hist := s.cachedHistories(tickers)

	type hkey struct{ acc, asset uint }
	holdings := map[hkey]models.Holding{}
	var hs []models.Holding
	if err := s.db.Find(&hs).Error; err != nil {
		return nil, err
	}
	for _, h := range hs {
		holdings[hkey{h.AccountID, h.AssetID}] = h
	}

	for _, p := range plans {
		assetCcy := tickerCurrency(p.Asset.Ticker)
		v := AccumulationPlanView{AccumulationPlan: p, AssetCurrency: assetCcy}
		v.Invested, v.Quantity = p.OpeningAmount, p.OpeningQuantity
		investedOK := true
		for _, f := range byPlan[p.ID] {
			v.AutoRounds++
			v.Quantity += f.Quantity
			fx := 0.0
			if fxAt != nil {
				fx = fxAt(f.Date)
			}
			amt, ok := convertAmount(f.Price*f.Quantity+f.Fee, assetCcy, p.AmountCurrency, fx)
			if !ok {
				investedOK = false
			}
			v.Invested += amt
			v.LastFillDate = dayString(f.Date)
		}
		v.Rounds = p.OpeningRounds + v.AutoRounds

		if bars := sessionBars(hist[strings.ToUpper(p.Asset.Ticker)]); len(bars) > 0 {
			last := bars[len(bars)-1]
			v.CurrentPrice, v.PriceDate = last.close, last.day
		}
		if v.CurrentPrice > 0 && investedOK {
			fx := 0.0
			if fxAt != nil {
				fx = fxAt(now)
			}
			if min, ok := convertAmount(p.QtyStep*v.CurrentPrice, assetCcy, p.AmountCurrency, fx); ok {
				v.MinAmount = min
			}
			if val, ok := convertAmount(v.Quantity*v.CurrentPrice, assetCcy, p.AmountCurrency, fx); ok {
				v.Value = ptr(val)
				v.PnL = ptr(val - v.Invested)
				if v.Invested > 0 {
					v.PnLPct = ptr((val/v.Invested - 1) * 100)
				}
			}
		}
		h := holdings[hkey{p.AccountID, p.AssetID}]
		v.HoldingQuantity, v.HoldingAvgPrice = h.Quantity, h.AveragePrice
		if h.Quantity > 0 && h.AveragePrice > 0 && v.CurrentPrice > 0 {
			v.HoldingReturnPct = ptr((v.CurrentPrice/h.AveragePrice - 1) * 100)
		}
		if v.CurrentPrice > 0 {
			switch p.Condition {
			case models.PlanConditionPriceBelow:
				v.ConditionMet = ptr(v.CurrentPrice <= p.ConditionValue)
			case models.PlanConditionReturnBelow:
				v.ConditionMet = ptr(v.HoldingReturnPct == nil || *v.HoldingReturnPct <= p.ConditionValue)
			}
		}
		if p.Status == models.PlanStatusActive {
			v.NextDate = nextScheduled(&p, now)
		}
		v.MonthlyMax = math.Round(p.Amount*monthlyCount(&p)*100) / 100
		out = append(out, v)
	}
	return out, nil
}

func (s *AccumulationService) GetFills(planID uint) ([]AccumulationFill, error) {
	var plan models.AccumulationPlan
	if err := s.db.Preload("Asset").First(&plan, planID).Error; err != nil {
		return nil, ErrPlanNotFound
	}
	var txs []models.Transaction
	if err := s.db.Where("plan_id = ?", planID).Order("date").Find(&txs).Error; err != nil {
		return nil, err
	}
	assetCcy := tickerCurrency(plan.Asset.Ticker)
	var fxAt func(time.Time) float64
	if plan.AmountCurrency != assetCcy && len(txs) > 0 {
		if look, err := s.getFxLookup(); err == nil {
			fxAt = look
		}
	}
	out := make([]AccumulationFill, 0, len(txs))
	for i, t := range txs {
		f := AccumulationFill{
			TransactionID: t.ID, Round: plan.OpeningRounds + i + 1, Date: dayString(t.Date),
			Price: t.Price, Quantity: t.Quantity,
			Edited: t.UpdatedAt.Sub(t.CreatedAt) > 2*time.Second,
		}
		if fxAt != nil {
			f.Fx = fxAt(t.Date)
		}
		if amt, ok := convertAmount(t.Price*t.Quantity+t.Fee, assetCcy, plan.AmountCurrency, f.Fx); ok {
			f.Amount = amt
		}
		out = append(out, f)
	}
	// 최근 회차부터
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func (s *AccumulationService) fillOf(txID uint) (*models.Transaction, *models.AccumulationPlan, error) {
	var t models.Transaction
	if err := s.db.First(&t, txID).Error; err != nil || t.PlanID == nil {
		return nil, nil, ErrPlanNotFound
	}
	var plan models.AccumulationPlan
	if err := s.db.Unscoped().Preload("Asset").First(&plan, *t.PlanID).Error; err != nil {
		return nil, nil, ErrPlanNotFound
	}
	return &t, &plan, nil
}

// UpdateFill 은 자동 기록한 회차를 증권사 앱에 보이는 실제 금액·수량으로 고친다 (금액은 계획 통화 기준).
func (s *AccumulationService) UpdateFill(txID uint, quantity, amount float64) error {
	if quantity <= 0 || amount <= 0 || !finite(quantity) || !finite(amount) {
		return planInputErr("수량과 금액은 0보다 커야 합니다")
	}
	t, plan, err := s.fillOf(txID)
	if err != nil {
		return err
	}
	assetCcy := tickerCurrency(plan.Asset.Ticker)
	fx := 0.0
	if plan.AmountCurrency != assetCcy {
		look, err := s.getFxLookup()
		if err != nil {
			return fmt.Errorf("환율을 가져오지 못했습니다: %w", err)
		}
		fx = look(t.Date)
	}
	v, ok := convertAmount(amount, plan.AmountCurrency, assetCcy, fx)
	if !ok {
		return errors.New("환율을 가져오지 못했습니다")
	}
	_, err = s.txs.UpdateTransaction(t.ID, CreateTransactionRequest{
		Type: t.Type, Date: t.Date, Price: v / quantity, Quantity: quantity, Fee: 0, Notes: t.Notes,
	})
	return err
}

// DeleteFill 은 그날 실제로는 사지 않은 회차를 지운다 (다시 채우지 않는다).
func (s *AccumulationService) DeleteFill(txID uint) error {
	t, _, err := s.fillOf(txID)
	if err != nil {
		return err
	}
	return s.txs.DeleteTransaction(t.ID)
}

// ───────────────────────── 자동 기록 ─────────────────────────

type AccumulationRunResult struct {
	Created int      `json:"created"`
	Skipped int      `json:"skipped"` // 조건을 못 맞췄거나 금액이 최소 단위보다 작아 건너뛴 회차
	Plans   int      `json:"plans"`   // 확인한 계획 수
	Errors  []string `json:"errors,omitempty"`
}

// RunDue 는 진행 중인 계획마다 아직 처리하지 않은, 장이 끝난 거래일을 채운다.
// 앱을 며칠 안 켰어도 다음에 빠진 날을 한꺼번에 채운다. 이미 돌고 있으면 그냥 돌아온다.
func (s *AccumulationService) RunDue() (*AccumulationRunResult, error) {
	res := &AccumulationRunResult{}
	if !s.runMu.TryLock() {
		return res, nil
	}
	defer s.runMu.Unlock()

	now := s.clock()
	var plans []models.AccumulationPlan
	if err := s.db.Preload("Asset").Where("status = ?", models.PlanStatusActive).Order("id").Find(&plans).Error; err != nil {
		return nil, err
	}

	// 장이 끝난 처리 대상 거래일이 생긴 계획만 시세를 받는다
	due := plans[:0]
	oldest := map[string]string{}
	needFx := false
	for _, p := range plans {
		from := firstPending(&p)
		if !sessionClosed(p.Asset.Ticker, from, now) {
			continue
		}
		due = append(due, p)
		t := strings.ToUpper(p.Asset.Ticker)
		if o, ok := oldest[t]; !ok || from < o {
			oldest[t] = from
		}
		if p.AmountCurrency != tickerCurrency(p.Asset.Ticker) {
			needFx = true
		}
	}
	if len(due) == 0 {
		return res, nil
	}

	hist := map[string]*PriceHistory{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for t, from := range oldest {
		rng := "3mo"
		if f, ok := parseDay(from); ok && now.Sub(f) > 80*24*time.Hour {
			rng = "1y"
		}
		wg.Add(1)
		go func(t, rng string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			h, err := s.getHistory(t, rng)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("%s 시세: %v", t, err))
				return
			}
			hist[t] = h
		}(t, rng)
	}
	wg.Wait()

	var fxAt func(time.Time) float64
	if needFx {
		look, err := s.getFxLookup()
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("환율: %v", err))
		} else {
			fxAt = look
		}
	}

	for i := range due {
		p := &due[i]
		h := hist[strings.ToUpper(p.Asset.Ticker)]
		if h == nil {
			continue
		}
		if p.AmountCurrency != tickerCurrency(p.Asset.Ticker) && fxAt == nil {
			continue
		}
		res.Plans++
		s.processPlan(p, sessionBars(h), fxAt, now, res)
	}
	sort.Strings(res.Errors)
	return res, nil
}

func (s *AccumulationService) processPlan(p *models.AccumulationPlan, bars []sessionBar, fxAt func(time.Time) float64, now time.Time, res *AccumulationRunResult) {
	from := firstPending(p)
	assetCcy := tickerCurrency(p.Asset.Ticker)
	processed := ""
	for _, b := range bars {
		if b.day < from {
			continue
		}
		if !sessionClosed(p.Asset.Ticker, b.day, now) {
			break
		}
		if !scheduleHit(p, b.day) {
			processed = b.day
			continue
		}
		day, _ := parseDay(b.day)

		if !s.conditionMet(p, b.close) {
			res.Skipped++
			processed = b.day
			continue
		}
		fx := 0.0
		if fxAt != nil {
			fx = fxAt(day)
		}
		amount, ok := convertAmount(p.Amount, p.AmountCurrency, assetCcy, fx)
		if !ok {
			break
		}
		qty := floorQty(amount, b.close, p.QtyStep)
		if qty <= 0 {
			res.Skipped++
			processed = b.day
			continue
		}
		_, err := s.txs.CreateTransaction(CreateTransactionRequest{
			AccountID: p.AccountID, AssetID: p.AssetID, Type: models.TransactionTypeBuy,
			Date: day, Price: b.close, Quantity: qty, Notes: accumulationNote, PlanID: &p.ID,
		})
		if err != nil {
			if !isUniqueViolation(err) { // 고유 인덱스 충돌 = 다른 곳(서버/앱)이 이미 기록함
				res.Errors = append(res.Errors, fmt.Sprintf("%s %s: %v", p.Asset.Ticker, b.day, err))
				break
			}
		} else {
			res.Created++
		}
		processed = b.day
	}
	if processed != "" && processed > p.ProcessedThrough {
		s.db.Model(&models.AccumulationPlan{}).Where("id = ?", p.ID).Update("processed_through", processed)
		p.ProcessedThrough = processed
	}
}

// conditionMet: 그날 종가로 조건을 판단한다. 수익률은 이 계좌 보유의 평균 단가(종목 통화) 기준.
// 보유가 없으면 수익률을 알 수 없어 산다.
func (s *AccumulationService) conditionMet(p *models.AccumulationPlan, close float64) bool {
	switch p.Condition {
	case models.PlanConditionPriceBelow:
		return close <= p.ConditionValue
	case models.PlanConditionReturnBelow:
		var h models.Holding
		if err := s.db.Where("account_id = ? AND asset_id = ?", p.AccountID, p.AssetID).First(&h).Error; err != nil {
			return true
		}
		if h.Quantity <= 0 || h.AveragePrice <= 0 {
			return true
		}
		return (close/h.AveragePrice-1)*100 <= p.ConditionValue
	}
	return true
}

// RunEvery 는 지금 한 번, 이후 every 마다 RunDue 를 돌린다 (ctx 가 끝나면 멈춤).
func (s *AccumulationService) RunEvery(ctx context.Context, every time.Duration) {
	run := func() {
		res, err := s.RunDue()
		if err != nil {
			log.Printf("[Accumulation] 자동 기록 오류: %v", err)
			return
		}
		if res.Created > 0 || len(res.Errors) > 0 {
			log.Printf("[Accumulation] %d건 기록, %d건 건너뜀, 오류 %v", res.Created, res.Skipped, res.Errors)
		}
	}
	run()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
