package models

import (
	"time"
	"gorm.io/gorm"
)

type Dividend struct {
	ID         uint           `gorm:"primaryKey" json:"id"`
	AccountID  uint           `gorm:"not null;index" json:"account_id"`
	AssetID    uint           `gorm:"not null;index" json:"asset_id"`
	Date       time.Time      `gorm:"not null;index" json:"date"`
	Amount     float64        `gorm:"not null" json:"amount"`
	Currency   string         `gorm:"size:10;not null;default:'USD'" json:"currency"`
	Tax        float64        `gorm:"default:0" json:"tax"`
	IsReceived bool           `gorm:"default:false" json:"is_received"`
	Notes      string         `gorm:"size:500" json:"notes"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
	
	Account Account `gorm:"foreignKey:AccountID" json:"account,omitempty"`
	Asset   Asset   `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}
