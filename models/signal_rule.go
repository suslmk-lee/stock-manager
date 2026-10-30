package models

import "time"

// SignalRuleConfig 는 매매 신호 규칙 설정 값 묶음이다. 종목별 규칙(SignalRule)과
// 전략 프로필(SignalProfile)이 공유한다. JSON 은 평평한(flat) 필드 그대로 직렬화된다.
type SignalRuleConfig struct {
	TakeProfitEnabled bool    `json:"take_profit_enabled"`
	TakeProfitPct     float64 `json:"take_profit_pct"`
	StopLossEnabled   bool    `json:"stop_loss_enabled"`
	StopLossPct       float64 `json:"stop_loss_pct"`

	// 큰 폭락 경고: 수익률(반환 기준)이 CrashPct 이하이면 매도 검토 (3단계)
	CrashEnabled bool    `json:"crash_enabled"`
	CrashPct     float64 `json:"crash_pct"` // <= 0

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

	SellMode string `gorm:"size:10" json:"sell_mode"`
	BuyMode  string `gorm:"size:10" json:"buy_mode"`
}

// SignalRule 은 매매 신호 규칙이다. AssetID == 0 이면 (레거시) 전역 기본 규칙, 아니면 종목별 오버라이드.
// 전역 기본 규칙은 이제 "기본" 전략 프로필이 대체하며 AssetID == 0 행은 보존만 한다.
// 소프트 삭제를 쓰지 않아(DeletedAt 없음) AssetID 유니크 인덱스가 단순하게 유지된다.
type SignalRule struct {
	ID      uint `gorm:"primaryKey" json:"id"`
	AssetID uint `gorm:"uniqueIndex;not null" json:"asset_id"`

	SignalRuleConfig `gorm:"embedded"`

	// RuleVersion 은 스키마 버전이다. 이전 단계 행은 로드 시 한 번만 새 기본값으로 보정된다.
	RuleVersion int `json:"rule_version"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SignalRuleVersion 은 현재 규칙 스키마 버전이다.
const SignalRuleVersion = 3

// DefaultSignalRuleConfig 는 "균형" 기본 규칙 설정(저장 전)을 반환한다.
func DefaultSignalRuleConfig() SignalRuleConfig {
	return SignalRuleConfig{
		TakeProfitEnabled:           true,
		TakeProfitPct:               30,
		StopLossEnabled:             true,
		StopLossPct:                 -20,
		CrashEnabled:                false,
		CrashPct:                    -40,
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
		SellMode:                    "any",
		BuyMode:                     "any",
	}
}

// DividendSignalRuleConfig 는 "배당 장기보유" 프로필의 공장 출고 규칙이다.
// 손절은 끄고 큰 폭락 경고(-40%)를 켠다.
func DividendSignalRuleConfig() SignalRuleConfig {
	c := DefaultSignalRuleConfig()
	c.TakeProfitEnabled = false
	c.StopLossEnabled = false
	c.CrashEnabled = true
	c.CrashPct = -40
	c.DividendCutEnabled = true
	c.BuyDipEnabled = true
	c.BuyDipPct = -10
	c.HighYieldEnabled = true
	c.HighYieldPct = 4
	c.FromHighEnabled = true
	c.FromHighPct = -20
	return c
}

// DefaultSignalRule 은 "균형" 기본 규칙(저장 전)을 반환한다.
func DefaultSignalRule() SignalRule {
	return SignalRule{
		AssetID:          0,
		SignalRuleConfig: DefaultSignalRuleConfig(),
		RuleVersion:      SignalRuleVersion,
	}
}
