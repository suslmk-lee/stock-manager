package services

import (
	"errors"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultTaxHarvestMonth = 11
	defaultCrashPct        = -40
	defaultMinSellQty      = 1
)

// migrateRuleConfig 는 이전 단계 규칙의 0 값 필드를 새 기본값으로 한 번만 보정한다. 보정했으면 true.
//   - v1 -> v2: 시세 추세 / 배당 삭감 / 양도세 / 환율 기본값
//   - v2 -> v3: 큰 폭락 경고(crash_pct=-40, 꺼짐)
//   - v3 -> v4: 소량 보유 매도 제외(1주 이하, 켜짐)
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
