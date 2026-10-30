package models

import "time"

const (
	ProfileKeyDefault  = "default"
	ProfileKeyDividend = "dividend"

	ProfileKindStandard = "standard"
	ProfileKindDividend = "dividend"

	SuggestionBaseline  = "baseline"
	SuggestionSuggested = "suggested"
	SuggestionDismissed = "dismissed"
	SuggestionAccepted  = "accepted"

	SignalEventKindSignal     = "signal"
	SignalEventKindSuggestion = "suggestion"
)

// SignalProfile 은 전략 프로필(규칙 묶음)이다.
type SignalProfile struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	Key         string `gorm:"size:64;uniqueIndex;not null" json:"key"`
	Name        string `gorm:"size:100;not null" json:"name"`
	Description string `gorm:"size:500" json:"description"`
	Kind        string `gorm:"size:20" json:"kind"` // standard | dividend
	BuiltIn     bool   `json:"built_in"`
	SortOrder   int    `json:"sort_order"`

	Rule        SignalRuleConfig `gorm:"embedded;embeddedPrefix:rule_" json:"rule"`
	RuleVersion int              `json:"-"`

	AssetCount int `gorm:"-" json:"asset_count"` // 계산 값 (저장 안 함)

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AssetSignalProfile 은 종목 -> 프로필 배정이다. 행이 없으면 기본 프로필.
type AssetSignalProfile struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AssetID   uint      `gorm:"uniqueIndex;not null" json:"asset_id"`
	ProfileID uint      `gorm:"index;not null" json:"profile_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ProfileSuggestion 은 종목별 프로필 추천 상태다 (한 번 제안한 종목을 다시 제안하지 않기 위함).
type ProfileSuggestion struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	AssetID    uint      `gorm:"uniqueIndex;not null" json:"asset_id"`
	ProfileKey string    `gorm:"size:64" json:"profile_key"`
	Status     string    `gorm:"size:20" json:"status"` // baseline | suggested | dismissed | accepted
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
