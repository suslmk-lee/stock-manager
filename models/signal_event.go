package models

import "time"

// SignalState 는 종목별 마지막 신호 상태다 (변화 감지용, 내부 전용).
type SignalState struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AssetID   uint      `gorm:"uniqueIndex;not null" json:"asset_id"`
	Action    string    `json:"action"`
	MetKey    string    `json:"met_key"` // 충족된 체크 코드(매도+매수) 정렬 후 "," 연결
	UpdatedAt time.Time `json:"updated_at"`
}

// SignalEvent 는 신호 변화 이력이다. ReadAt == nil 이면 읽지 않음.
type SignalEvent struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	AssetID        uint       `json:"asset_id"`
	Ticker         string     `json:"ticker"`
	Name           string     `json:"name"`
	FromAction     string     `json:"from_action"`
	ToAction       string     `json:"to_action"`
	MetCodes       string     `json:"met_codes"`
	Message        string     `json:"message"`
	TotalReturnPct float64    `json:"total_return_pct"`
	CurrentPrice   float64    `json:"current_price"`
	Currency       string     `json:"currency"`
	CreatedAt      time.Time  `gorm:"index" json:"created_at"`
	ReadAt         *time.Time `gorm:"index" json:"read_at"`
}

// NotificationSetting 은 신호 알림 설정이다 (단일 행, id=1).
type NotificationSetting struct {
	ID              uint      `gorm:"primaryKey" json:"-"`
	Enabled         bool      `json:"enabled"`
	IntervalMinutes int       `json:"interval_minutes"`
	OSNotify        bool      `json:"os_notify"`
	NotifySell      bool      `json:"notify_sell"`
	NotifyBuy       bool      `json:"notify_buy"`
	NotifyConflict  bool      `json:"notify_conflict"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func DefaultNotificationSetting() NotificationSetting {
	return NotificationSetting{
		ID: 1, Enabled: true, IntervalMinutes: 60, OSNotify: true,
		NotifySell: true, NotifyBuy: true, NotifyConflict: true,
	}
}
