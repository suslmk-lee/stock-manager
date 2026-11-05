package models

import "time"

// FundamentalSnapshot 은 종목별 하루(KST 날짜) 펀더멘털 스냅샷이다. (날짜, 종목)당 1행.
type FundamentalSnapshot struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	Date       string    `gorm:"size:10;not null;uniqueIndex:idx_fund_snap_unique" json:"date"` // YYYY-MM-DD (KST)
	AssetID    uint      `gorm:"not null;uniqueIndex:idx_fund_snap_unique" json:"asset_id"`
	Ticker     string    `gorm:"size:32;not null;default:''" json:"ticker"`
	PER        float64   `gorm:"not null;default:0" json:"per"`
	ForwardPER float64   `gorm:"not null;default:0" json:"forward_per"`
	PBR        float64   `gorm:"not null;default:0" json:"pbr"`
	EPS        float64   `gorm:"not null;default:0" json:"eps"`
	BPS        float64   `gorm:"not null;default:0" json:"bps"`
	Source     string    `gorm:"size:10;not null;default:''" json:"source"` // yahoo | naver
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
