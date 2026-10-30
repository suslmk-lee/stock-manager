package models

import "time"

// SignalRule 은 매매 신호 규칙이다. AssetID == 0 이면 전역 기본 규칙, 아니면 종목별 오버라이드.
// 소프트 삭제를 쓰지 않아(DeletedAt 없음) AssetID 유니크 인덱스가 단순하게 유지된다.
type SignalRule struct {
	ID      uint `gorm:"primaryKey" json:"id"`
	AssetID uint `gorm:"uniqueIndex;not null" json:"asset_id"`

	TakeProfitEnabled bool    `json:"take_profit_enabled"`
	TakeProfitPct     float64 `json:"take_profit_pct"`
	StopLossEnabled   bool    `json:"stop_loss_enabled"`
	StopLossPct       float64 `json:"stop_loss_pct"`

	WeightEnabled   bool    `json:"weight_enabled"`
	TargetWeightPct float64 `json:"target_weight_pct"`
	WeightBandPct   float64 `json:"weight_band_pct"`

	DividendPaybackEnabled      bool    `json:"dividend_payback_enabled"`
	DividendPaybackPct          float64 `json:"dividend_payback_pct"`
	DividendPaybackMinReturnPct float64 `json:"dividend_payback_min_return_pct"`

	LowYieldEnabled bool    `json:"low_yield_enabled"`
	LowYieldPct     float64 `json:"low_yield_pct"`

	BuyDipEnabled bool    `json:"buy_dip_enabled"`
	BuyDipPct     float64 `json:"buy_dip_pct"`

	HighYieldEnabled bool    `json:"high_yield_enabled"`
	HighYieldPct     float64 `json:"high_yield_pct"`

	SellMode string `gorm:"size:10" json:"sell_mode"`
	BuyMode  string `gorm:"size:10" json:"buy_mode"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// DefaultSignalRule 은 "균형" 기본 규칙(저장 전)을 반환한다.
func DefaultSignalRule() SignalRule {
	return SignalRule{
		AssetID:                     0,
		TakeProfitEnabled:           true,
		TakeProfitPct:               30,
		StopLossEnabled:             true,
		StopLossPct:                 -20,
		WeightEnabled:               false,
		TargetWeightPct:             0,
		WeightBandPct:               5,
		DividendPaybackEnabled:      false,
		DividendPaybackPct:          50,
		DividendPaybackMinReturnPct: 10,
		LowYieldEnabled:             false,
		LowYieldPct:                 2,
		BuyDipEnabled:               true,
		BuyDipPct:                   -10,
		HighYieldEnabled:            false,
		HighYieldPct:                5,
		SellMode:                    "any",
		BuyMode:                     "any",
	}
}
