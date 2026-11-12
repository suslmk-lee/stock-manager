package models

import (
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
)

type MarketType string

const (
	MarketTypeDomestic     MarketType = "Domestic"
	MarketTypeInternational MarketType = "International"
)

// AccountType 계좌 유형
type AccountType string

const (
	AccountTypeGeneral AccountType = "General"
	AccountTypeISA     AccountType = "ISA"
	AccountTypePension AccountType = "Pension"
	AccountTypeIRP     AccountType = "IRP"
	AccountTypeDC      AccountType = "DC"
)

// IsValid 허용된 계좌 유형인지 확인
func (t AccountType) IsValid() bool {
	switch t {
	case AccountTypeGeneral, AccountTypeISA, AccountTypePension, AccountTypeIRP, AccountTypeDC:
		return true
	}
	return false
}

// IsWithdrawalRestricted 중도 인출이 제한되는 계좌(연금저축/IRP/DC)인지 여부
func (t AccountType) IsWithdrawalRestricted() bool {
	switch t {
	case AccountTypePension, AccountTypeIRP, AccountTypeDC:
		return true
	}
	return false
}

var dcTokenPattern = regexp.MustCompile(`(^|[^A-Z])DC($|[^A-Z])`)

// InferAccountType 계좌명/설명으로 계좌 유형을 추정한다 (기존 계좌 백필용).
func InferAccountType(name, description string) AccountType {
	text := strings.ToUpper(name + " " + description)
	switch {
	case strings.Contains(text, "IRP"):
		return AccountTypeIRP
	case strings.Contains(text, "퇴직") || dcTokenPattern.MatchString(text):
		return AccountTypeDC
	case strings.Contains(text, "연금"):
		return AccountTypePension
	case strings.Contains(text, "ISA"):
		return AccountTypeISA
	}
	return AccountTypeGeneral
}

type Account struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	Name           string         `gorm:"size:100;not null" json:"name"`
	Broker         string         `gorm:"size:100" json:"broker"`
	AccountNumber  string         `gorm:"size:50" json:"account_number"`
	MarketType     MarketType     `gorm:"size:20;not null;default:'Domestic'" json:"market_type"`
	AccountType    AccountType    `gorm:"size:20" json:"account_type"`
	Currency       string         `gorm:"size:10;not null;default:'KRW'" json:"currency"`
	// 미국 주식 결제 통화: USD = 달러 예수금에서 사고팔기, KRW = 원화로 바로 사고팔기(자동 환전, 카카오페이 원화 주문 등)
	ForeignSettle  string         `gorm:"size:3;not null;default:'USD'" json:"foreign_settle"`
	Description    string         `gorm:"size:500" json:"description"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
	
	Holdings     []Holding      `gorm:"foreignKey:AccountID" json:"holdings,omitempty"`
	Transactions []Transaction  `gorm:"foreignKey:AccountID" json:"transactions,omitempty"`
	Dividends    []Dividend     `gorm:"foreignKey:AccountID" json:"dividends,omitempty"`
}
