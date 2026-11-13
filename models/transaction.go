package models

import (
	"gorm.io/gorm"
	"time"
)

type TransactionType string

const (
	TransactionTypeBuy  TransactionType = "Buy"
	TransactionTypeSell TransactionType = "Sell"
)

type Transaction struct {
	ID        uint            `gorm:"primaryKey" json:"id"`
	AccountID uint            `gorm:"not null;index" json:"account_id"`
	AssetID   uint            `gorm:"not null;index;uniqueIndex:idx_tx_contrib" json:"asset_id"`
	Type      TransactionType `gorm:"size:10;not null" json:"type"`
	Date      time.Time       `gorm:"not null;index;uniqueIndex:idx_tx_plan_day;uniqueIndex:idx_tx_contrib" json:"date"`
	Price     float64         `gorm:"not null" json:"price"`
	Quantity  float64         `gorm:"not null" json:"quantity"`
	Fee       float64         `gorm:"default:0" json:"fee"`
	Notes     string          `gorm:"size:500" json:"notes"`
	// PlanID: 주식 모으기가 자동으로 남긴 회차. 같은 계획·같은 날은 한 건만 (여러 곳에서 동시에 돌아도 중복 방지)
	PlanID    *uint          `gorm:"uniqueIndex:idx_tx_plan_day" json:"plan_id,omitempty"`
	// ContribPlanID: 부담금 배분이 자동으로 남긴 매수. 같은 계획·같은 상품·같은 날은 한 건만
	ContribPlanID *uint      `gorm:"uniqueIndex:idx_tx_contrib" json:"contrib_plan_id,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Account Account `gorm:"foreignKey:AccountID" json:"account,omitempty"`
	Asset   Asset   `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}
