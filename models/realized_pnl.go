package models

import (
	"time"

	"gorm.io/gorm"
)

// RealizedPnL은 매도 시점에 자동으로 기록되는 실현손익 내역입니다.
type RealizedPnL struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	TransactionID uint           `gorm:"not null;uniqueIndex" json:"transaction_id"`
	AccountID     uint           `gorm:"not null;index" json:"account_id"`
	AssetID       uint           `gorm:"not null;index" json:"asset_id"`
	Date          time.Time      `gorm:"not null;index" json:"date"`
	Quantity      float64        `gorm:"not null" json:"quantity"`
	BuyAvgPrice   float64        `gorm:"not null" json:"buy_avg_price"`
	SellPrice     float64        `gorm:"not null" json:"sell_price"`
	Fee           float64        `gorm:"default:0" json:"fee"`
	Profit        float64        `gorm:"not null" json:"profit"`
	ProfitPercent float64        `gorm:"not null" json:"profit_percent"`
	Currency      string         `gorm:"size:10;not null;default:'KRW'" json:"currency"`
	Notes         string         `gorm:"size:500" json:"notes"`
	CreatedAt     time.Time      `json:"created_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`

	Account     Account     `gorm:"foreignKey:AccountID" json:"account,omitempty"`
	Asset       Asset       `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
	Transaction Transaction `gorm:"foreignKey:TransactionID" json:"transaction,omitempty"`
}
