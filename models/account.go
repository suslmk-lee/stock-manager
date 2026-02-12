package models

import (
	"time"
	"gorm.io/gorm"
)

type MarketType string

const (
	MarketTypeDomestic     MarketType = "Domestic"
	MarketTypeInternational MarketType = "International"
)

type Account struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	Name           string         `gorm:"size:100;not null" json:"name"`
	Broker         string         `gorm:"size:100" json:"broker"`
	AccountNumber  string         `gorm:"size:50" json:"account_number"`
	MarketType     MarketType     `gorm:"size:20;not null;default:'Domestic'" json:"market_type"`
	Currency       string         `gorm:"size:10;not null;default:'KRW'" json:"currency"`
	Description    string         `gorm:"size:500" json:"description"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
	
	Holdings     []Holding      `gorm:"foreignKey:AccountID" json:"holdings,omitempty"`
	Transactions []Transaction  `gorm:"foreignKey:AccountID" json:"transactions,omitempty"`
	Dividends    []Dividend     `gorm:"foreignKey:AccountID" json:"dividends,omitempty"`
}
