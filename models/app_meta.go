package models

import "time"

// AppMeta 는 앱이 스스로 쓰는 작은 설정 값이다 (예: 마지막으로 맞춘 DB 표 구조의 지문).
type AppMeta struct {
	Key       string    `gorm:"primaryKey;size:64" json:"key"`
	Value     string    `gorm:"size:256" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (AppMeta) TableName() string { return "app_meta" }
