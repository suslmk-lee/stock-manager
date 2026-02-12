package models

import (
	"time"
	"gorm.io/gorm"
)

type TransactionType string

const (
	TransactionTypeBuy  TransactionType = "Buy"
	TransactionTypeSell TransactionType = "Sell"
)

type Transaction struct {
	ID        uint            `gorm:"primaryKey" json:"id"`
	AccountID uint            `gorm:"not null;index" json:"account_id"`
	AssetID   uint            `gorm:"not null;index" json:"asset_id"`
	Type      TransactionType `gorm:"size:10;not null" json:"type"`
	Date      time.Time       `gorm:"not null;index" json:"date"`
	Price     float64         `gorm:"not null" json:"price"`
	Quantity  float64         `gorm:"not null" json:"quantity"`
	Fee       float64         `gorm:"default:0" json:"fee"`
	Notes     string          `gorm:"size:500" json:"notes"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	DeletedAt gorm.DeletedAt  `gorm:"index" json:"-"`
	
	Account Account `gorm:"foreignKey:AccountID" json:"account,omitempty"`
	Asset   Asset   `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}
