package models

import "time"

type PortfolioSnapshot struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	AccountID   uint      `gorm:"not null;uniqueIndex:idx_snapshot_unique" json:"account_id"`
	AssetID     uint      `gorm:"not null;uniqueIndex:idx_snapshot_unique" json:"asset_id"`
	Year        int       `gorm:"not null;uniqueIndex:idx_snapshot_unique" json:"year"`
	Month       int       `gorm:"not null;uniqueIndex:idx_snapshot_unique" json:"month"`
	Quantity    float64   `gorm:"not null;default:0" json:"quantity"`
	Price       float64   `gorm:"not null;default:0" json:"price"`
	MarketValue float64   `gorm:"not null;default:0" json:"market_value"`
	Currency    string    `gorm:"size:10;not null;default:'KRW'" json:"currency"`
	CreatedAt   time.Time `json:"created_at"`

	Account Account `gorm:"foreignKey:AccountID" json:"account,omitempty"`
	Asset   Asset   `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}
