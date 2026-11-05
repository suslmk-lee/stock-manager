package services

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultProfileName   = "기본"
	defaultProfileDesc   = "균형 잡힌 기본 매매 신호 규칙"
	dividendProfileName  = "배당 장기보유"
	dividendProfileDesc  = "손절 없이 배당 삭감·큰 폭락만 경계하는 장기 보유용 규칙"
	maxProfileNameLength = 100
	maxProfileDescLength = 500
)

// ProfileAssignment 는 종목 -> 프로필 배정이다.
type ProfileAssignment struct {
	AssetID   uint `json:"asset_id"`
	ProfileID uint `json:"profile_id"`
}

type SignalProfiles struct {
	Profiles    []models.SignalProfile `json:"profiles"`
	Assignments []ProfileAssignment    `json:"assignments"`
}

type CreateSignalProfileRequest struct {
	Name              string `json:"name"`
	Description       string `json:"description"`
	Kind              string `json:"kind"`
	CopyFromProfileID uint   `json:"copy_from_profile_id"`
}

type UpdateSignalProfileRequest struct {
	Name        *string                  `json:"name"`
	Description *string                  `json:"description"`
	Kind        *string                  `json:"kind"`
	Rule        *models.SignalRuleConfig `json:"rule"`
}

// ensureSeeded 는 기본 제공 프로필 2개를 멱등하게 만든다 (동시 호출 안전).
func (s *SignalService) ensureSeeded() error {
	s.seedMu.Lock()
	defer s.seedMu.Unlock()
	if s.seeded {
		return nil
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var existing int64
		if err := tx.Model(&models.SignalProfile{}).
			Where("key IN ?", []string{models.ProfileKeyDefault, models.ProfileKeyDividend}).Count(&existing).Error; err != nil {
			return err
		}
		if existing == 2 {
			return nil
		}
		for _, spec := range []struct {
			key, name, desc, kind string
			order                 int
		}{
			{models.ProfileKeyDefault, defaultProfileName, defaultProfileDesc, models.ProfileKindStandard, 0},
			{models.ProfileKeyDividend, dividendProfileName, dividendProfileDesc, models.ProfileKindDividend, 1},
		} {
			var cnt int64
			if err := tx.Model(&models.SignalProfile{}).Where("key = ?", spec.key).Count(&cnt).Error; err != nil {
				return err
			}
			if cnt > 0 {
				continue
			}
			cfg, err := factoryRule(tx, spec.key)
			if err != nil {
				return err
			}
			p := models.SignalProfile{
				Key: spec.key, Name: spec.name, Description: spec.desc, Kind: spec.kind,
				BuiltIn: true, SortOrder: spec.order, Rule: cfg, RuleVersion: models.SignalRuleVersion,
			}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&p).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	// 이전 스키마 버전으로 저장된 프로필 규칙을 한 번 보정한다 (예: v4 소량 보유 매도 제외 기본값)
	var stale []models.SignalProfile
	if err := s.db.Where("rule_version < ?", models.SignalRuleVersion).Find(&stale).Error; err != nil {
		return err
	}
	for i := range stale {
		if migrateRuleConfig(&stale[i].Rule, &stale[i].RuleVersion) {
			if err := s.db.Save(&stale[i]).Error; err != nil {
				return err
			}
		}
	}
	s.seeded = true
	return nil
}

// factoryRule 은 내장 프로필의 초기 규칙이다. "기본" 은 레거시 전역 기본 규칙 행(asset_id=0)이 있으면
// (필요 시 보정 후) 그 사본을, 없으면 기본값을 쓴다. 레거시 행은 삭제하지 않는다.
func factoryRule(db *gorm.DB, key string) (models.SignalRuleConfig, error) {
	if key == models.ProfileKeyDividend {
		return models.DividendSignalRuleConfig(), nil
	}
	var legacy models.SignalRule
	err := db.Where("asset_id = ?", 0).First(&legacy).Error
	switch {
	case err == nil:
		if err := persistMigratedRule(db, &legacy); err != nil {
			return models.SignalRuleConfig{}, err
		}
		return legacy.SignalRuleConfig, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return models.DefaultSignalRuleConfig(), nil
	}
	return models.SignalRuleConfig{}, err
}

func (s *SignalService) profileByKey(key string) (models.SignalProfile, error) {
	var p models.SignalProfile
	err := s.db.Where("key = ?", key).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return p, &ErrSignalNotFound{"profile not found"}
	}
	return p, err
}

func (s *SignalService) profileByID(id uint) (models.SignalProfile, error) {
	var p models.SignalProfile
	err := s.db.First(&p, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return p, &ErrSignalNotFound{"profile not found"}
	}
	return p, err
}

// withAssetCount 는 보유 종목 기준 프로필별 종목 수를 채운다 (배정 없는 종목은 기본 프로필).
func (s *SignalService) withAssetCount(profiles []models.SignalProfile) error {
	var held []uint
	if err := s.db.Model(&models.Holding{}).Where("quantity > 0").Distinct().Pluck("asset_id", &held).Error; err != nil {
		return err
	}
	heldSet := make(map[uint]bool, len(held))
	for _, id := range held {
		heldSet[id] = true
	}
	var assigns []models.AssetSignalProfile
	if err := s.db.Find(&assigns).Error; err != nil {
		return err
	}
	counts := map[uint]int{}
	assigned := 0
	for _, a := range assigns {
		if heldSet[a.AssetID] {
			counts[a.ProfileID]++
			assigned++
		}
	}
	for i := range profiles {
		profiles[i].AssetCount = counts[profiles[i].ID]
		if profiles[i].Key == models.ProfileKeyDefault {
			profiles[i].AssetCount = len(heldSet) - assigned + counts[profiles[i].ID]
		}
	}
	return nil
}

func (s *SignalService) listAssignments() ([]ProfileAssignment, error) {
	var rows []models.AssetSignalProfile
	if err := s.db.Order("asset_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]ProfileAssignment, 0, len(rows))
	for _, r := range rows {
		out = append(out, ProfileAssignment{AssetID: r.AssetID, ProfileID: r.ProfileID})
	}
	return out, nil
}

func (s *SignalService) GetSignalProfiles() (*SignalProfiles, error) {
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	profiles := []models.SignalProfile{}
	if err := s.db.Order("sort_order, id").Find(&profiles).Error; err != nil {
		return nil, err
	}
	if err := s.withAssetCount(profiles); err != nil {
		return nil, err
	}
	as, err := s.listAssignments()
	if err != nil {
		return nil, err
	}
	return &SignalProfiles{Profiles: profiles, Assignments: as}, nil
}

func normalizeProfileKind(k string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(k)) {
	case "", models.ProfileKindStandard:
		return models.ProfileKindStandard, nil
	case models.ProfileKindDividend:
		return models.ProfileKindDividend, nil
	}
	return "", &ErrInvalidSignalRule{"kind must be 'standard' or 'dividend'"}
}

func validateProfileText(name, desc string) error {
	if name == "" {
		return &ErrInvalidSignalRule{"name is required"}
	}
	if len([]rune(name)) > maxProfileNameLength {
		return &ErrInvalidSignalRule{"name is too long"}
	}
	if len([]rune(desc)) > maxProfileDescLength {
		return &ErrInvalidSignalRule{"description is too long"}
	}
	return nil
}

func randomProfileKey() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		b = []byte("fallback0000")[:6]
	}
	return "custom-" + hex.EncodeToString(b)
}

func (s *SignalService) CreateSignalProfile(req CreateSignalProfileRequest) (*models.SignalProfile, error) {
	name := strings.TrimSpace(req.Name)
	desc := strings.TrimSpace(req.Description)
	if err := validateProfileText(name, desc); err != nil {
		return nil, err
	}
	kind, err := normalizeProfileKind(req.Kind)
	if err != nil {
		return nil, err
	}
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	var src models.SignalProfile
	if req.CopyFromProfileID != 0 {
		if src, err = s.profileByID(req.CopyFromProfileID); err != nil {
			return nil, err
		}
	} else if src, err = s.profileByKey(models.ProfileKeyDefault); err != nil {
		return nil, err
	}
	var maxOrder int
	s.db.Model(&models.SignalProfile{}).Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder)
	if maxOrder < 1 {
		maxOrder = 1
	}
	p := models.SignalProfile{
		Key: randomProfileKey(), Name: name, Description: desc, Kind: kind,
		SortOrder: maxOrder + 1, Rule: src.Rule, RuleVersion: models.SignalRuleVersion,
	}
	if err := s.db.Create(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *SignalService) UpdateSignalProfile(id uint, req UpdateSignalProfileRequest) (*models.SignalProfile, error) {
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	p, err := s.profileByID(id)
	if err != nil {
		return nil, err
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if p.BuiltIn && name != p.Name {
			return nil, &ErrInvalidSignalRule{"built-in profile name cannot be changed"}
		}
		p.Name = name
	}
	if req.Description != nil {
		p.Description = strings.TrimSpace(*req.Description)
	}
	if req.Kind != nil {
		kind, err := normalizeProfileKind(*req.Kind)
		if err != nil {
			return nil, err
		}
		if p.BuiltIn && kind != p.Kind {
			return nil, &ErrInvalidSignalRule{"built-in profile kind cannot be changed"}
		}
		p.Kind = kind
	}
	if err := validateProfileText(p.Name, p.Description); err != nil {
		return nil, err
	}
	if req.Rule != nil {
		cfg := *req.Rule
		if err := ValidateSignalRuleConfig(&cfg); err != nil {
			return nil, err
		}
		p.Rule = cfg
		p.RuleVersion = models.SignalRuleVersion
	}
	if err := s.db.Omit(clause.Associations).Save(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *SignalService) DeleteSignalProfile(id uint) error {
	if err := s.ensureSeeded(); err != nil {
		return err
	}
	p, err := s.profileByID(id)
	if err != nil {
		return err
	}
	if p.BuiltIn {
		return &ErrInvalidSignalRule{"built-in profile cannot be deleted"}
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("profile_id = ?", id).Delete(&models.AssetSignalProfile{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.SignalProfile{}, id).Error
	})
}

func (s *SignalService) ResetSignalProfile(id uint) (*models.SignalProfile, error) {
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	p, err := s.profileByID(id)
	if err != nil {
		return nil, err
	}
	if !p.BuiltIn {
		return nil, &ErrInvalidSignalRule{"only built-in profiles can be reset"}
	}
	if p.Key == models.ProfileKeyDividend {
		p.Rule = models.DividendSignalRuleConfig()
	} else {
		p.Rule = models.DefaultSignalRuleConfig()
	}
	p.RuleVersion = models.SignalRuleVersion
	if err := s.db.Omit(clause.Associations).Save(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// AssignSignalProfile 은 종목들을 프로필로 옮긴다 (기본 프로필이면 배정 삭제).
func (s *SignalService) AssignSignalProfile(profileID uint, assetIDs []uint) ([]ProfileAssignment, error) {
	if err := s.ensureSeeded(); err != nil {
		return nil, err
	}
	p, err := s.profileByID(profileID)
	if err != nil {
		return nil, err
	}
	seen := map[uint]bool{}
	ids := make([]uint, 0, len(assetIDs))
	for _, id := range assetIDs {
		if id == 0 {
			return nil, &ErrInvalidSignalRule{"asset id is required"}
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) > 0 {
		var n int64
		if err := s.db.Model(&models.Asset{}).Where("id IN ?", ids).Count(&n).Error; err != nil {
			return nil, err
		}
		if int(n) != len(ids) {
			return nil, &ErrInvalidSignalRule{"unknown asset id"}
		}
	}
	isDefault := p.Key == models.ProfileKeyDefault
	s.alertMu.Lock() // 추천 상태 기록과 직렬화
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if len(ids) == 0 {
			return nil
		}
		if isDefault {
			if err := tx.Where("asset_id IN ?", ids).Delete(&models.AssetSignalProfile{}).Error; err != nil {
				return err
			}
			// 기본 프로필을 직접 고른 것은 추천을 거절한 것으로 본다.
			return tx.Model(&models.ProfileSuggestion{}).
				Where("asset_id IN ? AND status IN ?", ids, []string{models.SuggestionSuggested, models.SuggestionBaseline}).
				Update("status", models.SuggestionDismissed).Error
		}
		rows := make([]models.AssetSignalProfile, 0, len(ids))
		for _, id := range ids {
			rows = append(rows, models.AssetSignalProfile{AssetID: id, ProfileID: profileID})
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "asset_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"profile_id", "updated_at"}),
		}).Create(&rows).Error; err != nil {
			return err
		}
		for _, id := range ids {
			if err := upsertSuggestionStatus(tx, id, models.ProfileKeyDividend, models.SuggestionAccepted); err != nil {
				return err
			}
		}
		return nil
	})
	s.alertMu.Unlock()
	if err != nil {
		return nil, err
	}
	return s.listAssignments()
}

func upsertSuggestionStatus(tx *gorm.DB, assetID uint, key, status string) error {
	row := models.ProfileSuggestion{AssetID: assetID, ProfileKey: key, Status: status}
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "asset_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"status", "updated_at"}),
	}).Create(&row).Error
}

// DismissProfileSuggestion 은 종목의 프로필 추천을 거절 처리하고 안 읽은 추천 알림을 읽음 처리한다.
func (s *SignalService) DismissProfileSuggestion(assetID uint) error {
	if assetID == 0 {
		return &ErrInvalidSignalRule{"asset id is required"}
	}
	var n int64
	if err := s.db.Model(&models.Asset{}).Where("id = ?", assetID).Count(&n).Error; err != nil {
		return err
	}
	if n == 0 {
		return &ErrSignalNotFound{"asset not found"}
	}
	s.alertMu.Lock()
	defer s.alertMu.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := upsertSuggestionStatus(tx, assetID, models.ProfileKeyDividend, models.SuggestionDismissed); err != nil {
			return err
		}
		return tx.Model(&models.SignalEvent{}).
			Where("asset_id = ? AND kind = ? AND read_at IS NULL", assetID, models.SignalEventKindSuggestion).
			Update("read_at", time.Now()).Error
	})
}

// GetProfileCandidates 는 보유 종목 전체의 배당 장기보유 후보 평가를 점수 내림차순으로 반환한다.
func (s *SignalService) GetProfileCandidates() ([]DividendCandidate, error) {
	report, err := s.buildSignalReport()
	if err != nil {
		return nil, err
	}
	out := report.Candidates
	if out == nil {
		out = []DividendCandidate{}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out, nil
}
