package models

import "time"

// 사기 좋은 가격 — 종목마다 자기 과거 가격(10년 일봉)과 배당으로 "지금이 싼가"를 매일 계산해 날짜별로 남긴다 (30일 보관).
// 화면·오늘 점수·알림은 이 기록만 읽는다 (계산은 백그라운드에서).

const (
	SignalEventKindZone = "zone" // 알림 종류: 사기 좋은 가격대에 들어옴

	ZoneLevelGreat = "great" // 아주 좋은 가격: 3년 종가 하위 10% 이하
	ZoneLevelGood  = "good"  // 좋은 가격: 3년 종가 하위 20% 이하
	ZoneLevelFair  = "fair"  // 보통: 3년 중간값 이하
	ZoneLevelHigh  = "high"  // 비싼 편

	ZoneVerdictWorks = "works" // 과거에 싸게 산 날의 1년 뒤 수익이 평소보다 좋았다
	ZoneVerdictTrap  = "trap"  // 과거에 싸게 산 날의 1년 뒤 수익이 평소보다 나빴다 (계속 내려간 종목)
	ZoneVerdictFew   = "few"   // 비교할 사례가 적다
)

// PriceZone 은 한 종목의 하루치 가격대 계산 결과다 (KST 날짜마다 한 줄, 같은 날에는 새로 계산하면 덮어쓴다).
type PriceZone struct {
	ID       uint    `gorm:"primaryKey" json:"id"`
	AssetID  uint    `gorm:"not null;uniqueIndex:idx_price_zone_day" json:"asset_id"`
	Date     string  `gorm:"size:10;not null;uniqueIndex:idx_price_zone_day;index" json:"date"` // KST YYYY-MM-DD
	Ticker   string  `gorm:"size:20" json:"ticker"`
	Currency string  `gorm:"size:3" json:"currency"`
	Price    float64 `json:"price"`  // 계산에 쓴 가격 (이력의 마지막 종가)
	PriceAt  int64   `json:"price_at"` // 그 종가의 시각 (unix 초)
	Years    float64 `json:"years"`  // 쓴 이력 길이 (년)

	// 가격 위치: 그 기간 종가 가운데 지금보다 낮았던 비율 (0 = 그 기간 최저, 100 = 최고)
	Pos1y  float64 `json:"pos_1y"`
	Pos3y  float64 `json:"pos_3y"`
	Low1y  float64 `json:"low_1y"`
	High1y float64 `json:"high_1y"`
	Great  float64 `json:"great"` // 아주 좋은 가격: 3년 종가 하위 10%
	Good   float64 `json:"good"`  // 좋은 가격: 3년 종가 하위 20%
	Mid    float64 `json:"mid"`   // 3년 중간값

	// 배당: 최근 1년 주당 배당 ÷ 가격. 배당률이 낮으면(2% 미만) 점수에 쓰지 않는다
	Yield          float64 `json:"yield"`            // %, 0 = 배당 없음
	YieldPos       float64 `json:"yield_pos"`        // 지난 배당률 가운데 지금보다 낮았던 비율, -1 = 비교 불가
	YieldGoodPrice float64 `json:"yield_good_price"` // 배당률이 지난 상위 20%가 되는 가격 (0 = 없음)

	// 최근 흐름
	MA20      float64 `json:"ma20"`
	FromLow20 float64 `json:"from_low20"` // 직전 20거래일 저점 대비 (%)
	Falling   bool    `json:"falling"`    // 20일선 아래이고 저점에서 2% 안쪽 — 아직 내려가는 중

	// 자기 검증: 과거에 1년 종가 하위 20%였던 날 샀다면 1년 뒤 총수익(배당 재투자)이 어땠나
	TestDays      int     `json:"test_days"`      // 1년 뒤를 알 수 있는 날 수
	CheapDays     int     `json:"cheap_days"`     // 그중 1년 하위 20% 가격이던 날
	CheapEpisodes int     `json:"cheap_episodes"` // 그런 날이 이어진 구간 수 (한 달 넘게 떨어져 있으면 다른 구간)
	CheapAvg      float64 `json:"cheap_avg"`      // 그날 샀다면 1년 뒤 총수익 평균 (%)
	AllAvg        float64 `json:"all_avg"`        // 모든 날 평균 (%)
	CheapWin      float64 `json:"cheap_win"`      // 그날 샀다면 1년 뒤 이익이던 비율 (%)
	Verdict       string  `gorm:"size:10" json:"verdict"`

	Level string  `gorm:"size:10" json:"level"` // great | good | fair | high
	Score float64 `json:"score"`                // 가격 매력 0~100

	Alerted   bool      `gorm:"not null;default:false" json:"-"` // 좋은 가격대에 들어왔다고 알렸다
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// InZone: 좋은 가격 이하
func (z PriceZone) InZone() bool { return z.Level == ZoneLevelGreat || z.Level == ZoneLevelGood }
