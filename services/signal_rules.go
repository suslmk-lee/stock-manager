package services

import (
	"errors"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultTaxHarvestMonth   = 11
	defaultCrashPct          = -40
	defaultMinSellQty        = 1
	defaultAnnualizedMinDays = 90
	defaultPartialPct        = 33

	defaultBuyCooldownDays   = 14
	defaultBuyMaxWeightPct   = 20
	defaultBuyQtyAmountKRW   = 1000000
	defaultBuyQtyLowerAvgPct = 5

	defaultReboundFromLowPct   = 5
	defaultReboundLookbackDays = 20
	defaultYieldExpansionPct   = 20
	defaultTimeStopDays        = 365
	defaultShortDropDays       = 20
	defaultShortDropPct        = -15
)

// migrateRuleConfig 는 이전 단계 규칙의 0 값 필드를 새 기본값으로 한 번만 보정한다. 보정했으면 true.
//   - v1 -> v2: 시세 추세 / 배당 삭감 / 양도세 / 환율 기본값
//   - v2 -> v3: 큰 폭락 경고(crash_pct=-40, 꺼짐)
//   - v3 -> v4: 소량 보유 매도 제외(1주 이하, 켜짐)
//   - v10 -> v11: PER/PBR 평균 대비 규칙(모두 꺼짐, 기간/기준 기본값 채움)
//   - v9 -> v10: RSI/MFI/PER/PBR 규칙(모두 꺼짐, 기간/기준 기본값 채움)
//   - v8 -> v9: 장기 이평 하회/52주 고점 대비 하락을 하회 후 반등 모드로 전환 (켜짐 여부와 임계값은 유지)
//   - v7 -> v8: 반등 확인/시간 손절/단기 급락(꺼짐, 반등 MA 옵션 켜짐), 배당수익률 확대(배당형 규칙만 켜짐)
//   - v6 -> v7: 매수 규칙(쿨다운/최대 비중/수량 제안 켜짐, 마지막 매수가 대비 꺼짐), 변동성 손절(꺼짐), 매도 충족 방식을 그룹 방식으로 환산
//   - v5 -> v6: 배당수익률 압축(익절/손절이 모두 꺼진 배당형 규칙만 켜짐), 변동성 과열/과매도(꺼짐)
//   - v4 -> v5: 익절 규칙(트레일링은 익절/손절 규칙이 있을 때만 켜짐, 연환산/쏠림은 꺼짐), 분할 매도(켜짐)
func migrateRuleConfig(c *models.SignalRuleConfig, version *int) bool {
	if *version >= models.SignalRuleVersion {
		return false
	}
	if *version < 2 {
		def := models.DefaultSignalRuleConfig()
		if c.FromHighPct == 0 {
			c.FromHighPct = def.FromHighPct
		}
		if c.BelowMAPct == 0 {
			c.BelowMAPct = def.BelowMAPct
		}
		if c.AboveMAPct == 0 {
			c.AboveMAPct = def.AboveMAPct
		}
		if c.DividendCutPct == 0 {
			c.DividendCutPct = def.DividendCutPct
		}
		if c.TaxHarvestFromMonth == 0 {
			c.TaxHarvestFromMonth = defaultTaxHarvestMonth
		}
		c.FxHistorical = true
		c.TaxHarvestEnabled = true
	}
	if *version < 3 {
		if c.CrashPct == 0 {
			c.CrashPct = defaultCrashPct
		}
		c.CrashEnabled = false
	}
	if *version < 4 {
		if c.MinSellQty == 0 {
			c.MinSellQty = defaultMinSellQty
		}
		c.MinSellQtyEnabled = true
	}
	if *version < 5 {
		def := models.DefaultSignalRuleConfig()
		if c.TrailingActivatePct == 0 {
			c.TrailingActivatePct = def.TrailingActivatePct
		}
		if c.TrailingDropPct == 0 {
			c.TrailingDropPct = def.TrailingDropPct
		}
		if c.AnnualizedPct == 0 {
			c.AnnualizedPct = def.AnnualizedPct
		}
		if c.AnnualizedMinDays == 0 {
			c.AnnualizedMinDays = def.AnnualizedMinDays
		}
		if c.AnnualizedMinReturnPct == 0 {
			c.AnnualizedMinReturnPct = def.AnnualizedMinReturnPct
		}
		if c.DriftPct == 0 {
			c.DriftPct = def.DriftPct
		}
		if c.PartialPct == 0 {
			c.PartialPct = def.PartialPct
		}
		c.TrailingEnabled = c.TakeProfitEnabled || c.StopLossEnabled
		c.AnnualizedEnabled = false
		c.DriftEnabled = false
		c.PartialEnabled = true
	}
	if *version < 6 {
		def := models.DefaultSignalRuleConfig()
		if c.YieldCompressionPct == 0 {
			c.YieldCompressionPct = def.YieldCompressionPct
		}
		if c.VolOverheatSigma == 0 {
			c.VolOverheatSigma = def.VolOverheatSigma
		}
		if c.VolOversoldSigma == 0 {
			c.VolOversoldSigma = def.VolOversoldSigma
		}
		c.YieldCompressionEnabled = !(c.TakeProfitEnabled || c.StopLossEnabled) // 배당형 규칙만 켬
		c.VolOverheatEnabled = false
		c.VolOversoldEnabled = false
	}
	if *version < 7 {
		def := models.DefaultSignalRuleConfig()
		if c.LastBuyDipPct == 0 {
			c.LastBuyDipPct = def.LastBuyDipPct
		}
		if c.BuyCooldownDays == 0 {
			c.BuyCooldownDays = def.BuyCooldownDays
		}
		if c.BuyMaxWeightPct == 0 {
			c.BuyMaxWeightPct = def.BuyMaxWeightPct
		}
		if c.BuyQtyMode == "" {
			c.BuyQtyMode = def.BuyQtyMode
		}
		if c.BuyQtyAmountKRW == 0 {
			c.BuyQtyAmountKRW = def.BuyQtyAmountKRW
		}
		if c.BuyQtyLowerAvgPct == 0 {
			c.BuyQtyLowerAvgPct = def.BuyQtyLowerAvgPct
		}
		if c.VolStopK == 0 {
			c.VolStopK = def.VolStopK
		}
		c.LastBuyDipEnabled = false
		c.BuyCooldownEnabled = true
		c.BuyMaxWeightEnabled = true
		c.BuyQtyEnabled = true
		c.VolStopEnabled = false
		// 매도 충족 방식을 그룹 방식으로 환산: any -> (1,1), count N -> (N,1), all -> (99,99)
		switch c.SellMode {
		case "all":
			c.SellProfitMinCount, c.SellRiskMinCount = 99, 99
		case "count":
			n := c.SellMinCount
			if n < 1 {
				n = 1
			}
			c.SellProfitMinCount, c.SellRiskMinCount = n, 1
		default:
			c.SellProfitMinCount, c.SellRiskMinCount = 1, 1
		}
		c.SellMode = "group"
		c.SellMinCount = 0
	}
	if *version < 8 {
		def := models.DefaultSignalRuleConfig()
		if c.ReboundFromLowPct == 0 {
			c.ReboundFromLowPct = def.ReboundFromLowPct
		}
		if c.ReboundLookbackDays == 0 {
			c.ReboundLookbackDays = def.ReboundLookbackDays
		}
		if c.YieldExpansionPct == 0 {
			c.YieldExpansionPct = def.YieldExpansionPct
		}
		if c.TimeStopDays == 0 {
			c.TimeStopDays = def.TimeStopDays
		}
		// TimeStopMaxReturnPct 의 기본값은 0 자체이므로 보정하지 않는다
		if c.ShortDropDays == 0 {
			c.ShortDropDays = def.ShortDropDays
		}
		if c.ShortDropPct == 0 {
			c.ShortDropPct = def.ShortDropPct
		}
		c.ReboundConfirmEnabled = false
		c.ReboundMAEnabled = true
		c.YieldExpansionEnabled = !(c.TakeProfitEnabled || c.StopLossEnabled) // 배당형 규칙만 켬
		c.TimeStopEnabled = false
		c.ShortDropEnabled = false
	}
	if *version < 9 {
		def := models.DefaultSignalRuleConfig()
		c.BelowMAMode, c.FromHighMode = def.BelowMAMode, def.FromHighMode
		c.BelowMALookbackDays, c.BelowMAMaxAbovePct, c.BelowMAReclaimDays = def.BelowMALookbackDays, def.BelowMAMaxAbovePct, def.BelowMAReclaimDays
		c.FromHighLookbackDays, c.FromHighReboundPct, c.FromHighStillBelowPct = def.FromHighLookbackDays, def.FromHighReboundPct, def.FromHighStillBelowPct
	}
	if *version < 10 {
		def := models.DefaultSignalRuleConfig()
		c.RsiPeriod, c.MfiPeriod, c.OscLookbackDays = def.RsiPeriod, def.MfiPeriod, def.OscLookbackDays
		c.RsiBuyLevel, c.RsiSellLevel, c.MfiBuyLevel, c.MfiSellLevel = def.RsiBuyLevel, def.RsiSellLevel, def.MfiBuyLevel, def.MfiSellLevel
		c.PerBuyMax, c.PerSellMin, c.PbrBuyMax, c.PbrSellMin = def.PerBuyMax, def.PerSellMin, def.PbrBuyMax, def.PbrSellMin
		c.RsiBuyEnabled, c.RsiSellEnabled, c.MfiBuyEnabled, c.MfiSellEnabled = false, false, false, false
		c.PerBuyEnabled, c.PerSellEnabled, c.PbrBuyEnabled, c.PbrSellEnabled = false, false, false, false
	}
	if *version < 11 {
		def := models.DefaultSignalRuleConfig()
		c.ValuationWindowMonths = def.ValuationWindowMonths
		c.PerAvgBuyPct, c.PerAvgSellPct, c.PbrAvgBuyPct, c.PbrAvgSellPct = def.PerAvgBuyPct, def.PerAvgSellPct, def.PbrAvgBuyPct, def.PbrAvgSellPct
		c.PerAvgBuyEnabled, c.PerAvgSellEnabled, c.PbrAvgBuyEnabled, c.PbrAvgSellEnabled = false, false, false, false
	}
	*version = models.SignalRuleVersion
	return true
}

func migrateSignalRule(r *models.SignalRule) bool {
	return migrateRuleConfig(&r.SignalRuleConfig, &r.RuleVersion)
}

func persistMigratedRule(db *gorm.DB, r *models.SignalRule) error {
	if !migrateSignalRule(r) {
		return nil
	}
	return db.Omit(clause.Associations).Save(r).Error
}

// SignalRules 는 레거시 호환 응답이다: default 는 "기본" 프로필의 규칙을 예전 평면 형태로 보여준다.
type SignalRules struct {
	Default   models.SignalRule   `json:"default"`
	Overrides []models.SignalRule `json:"overrides"`
}

// ruleFromProfile 은 프로필 규칙을 레거시 SignalRule(asset_id 0) 모양으로 변환한다.
func ruleFromProfile(p models.SignalProfile) models.SignalRule {
	return models.SignalRule{
		ID: p.ID, AssetID: 0, SignalRuleConfig: p.Rule, RuleVersion: models.SignalRuleVersion,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

func (s *SignalService) GetSignalRules() (*SignalRules, error) {
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	def, err := s.profileByKey(models.ProfileKeyDefault)
	if err != nil {
		return nil, err
	}
	overrides := []models.SignalRule{}
	if err := s.db.Where("asset_id <> ?", 0).Order("asset_id").Find(&overrides).Error; err != nil {
		return nil, err
	}
	for i := range overrides {
		if err := persistMigratedRule(s.db, &overrides[i]); err != nil {
			return nil, err
		}
	}
	return &SignalRules{Default: ruleFromProfile(def), Overrides: overrides}, nil
}

func (s *SignalService) saveAssetRule(assetID uint, rule models.SignalRule) (models.SignalRule, error) {
	if err := ValidateSignalRule(&rule); err != nil {
		return rule, err
	}
	rule.AssetID = assetID
	rule.RuleVersion = models.SignalRuleVersion // 클라이언트가 보낸 값과 무관하게 최신 스키마로 저장 (재보정 방지)
	var existing models.SignalRule
	err := s.db.Where("asset_id = ?", assetID).First(&existing).Error
	switch {
	case err == nil:
		rule.ID = existing.ID
		rule.CreatedAt = existing.CreatedAt
		if err := s.db.Omit(clause.Associations).Save(&rule).Error; err != nil {
			return rule, err
		}
	case errors.Is(err, gorm.ErrRecordNotFound):
		rule.ID = 0
		rule.CreatedAt = time.Time{}
		if err := s.db.Create(&rule).Error; err != nil {
			return rule, err
		}
	default:
		return rule, err
	}
	return rule, nil
}

// SaveDefaultRule 은 "기본" 프로필의 규칙을 갱신한다 (레거시 PUT /signal-rules/default).
func (s *SignalService) SaveDefaultRule(rule models.SignalRule) (*models.SignalRule, error) {
	if err := ValidateSignalRule(&rule); err != nil {
		return nil, err
	}
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	def, err := s.profileByKey(models.ProfileKeyDefault)
	if err != nil {
		return nil, err
	}
	def.Rule = rule.SignalRuleConfig
	def.RuleVersion = models.SignalRuleVersion
	if err := s.db.Omit(clause.Associations).Save(&def).Error; err != nil {
		return nil, err
	}
	r := ruleFromProfile(def)
	return &r, nil
}

func (s *SignalService) SaveAssetRule(assetID uint, rule models.SignalRule) (*models.SignalRule, error) {
	if assetID == 0 {
		return nil, &ErrInvalidSignalRule{"asset id is required"}
	}
	r, err := s.saveAssetRule(assetID, rule)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *SignalService) DeleteAssetRule(assetID uint) error {
	if assetID == 0 {
		return &ErrInvalidSignalRule{"asset id is required"}
	}
	return s.db.Where("asset_id = ?", assetID).Delete(&models.SignalRule{}).Error
}
