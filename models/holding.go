package models

import (
	"time"
	"gorm.io/gorm"
)

type Holding struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	AccountID    uint           `gorm:"not null;index:idx_account_asset" json:"account_id"`
	AssetID      uint           `gorm:"not null;index:idx_account_asset" json:"asset_id"`
	Quantity     float64        `gorm:"not null;default:0" json:"quantity"`
	AveragePrice float64        `gorm:"not null;default:0" json:"average_price"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
	
	Account Account `gorm:"foreignKey:AccountID" json:"account,omitempty"`
	Asset   Asset   `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}
