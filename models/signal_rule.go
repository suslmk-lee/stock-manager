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

	// 9단계: 장기 이평 하회 / 52주 고점 대비 하락을 "하회 후 반등" 으로 전환
	BelowMAMode           string  `gorm:"size:10" json:"below_ma_mode"`  // below | rebound | reclaim
	BelowMALookbackDays   int     `json:"below_ma_lookback_days"`        // 10~250 거래일
	BelowMAMaxAbovePct    float64 `json:"below_ma_max_above_pct"`        // 0~50, rebound 모드에서 200일선 위로 허용하는 최대 괴리
	BelowMAReclaimDays    int     `json:"below_ma_reclaim_days"`         // 1~60, reclaim 모드: 최근 N 종가 내 상향 돌파
	FromHighMode          string  `gorm:"size:10" json:"from_high_mode"` // below | rebound
	FromHighLookbackDays  int     `json:"from_high_lookback_days"`       // 10~250 거래일
	FromHighReboundPct    float64 `json:"from_high_rebound_pct"`         // (0, 100], 최근 저점 대비 반등 폭
	FromHighStillBelowPct float64 `json:"from_high_still_below_pct"`     // <= 0, 현재도 52주 고점 대비 이 값 이하

	DividendCutEnabled bool    `json:"dividend_cut_enabled"`
	DividendCutPct     float64 `json:"dividend_cut_pct"` // >= 0

	TaxHarvestEnabled   bool `json:"tax_harvest_enabled"`
	TaxHarvestFromMonth int  `json:"tax_harvest_from_month"` // 1~12
	FxHistorical        bool `json:"fx_historical"`

	// 4단계: 보유 수량이 MinSellQty 주 이하이면 매도 조건이 충족돼도 매도 검토에서 제외한다
	MinSellQtyEnabled bool    `json:"min_sell_qty_enabled"`
	MinSellQty        float64 `json:"min_sell_qty"` // >= 0

	// 5단계: 익절 규칙 (트레일링 / 연환산 / 비중 쏠림) 과 분할 매도 제안
	TrailingEnabled     bool    `json:"trailing_enabled"`
	TrailingActivatePct float64 `json:"trailing_activate_pct"` // >= 0, 고점 수익률이 이 값 이상이면 활성화
	TrailingDropPct     float64 `json:"trailing_drop_pct"`     // <= 0, 고점 대비 되돌림

	AnnualizedEnabled      bool    `json:"annualized_enabled"`
	AnnualizedPct          float64 `json:"annualized_pct"`            // >= 0
	AnnualizedMinDays      int     `json:"annualized_min_days"`       // 1~3650
	AnnualizedMinReturnPct float64 `json:"annualized_min_return_pct"` // >= 0

	DriftEnabled bool    `json:"drift_enabled"`
	DriftPct     float64 `json:"drift_pct"` // 시가 비중 - 원가 비중 (%p)

	PartialEnabled bool    `json:"partial_enabled"`
	PartialPct     float64 `json:"partial_pct"` // 1~100

	// 6단계: 배당수익률 압축 / 변동성 대비 과열·과매도
	YieldCompressionEnabled bool    `json:"yield_compression_enabled"`
	YieldCompressionPct     float64 `json:"yield_compression_pct"` // >= 0, 24개월 평균 수익률 대비 압축 폭(%)
	VolOverheatEnabled      bool    `json:"vol_overheat_enabled"`
	VolOverheatSigma        float64 `json:"vol_overheat_sigma"` // >= 0, 200일 이평 괴리 / 연변동성
	VolOversoldEnabled      bool    `json:"vol_oversold_enabled"`
	VolOversoldSigma        float64 `json:"vol_oversold_sigma"` // >= 0 (양수로 저장, -sigma 로 적용)

	// 7단계: 매수 규칙(마지막 매수가 대비 하락 / 재매수 쿨다운 / 최대 비중 / 매수 수량 제안), 변동성 손절
	LastBuyDipEnabled bool    `json:"last_buy_dip_enabled"`
	LastBuyDipPct     float64 `json:"last_buy_dip_pct"` // <= 0, 마지막 매수가 대비

	BuyCooldownEnabled bool `json:"buy_cooldown_enabled"` // 마지막 매수 후 N일 이내는 매수 검토 제외
	BuyCooldownDays    int  `json:"buy_cooldown_days"`    // 1~365

	BuyMaxWeightEnabled bool    `json:"buy_max_weight_enabled"` // 비중이 이 값 이상이면 매수 검토 제외
	BuyMaxWeightPct     float64 `json:"buy_max_weight_pct"`     // (0, 100]

	BuyQtyEnabled     bool    `json:"buy_qty_enabled"`
	BuyQtyMode        string  `gorm:"size:20" json:"buy_qty_mode"` // amount | target_weight | lower_avg
	BuyQtyAmountKRW   float64 `json:"buy_qty_amount_krw"`          // > 0
	BuyQtyLowerAvgPct float64 `json:"buy_qty_lower_avg_pct"`       // (0, 50]

	VolStopEnabled bool    `json:"vol_stop_enabled"`
	VolStopK       float64 `json:"vol_stop_k"` // (0, 5], 손절선 = -K × 연변동성(%)

	// 8단계: 매수 확인(반등), 배당수익률 확대, 시간 손절, 단기 급락
	ReboundConfirmEnabled bool    `json:"rebound_confirm_enabled"` // 매수 조건 충족 후 반등 확인이 안 되면 매수 검토 제외
	ReboundFromLowPct     float64 `json:"rebound_from_low_pct"`    // (0, 100], 최근 저점 대비 반등 폭
	ReboundLookbackDays   int     `json:"rebound_lookback_days"`   // 5~120 거래일(종가 개수)
	ReboundMAEnabled      bool    `json:"rebound_ma_enabled"`      // 현재가 >= 20일 이평이면 반등으로 인정

	YieldExpansionEnabled bool    `json:"yield_expansion_enabled"` // 24개월 평균 대비 배당수익률 확대 (매수)
	YieldExpansionPct     float64 `json:"yield_expansion_pct"`     // > 0

	TimeStopEnabled      bool    `json:"time_stop_enabled"` // 보유 N일 이상인데 수익률이 기준 이하면 매도 (위험 그룹)
	TimeStopDays         int     `json:"time_stop_days"`    // 30~3650
	TimeStopMaxReturnPct float64 `json:"time_stop_max_return_pct"`

	ShortDropEnabled bool    `json:"short_drop_enabled"` // 최근 N거래일 대비 급락 (위험 그룹)
	ShortDropDays    int     `json:"short_drop_days"`    // 5~120 거래일
	ShortDropPct     float64 `json:"short_drop_pct"`     // < 0

	// 충족 방식: "any"(1개 이상) | "all"(모두) | "count"(MinCount 개 이상) | "group"(매도만: 익절/위험 그룹별 N개)
	SellMode     string `gorm:"size:10" json:"sell_mode"`
	BuyMode      string `gorm:"size:10" json:"buy_mode"`
	SellMinCount int    `json:"sell_min_count"` // SellMode == "count" 일 때만 사용
	BuyMinCount  int    `json:"buy_min_count"`  // BuyMode == "count" 일 때만 사용

	// SellMode == "group" 일 때 그룹별 필요 충족 개수 (1~99, 켜진 조건 수를 넘으면 전부로 본다)
	SellProfitMinCount int `json:"sell_profit_min_count"`
	SellRiskMinCount   int `json:"sell_risk_min_count"`
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
const SignalRuleVersion = 9

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
		BelowMAMode:                 "rebound",
		BelowMALookbackDays:         60,
		BelowMAMaxAbovePct:          3,
		BelowMAReclaimDays:          10,
		FromHighMode:                "rebound",
		FromHighLookbackDays:        60,
		FromHighReboundPct:          5,
		FromHighStillBelowPct:       -10,
		AboveMAPct:                  25,
		DividendCutPct:              10,
		TaxHarvestEnabled:           true,
		TaxHarvestFromMonth:         11,
		FxHistorical:                true,
		MinSellQtyEnabled:           true,
		MinSellQty:                  1,
		TrailingEnabled:             true,
		TrailingActivatePct:         20,
		TrailingDropPct:             -10,
		AnnualizedPct:               25,
		AnnualizedMinDays:           90,
		AnnualizedMinReturnPct:      15,
		DriftPct:                    7,
		PartialEnabled:              true,
		PartialPct:                  33,
		YieldCompressionPct:         20,
		VolOverheatSigma:            1.5,
		VolOversoldSigma:            1.5,
		LastBuyDipPct:               -10,
		BuyCooldownEnabled:          true,
		BuyCooldownDays:             14,
		BuyMaxWeightEnabled:         true,
		BuyMaxWeightPct:             20,
		BuyQtyEnabled:               true,
		BuyQtyMode:                  "amount",
		BuyQtyAmountKRW:             1000000,
		BuyQtyLowerAvgPct:           5,
		VolStopK:                    1,
		ReboundFromLowPct:           5,
		ReboundLookbackDays:         20,
		ReboundMAEnabled:            true,
		YieldExpansionPct:           20,
		TimeStopDays:                365,
		ShortDropDays:               20,
		ShortDropPct:                -15,
		SellMode:                    "group",
		BuyMode:                     "any",
		SellProfitMinCount:          1,
		SellRiskMinCount:            1,
	}
}

// DividendSignalRuleConfig 는 "배당 장기보유" 프로필의 공장 출고 규칙이다.
// 손절은 끄고 큰 폭락 경고(-40%)를 켠다.
func DividendSignalRuleConfig() SignalRuleConfig {
	c := DefaultSignalRuleConfig()
	c.TakeProfitEnabled = false
	c.StopLossEnabled = false
	c.TrailingEnabled = false
	c.CrashEnabled = true
	c.CrashPct = -40
	c.DividendCutEnabled = true
	c.BuyDipEnabled = true
	c.BuyDipPct = -10
	c.HighYieldEnabled = true
	c.HighYieldPct = 4
	c.FromHighEnabled = true
	c.FromHighPct = -20
	c.YieldCompressionEnabled = true
	c.YieldExpansionEnabled = true
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
