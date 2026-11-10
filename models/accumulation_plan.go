package models

import (
	"time"

	"gorm.io/gorm"
)

// 주식 모으기: 증권사의 정기 소액 매수(예: 매일 1,000원, 수익률 -5% 이하일 때 $1) 설정 하나.
// 앱은 주문을 넣지 않는다. 계획대로라면 샀을 회차를 매매 기록(Transaction.PlanID)으로 남긴다.

const (
	PlanScheduleDaily   = "daily"
	PlanScheduleWeekly  = "weekly"
	PlanScheduleMonthly = "monthly"

	PlanConditionAlways      = "always"
	PlanConditionReturnBelow = "return_below" // 보유 수익률이 기준 이하일 때만
	PlanConditionPriceBelow  = "price_below"  // 주가가 기준 이하일 때만

	PlanStatusActive = "active"
	PlanStatusPaused = "paused"
)

type AccumulationPlan struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	AccountID uint `gorm:"not null;index" json:"account_id"`
	AssetID   uint `gorm:"not null;index" json:"asset_id"`

	// 한 회차 금액과 통화 (KRW | USD). 종목 통화와 다르면 그날 환율로 바꿔 계산한다.
	Amount         float64 `gorm:"not null" json:"amount"`
	AmountCurrency string  `gorm:"size:3;not null" json:"amount_currency"`
	// 수량 단위: 이 단위로 내림한 수량만 산다 (카카오페이 0.001주, 금액에 맞춰 사는 곳 0.000001주)
	QtyStep float64 `gorm:"not null;default:0.000001" json:"qty_step"`

	Schedule string `gorm:"size:10;not null" json:"schedule"`
	Weekdays int    `gorm:"default:0" json:"weekdays"`  // weekly: bit0=일요일 … bit6=토요일
	MonthDay int    `gorm:"default:0" json:"month_day"` // monthly: 1~31 (그달 말일보다 크면 말일)

	Condition      string  `gorm:"size:16;not null;default:'always'" json:"condition"`
	ConditionValue float64 `gorm:"default:0" json:"condition_value"` // 수익률(%) 또는 주가(종목 통화)

	Status string `gorm:"size:10;not null;default:'active'" json:"status"`
	// 날짜는 모두 YYYY-MM-DD 문자열. 자동 기록 날짜는 거래소 현지 거래일이다.
	StartedOn        string `gorm:"size:10" json:"started_on"`         // 증권사에서 처음 시작한 날 (표시용)
	AutoFrom         string `gorm:"size:10;not null" json:"auto_from"` // 이 거래일부터 자동 기록
	ProcessedThrough string `gorm:"size:10" json:"processed_through"`  // 이 거래일까지 처리 끝

	// 앱에 등록하기 전까지 모은 것 (증권사 앱의 누적 값). 금액은 AmountCurrency 기준.
	OpeningRounds   int     `gorm:"default:0" json:"opening_rounds"`
	OpeningAmount   float64 `gorm:"default:0" json:"opening_amount"`
	OpeningQuantity float64 `gorm:"default:0" json:"opening_quantity"`
	// 등록하면서 보유에 더한 경우 그 매수 기록 (PlanID 는 비워 둔다 — 회차로 세지 않음)
	OpeningTxID *uint `json:"opening_tx_id,omitempty"`

	Notes     string         `gorm:"size:500" json:"notes"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Account Account `gorm:"foreignKey:AccountID" json:"account,omitempty"`
	Asset   Asset   `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}
