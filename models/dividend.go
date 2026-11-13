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

	// 저장하지 않음: 기록·수정 뒤 구글 시트에 반영하지 못한 이유 (시트에 그 종목 줄이 없을 때)
	SheetNote string `gorm:"-" json:"sheet_note,omitempty"`
	
	Account Account `gorm:"foreignKey:AccountID" json:"account,omitempty"`
	Asset   Asset   `gorm:"foreignKey:AssetID" json:"asset,omitempty"`
}
