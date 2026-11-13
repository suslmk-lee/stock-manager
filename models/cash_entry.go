package models

import (
	"time"

	"gorm.io/gorm"
)

// 예수금(현금) 원장 — 매매·배당으로는 알 수 없는 현금 움직임만 적는다.
// 잔액 = 이 기록들의 합 + 매도 수령액 − 매수 지불액 + 수령한 배당(세후). 매매·배당은 따로 저장하지 않고 계산한다.

const (
	CashDeposit  = "deposit"  // 입금
	CashWithdraw = "withdraw" // 출금
	CashExchange = "exchange" // 환전 (원화 −, 달러 + 처럼 두 줄이 PairID 로 묶인다)
	CashInterest = "interest" // 이자 (CMA·예탁금 이용료 등)
	CashAdjust   = "adjust"   // 잔액 맞추기 (증권사 잔액과의 차이)
)

type CashEntry struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AccountID uint      `gorm:"not null;index" json:"account_id"`
	Currency  string    `gorm:"size:3;not null" json:"currency"` // KRW | USD
	Date      time.Time `gorm:"not null;index;uniqueIndex:idx_cash_contrib" json:"date"`
	Kind      string    `gorm:"size:12;not null" json:"kind"`
	// 부호 있는 금액: 계좌로 들어오면 +, 나가면 −
	Amount float64 `gorm:"not null" json:"amount"`
	Notes  string  `gorm:"size:500" json:"notes"`
	// 환전: 상대 통화 쪽 기록 (지우면 같이 지운다)
	PairID    *uint          `gorm:"index" json:"pair_id,omitempty"`
	// 부담금 배분이 자동으로 남긴 입금 (같은 계획·같은 날은 한 건만)
	ContribPlanID *uint `gorm:"uniqueIndex:idx_cash_contrib" json:"contrib_plan_id,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
