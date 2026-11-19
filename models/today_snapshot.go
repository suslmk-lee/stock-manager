package models

import "time"

// TodaySnapshot 은 그날 마지막으로 계산한 '오늘 살 종목' 결과(JSON)다.
// 앱을 새로 켜면 시세 캐시가 비어 처음 계산에 10초 넘게 걸려서, 이것부터 보여 주고 뒤에서 새로 계산한다 (7일 보관).
type TodaySnapshot struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	Date       string    `gorm:"size:10;not null;uniqueIndex" json:"date"` // KST YYYY-MM-DD
	Data       string    `gorm:"type:text;not null" json:"-"`
	ComputedAt time.Time `json:"computed_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
