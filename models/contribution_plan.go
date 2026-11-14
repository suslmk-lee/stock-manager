package models

import (
	"time"

	"gorm.io/gorm"
)

// 부담금 배분: 퇴직연금(DC 등)처럼 매달 정해진 부담금이 계좌에 들어와 정해 둔 비율대로 여러 상품(ETF·펀드)을 자동으로 사는 설정.
// 앱은 주문을 넣지 않는다. 매달 그날의 입금(예수금)과 상품별 매수를 기록으로 남긴다.
type ContributionPlan struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	AccountID uint `gorm:"not null;index" json:"account_id"`
	// 매달 들어오는 부담금 (원). 연봉이 올라 바뀌면 이 값만 고친다 — 그 뒤 회차부터 적용.
	Amount   float64 `gorm:"not null" json:"amount"`
	MonthDay int     `gorm:"not null" json:"month_day"` // 1~31 (그달 말일보다 크면 말일)
	Status   string  `gorm:"size:10;not null;default:'active'" json:"status"`
	// 날짜는 YYYY-MM-DD. AutoFrom 날짜 이후의 회차부터 자동 기록, ProcessedThrough 회차(그달 납입일)까지 처리 끝.
	StartedOn        string `gorm:"size:10" json:"started_on"`
	AutoFrom         string `gorm:"size:10;not null" json:"auto_from"`
	ProcessedThrough string `gorm:"size:10" json:"processed_through"`
	Notes            string `gorm:"size:500" json:"notes"`
	// 시작 잔고 매수만큼 그동안 들어온 부담금 입금 (예수금 기록 하나)
	OpeningDepositID *uint `json:"opening_deposit_id,omitempty"`
	// 투자하고 남은 돈(현금성자산)의 금리 (연 %, 표시·예상 이자용)
	CashRate float64 `gorm:"default:0" json:"cash_rate"`

	Items     []ContributionItem `gorm:"foreignKey:PlanID" json:"items"`
	CreatedAt time.Time          `json:"created_at"`
	UpdatedAt time.Time          `json:"updated_at"`
	DeletedAt gorm.DeletedAt     `gorm:"index" json:"-"`

	Account Account `gorm:"foreignKey:AccountID" json:"account,omitempty"`
}

// ContributionItem: 부담금 배분의 상품 하나와 비율(%, 합 100)
type ContributionItem struct {
	ID      uint    `gorm:"primaryKey" json:"id"`
	PlanID  uint    `gorm:"not null;index" json:"plan_id"`
	AssetID uint    `gorm:"not null" json:"asset_id"`
	Weight  float64 `gorm:"not null" json:"weight"`
	// 시작 잔고 매수 기록 (자동 기록 시작 전까지 쌓인 것 — 고치면 다시 만든다)
	OpeningTxID *uint `json:"opening_tx_id,omitempty"`

	Asset Asset `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}

// FundPrice: 시세가 거래소에 없는 펀드의 기준가. 평가금액 맞추기(은행 앱의 평가금액 ÷ 앱이 센 좌수)로 쌓인다.
// 앱 좌수는 처음 기준가 1,000원으로 시작해 납입할 때마다 그때 기준가로 늘어난다 (펀드가 실제로 하는 방식과 같다).
type FundPrice struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AssetID   uint      `gorm:"not null;uniqueIndex:idx_fund_price_day" json:"asset_id"`
	Date      string    `gorm:"size:10;not null;uniqueIndex:idx_fund_price_day" json:"date"` // YYYY-MM-DD
	Nav       float64   `gorm:"not null" json:"nav"`                                         // 1좌당 원
	Source    string    `gorm:"size:12" json:"source"`                                       // reconcile | opening
	CreatedAt time.Time `json:"created_at"`
}
