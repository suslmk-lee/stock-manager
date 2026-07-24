package models

import (
	"gorm.io/gorm"
	"time"
)

type AssetType string

const (
	AssetTypeStock AssetType = "Stock"
	AssetTypeETF   AssetType = "ETF"
)

type Asset struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Ticker    string         `gorm:"size:20;uniqueIndex;not null" json:"ticker"`
	Name      string         `gorm:"size:200;not null" json:"name"`
	Type      AssetType      `gorm:"size:20;not null" json:"type"`
	Sector    string         `gorm:"size:100" json:"sector"`
	LogoURL   string         `gorm:"size:500" json:"logo_url,omitempty"`
	// LogoChecked: 로고 도달성 확인을 완료했는지 (못 찾은 경우에도 true로 저장해 재구동마다 재조회 방지)
	LogoChecked bool `gorm:"default:false" json:"-"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Holdings     []Holding     `gorm:"foreignKey:AssetID" json:"holdings,omitempty"`
	Transactions []Transaction `gorm:"foreignKey:AssetID" json:"transactions,omitempty"`
	Dividends    []Dividend    `gorm:"foreignKey:AssetID" json:"dividends,omitempty"`
}
