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

	// 2단계: 시세 추세 / 배당 삭감 / 양도세 / 매수 시점 환율
	FromHighEnabled bool    `json:"from_high_enabled"`
	FromHighPct     float64 `json:"from_high_pct"` // <= 0, 52주 고점 대비
	BelowMAEnabled  bool    `json:"below_ma_enabled"`
	BelowMAPct      float64 `json:"below_ma_pct"` // <= 0, 200일 이평 대비
	AboveMAEnabled  bool    `json:"above_ma_enabled"`
	AboveMAPct      float64 `json:"above_ma_pct"` // >= 0

	DividendCutEnabled bool    `json:"dividend_cut_enabled"`
	DividendCutPct     float64 `json:"dividend_cut_pct"` // >= 0

	TaxHarvestEnabled   bool `json:"tax_harvest_enabled"`
	TaxHarvestFromMonth int  `json:"tax_harvest_from_month"` // 1~12
	FxHistorical        bool `json:"fx_historical"`

	// RuleVersion 은 스키마 버전이다. 1단계 행(0)은 로드 시 한 번만 새 기본값으로 보정된다.
	RuleVersion int `json:"rule_version"`

	SellMode string `gorm:"size:10" json:"sell_mode"`
	BuyMode  string `gorm:"size:10" json:"buy_mode"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SignalRuleVersion 은 현재 규칙 스키마 버전이다.
const SignalRuleVersion = 2

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
		FromHighPct:                 -20,
		BelowMAPct:                  -5,
		AboveMAPct:                  25,
		DividendCutPct:              10,
		TaxHarvestEnabled:           true,
		TaxHarvestFromMonth:         11,
		FxHistorical:                true,
		RuleVersion:                 SignalRuleVersion,
		SellMode:                    "any",
		BuyMode:                     "any",
	}
}
