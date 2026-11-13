package models

import "time"

// DividendScoreSetting 은 배당 점수 항목별 배점(비율)이다. 한 줄만 쓴다 (ID 1).
// 점수 = Σ(항목 점수 0~1 × 배점) ÷ Σ배점 × 100 — 배점 합이 100 이 아니어도 비율로 계산한다.
type DividendScoreSetting struct {
	ID          uint      `gorm:"primaryKey" json:"-"`
	Growth      int       `gorm:"not null;default:30" json:"growth"`      // 배당 성장
	Stability   int       `gorm:"not null;default:25" json:"stability"`   // 배당 안정성
	Yield       int       `gorm:"not null;default:20" json:"yield"`       // 지금 수익률 매력
	Consistency int       `gorm:"not null;default:10" json:"consistency"` // 지급 꾸준함
	Value       int       `gorm:"not null;default:15" json:"value"`       // 가격·가치
	UpdatedAt   time.Time `json:"updated_at"`
}

// DefaultDividendScoreSetting 은 처음 배점 (30·25·20·10·15)
func DefaultDividendScoreSetting() DividendScoreSetting {
	return DividendScoreSetting{ID: 1, Growth: 30, Stability: 25, Yield: 20, Consistency: 10, Value: 15}
}

// DividendScoreSnapshot 은 그달 1일 기준 보유 종목 하나의 배당 점수 기록이다.
// 항목 점수(0~1)만 저장하고 총점·순위는 볼 때 지금 배점으로 계산한다 (배점을 바꾸면 지난 달도 같은 기준으로 다시 매겨진다).
type DividendScoreSnapshot struct {
	ID          uint      `gorm:"primaryKey" json:"-"`
	Month       string    `gorm:"size:7;not null;uniqueIndex:idx_divscore_month_asset" json:"month"` // YYYY-MM
	AssetID     uint      `gorm:"not null;uniqueIndex:idx_divscore_month_asset;index" json:"asset_id"`
	Growth      float64   `json:"growth"`
	Stability   float64   `json:"stability"`
	Yield       float64   `json:"yield"`
	Consistency float64   `json:"consistency"`
	Value       float64   `json:"value"`
	Metrics     string    `gorm:"type:text" json:"-"` // 지표 JSON (성장률·수익률·상태 등)
	Estimated   bool      `json:"estimated"`          // 그달이 지난 뒤 거슬러 계산한 값
	CreatedAt   time.Time `json:"created_at"`
}
