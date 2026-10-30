package models

import "time"

// DailyAssetSnapshot 하루(KST 날짜) 단위 총자산 스냅샷. 날짜당 1행.
type DailyAssetSnapshot struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	Date            string    `gorm:"size:10;not null;uniqueIndex:idx_daily_asset_date" json:"date"` // YYYY-MM-DD (KST)
	TotalKRW        float64   `gorm:"not null;default:0" json:"total_krw"`
	CostKRW         float64   `gorm:"not null;default:0" json:"cost_krw"`
	LiquidKRW       float64   `gorm:"not null;default:0" json:"liquid_krw"`        // 인출 제한 없는 계좌
	RestrictedKRW   float64   `gorm:"not null;default:0" json:"restricted_krw"`    // 연금/IRP/DC
	DividendsCumKRW float64   `gorm:"not null;default:0" json:"dividends_cum_krw"` // 세후 누적 수령 배당
	UsdKrw          float64   `gorm:"not null;default:0" json:"usd_krw"`
	Estimated       bool      `gorm:"not null;default:false" json:"estimated"`
	Source          string    `gorm:"size:20;not null;default:''" json:"source"` // cron | startup | manual | estimate
	CapturedAt      time.Time `json:"captured_at"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// DailyPositionSnapshot 하루 단위 (계좌, 종목) 포지션 스냅샷.
type DailyPositionSnapshot struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Date      string    `gorm:"size:10;not null;uniqueIndex:idx_daily_pos_unique" json:"date"`
	AccountID uint      `gorm:"not null;uniqueIndex:idx_daily_pos_unique" json:"account_id"`
	AssetID   uint      `gorm:"not null;uniqueIndex:idx_daily_pos_unique" json:"asset_id"`
	Quantity  float64   `gorm:"not null;default:0" json:"quantity"`
	Price     float64   `gorm:"not null;default:0" json:"price"` // 종목 통화
	Currency  string    `gorm:"size:10;not null;default:'KRW'" json:"currency"`
	FxRate    float64   `gorm:"not null;default:1" json:"fx_rate"`
	ValueKRW  float64   `gorm:"not null;default:0" json:"value_krw"`
	CostKRW   float64   `gorm:"not null;default:0" json:"cost_krw"`
	Estimated bool      `gorm:"not null;default:false" json:"estimated"`
	CreatedAt time.Time `json:"created_at"`
}
