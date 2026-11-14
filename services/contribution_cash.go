package services

import (
	"math"
	"strings"

	"stock-manager/models"
)

// 퇴직연금 현금성자산 — 부담금 중 투자하고 남은 돈은 계좌의 예수금(은행 앱의 '현금성자산')에 남고 금리(예: 연 3.03%)로 이자가 붙는다.
// 앱은 이자를 따로 알 수 없어서, 은행 앱의 현금성자산 금액에 맞추면 늘어난 차이를 이자로 남긴다.
// 현금성자산으로 따로 산 상품은 '추가 매수'로 기록한다 (펀드는 금액만 넣으면 앱 기준가로 좌수를 센다).

const contribCashLabel = "현금성자산"

// SetCash: 현금성자산(예수금) 계산·맞추기에 쓴다
func (s *ContributionService) SetCash(c *CashService) { s.cash = c }

// lastCashSync: 이 계좌의 예수금을 마지막으로 맞춘 날 (잔액 맞추기·맞춘 이자)
func (s *ContributionService) lastCashSync(accountID uint) string {
	var es []models.CashEntry
	s.db.Where("account_id = ? AND kind IN ?", accountID, []string{models.CashAdjust, models.CashInterest}).Order("date DESC").Find(&es)
	for _, e := range es {
		if e.Kind == models.CashAdjust || strings.Contains(e.Notes, cashSyncMark) {
			return dayString(e.Date)
		}
	}
	return ""
}

// ContributionCashSync: 현금성자산 맞추기 결과 (차이가 없으면 Kind 가 빈칸)
type ContributionCashSync struct {
	Kind   string  `json:"kind"`   // interest | adjust | ""
	Amount float64 `json:"amount"` // 남긴 차이 (부호 있음)
	Cash   float64 `json:"cash"`   // 맞춘 뒤 현금성자산
}

// SyncCash: 은행 앱의 현금성자산 금액에 맞춘다 — 늘어난 차이는 이자, 줄어든 차이는 잔액 맞추기. rate(연 %)를 넣으면 금리도 바꾼다 (음수면 그대로).
func (s *ContributionService) SyncCash(planID uint, balance float64, date string, rate float64) (*ContributionCashSync, error) {
	p, err := s.getPlan(planID)
	if err != nil {
		return nil, err
	}
	if s.cash == nil {
		return nil, planInputErr("예수금을 계산할 수 없습니다")
	}
	if !(balance >= 0) || !finite(balance) {
		return nil, planInputErr("현금성자산 금액을 0 이상으로 넣어 주세요")
	}
	if rate >= 0 {
		if !finite(rate) || rate > 30 {
			return nil, planInputErr("금리는 0~30%% 사이로 넣어 주세요")
		}
		if err := s.db.Model(&models.ContributionPlan{}).Where("id = ?", planID).Update("cash_rate", rate).Error; err != nil {
			return nil, err
		}
	}
	e, err := s.cash.ReconcileInterest(p.AccountID, CashReconcileRequest{Currency: "KRW", Balance: balance, Date: date}, contribCashLabel)
	if err != nil {
		return nil, err
	}
	out := &ContributionCashSync{Cash: balance}
	if e != nil {
		out.Kind, out.Amount = e.Kind, e.Amount
	}
	return out, nil
}

// ContributionBuyRequest: 현금성자산으로 따로 산 것 (ETF 는 수량·체결가, 펀드는 매수 금액)
type ContributionBuyRequest struct {
	AssetID  uint    `json:"asset_id"`
	Date     string  `json:"date"`
	Amount   float64 `json:"amount"`   // 펀드: 매수 금액 (원)
	Quantity float64 `json:"quantity"` // ETF·주식: 수량
	Price    float64 `json:"price"`    // ETF·주식: 체결가 (원)
	Notes    string  `json:"notes"`
}

// RecordBuy: 이 계좌에 추가 매수를 기록한다 (그만큼 현금성자산이 준다). 펀드는 그날까지의 앱 기준가로 좌수를 센다.
func (s *ContributionService) RecordBuy(planID uint, req ContributionBuyRequest) (*models.Transaction, error) {
	p, err := s.getPlan(planID)
	if err != nil {
		return nil, err
	}
	var a models.Asset
	if err := s.db.First(&a, req.AssetID).Error; err != nil {
		return nil, planInputErr("상품을 골라 주세요")
	}
	fund := IsFundTicker(a.Ticker)
	if !fund && !isKRW(tickerCurrency(a.Ticker)) {
		return nil, planInputErr("%s: 원화 상품(국내 ETF·펀드)만 기록할 수 있습니다", a.Name)
	}
	day := strings.TrimSpace(req.Date)
	if day == "" {
		day = s.today()
	}
	t, ok := parseDay(day)
	if !ok {
		return nil, planInputErr("날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)")
	}
	notes := strings.TrimSpace(req.Notes)
	if notes == "" {
		notes = contribCashLabel + "으로 추가 매수"
	}
	var qty, price float64
	if fund {
		if !(req.Amount > 0) || !finite(req.Amount) {
			return nil, planInputErr("매수 금액을 넣어 주세요")
		}
		nav := s.funds.BuyNav(a.ID, day)
		qty = math.Floor(req.Amount/nav/contribQtyStep) * contribQtyStep
		if qty <= 0 {
			return nil, planInputErr("매수 금액이 너무 작습니다")
		}
		price = req.Amount / qty
	} else {
		if !(req.Quantity > 0) || !(req.Price > 0) || !finite(req.Quantity) || !finite(req.Price) {
			return nil, planInputErr("수량과 체결가를 넣어 주세요")
		}
		qty, price = req.Quantity, req.Price
	}
	return s.txs.CreateTransaction(CreateTransactionRequest{AccountID: p.AccountID, AssetID: a.ID, Type: models.TransactionTypeBuy, Date: t, Price: price, Quantity: qty, Notes: notes})
}
