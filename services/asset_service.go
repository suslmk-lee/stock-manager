package services

import (
	"errors"
	"log"
	"fmt"
	"stock-manager/database"
	"stock-manager/models"
	"strings"
	"sync"

	"gorm.io/gorm"
)

type AssetService struct {
	db *gorm.DB
}

func NewAssetService() *AssetService {
	return &AssetService{
		db: database.GetDB(),
	}
}

type CreateAssetRequest struct {
	Ticker       string
	Name         string
	Type         models.AssetType
	Sector       string
	LogoURL      string
	AccountID    uint
	Quantity     float64
	AveragePrice float64
}

type UpdateAssetRequest struct {
	Name    string
	Type    models.AssetType
	Sector  string
	LogoURL string
}

func (s *AssetService) CreateAsset(req CreateAssetRequest) (*models.Asset, error) {
	if req.Ticker == "" {
		return nil, errors.New("ticker is required")
	}
	if req.Name == "" {
		return nil, errors.New("asset name is required")
	}

	req.Ticker = strings.ToUpper(strings.TrimSpace(req.Ticker))
	req.LogoURL = strings.TrimSpace(req.LogoURL)

	// 한국 종목 코드 6자리(2024년부터는 0091P0 처럼 영문이 섞인 코드도 있다)에 거래소 꼬리표가 없으면 .KS
	if isKRCode(req.Ticker) {
		req.Ticker = req.Ticker + ".KS"
	}

	if req.LogoURL == "" {
		req.LogoURL = ResolveAssetLogoURL(req.Ticker)
	}

	var existing models.Asset
	// Unscoped: 소프트삭제된 레코드도 포함해서 검색
	err := s.db.Unscoped().Where("ticker = ?", req.Ticker).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 한국 종목은 같은 코드면 같은 종목 (.KS·.KQ·꼬리표 없음 — 꼬리표만 다른 중복을 만들지 않는다)
		if alts := sameKRCodeTickers(req.Ticker); len(alts) > 0 {
			err = s.db.Unscoped().Where("ticker IN ?", alts).Order("id").First(&existing).Error
			// 꼬리표 없이 저장된 옛 기록은 시세를 못 받으므로 꼬리표를 붙여 둔다 (같은 표기가 없음을 위에서 확인)
			if err == nil && isKRCode(existing.Ticker) {
				if uerr := s.db.Unscoped().Model(&models.Asset{}).Where("id = ?", existing.ID).Update("ticker", req.Ticker).Error; uerr == nil {
					log.Printf("[Asset] %s → %s (거래소 꼬리표를 붙임)", existing.Ticker, req.Ticker)
					existing.Ticker = req.Ticker
				}
			}
		}
	}

	// 소프트삭제된 자산이면 복구
	if err == nil && existing.DeletedAt.Valid {
		if restoreErr := s.db.Unscoped().Model(&existing).Update("deleted_at", nil).Error; restoreErr != nil {
			return nil, fmt.Errorf("failed to restore asset: %w", restoreErr)
		}
		existing.DeletedAt = gorm.DeletedAt{Valid: false}
	}

	// 이미 존재하는 자산인 경우
	if err == nil {
		if existing.LogoURL == "" && req.LogoURL != "" {
			existing.LogoURL = req.LogoURL
			_ = s.db.Model(&models.Asset{}).Where("id = ?", existing.ID).Update("logo_url", req.LogoURL).Error
		}

		// 보유 수량이 있는데 계좌가 선택되지 않은 경우
		if req.Quantity > 0 && req.AccountID == 0 {
			return nil, errors.New("보유 수량을 입력했습니다. 계좌를 선택해주세요")
		}

		// AccountID와 수량이 제공된 경우, 해당 계좌에 Holding 추가
		if req.AccountID > 0 && req.Quantity > 0 {
			// 동일 계좌에 이미 보유 중인지 확인
			var existingHolding models.Holding
			err := s.db.Where("account_id = ? AND asset_id = ?", req.AccountID, existing.ID).First(&existingHolding).Error
			if err == nil {
				return nil, errors.New("이미 해당 계좌에서 이 자산을 보유하고 있습니다")
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("failed to check existing holding: %w", err)
			}

			// 새로운 Holding 생성
			holding := &models.Holding{
				AccountID:    req.AccountID,
				AssetID:      existing.ID,
				Quantity:     req.Quantity,
				AveragePrice: req.AveragePrice,
			}

			if err := s.db.Create(holding).Error; err != nil {
				return nil, fmt.Errorf("failed to create holding: %w", err)
			}
		}

		// 기존 자산 반환
		return &existing, nil
	}

	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("failed to check existing asset: %w", err)
	}

	// 새로운 자산 생성
	if req.Type != models.AssetTypeStock && req.Type != models.AssetTypeETF {
		return nil, errors.New("asset type must be 'Stock' or 'ETF'")
	}

	asset := &models.Asset{
		Ticker:      req.Ticker,
		Name:        req.Name,
		Type:        req.Type,
		Sector:      req.Sector,
		LogoURL:     req.LogoURL,
		LogoChecked: true, // 생성 시점에 로고를 이미 해석함
	}

	// 트랜잭션 시작
	tx := s.db.Begin()
	if tx.Error != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", tx.Error)
	}

	// Asset 생성
	if err := tx.Create(asset).Error; err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("failed to create asset: %w", err)
	}

	// AccountID와 수량이 제공된 경우 Holding도 생성
	if req.AccountID > 0 && req.Quantity > 0 {
		holding := &models.Holding{
			AccountID:    req.AccountID,
			AssetID:      asset.ID,
			Quantity:     req.Quantity,
			AveragePrice: req.AveragePrice,
		}

		if err := tx.Create(holding).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to create holding: %w", err)
		}
	}

	// 트랜잭션 커밋
	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return asset, nil
}

func (s *AssetService) GetAsset(id uint) (*models.Asset, error) {
	var asset models.Asset
	err := s.db.First(&asset, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("asset not found")
		}
		return nil, fmt.Errorf("failed to get asset: %w", err)
	}

	return &asset, nil
}

func (s *AssetService) GetAssetByTicker(ticker string) (*models.Asset, error) {
	var asset models.Asset
	err := s.db.Where("ticker = ?", strings.ToUpper(ticker)).First(&asset).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("asset not found")
		}
		return nil, fmt.Errorf("failed to get asset: %w", err)
	}

	return &asset, nil
}

func (s *AssetService) GetAllAssets() ([]models.Asset, error) {
	var assets []models.Asset
	err := s.db.Preload("Holdings").Order("ticker").Find(&assets).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get assets: %w", err)
	}

	// 로고 해석은 외부 CDN HTTP 호출이라 느리므로, 응답을 막지 않고 백그라운드에서 처리한다.
	// 결과(못 찾은 경우 포함)를 DB에 영속화해 재구동마다 재조회하지 않도록 한다.
	s.resolveMissingLogosAsync(assets)

	return assets, nil
}

// resolveMissingLogosAsync 는 로고가 아직 확인되지 않은 자산의 로고를
// 백그라운드에서 동시(최대 5개)로 해석하고 결과를 영속화한다.
func (s *AssetService) resolveMissingLogosAsync(assets []models.Asset) {
	var targets []models.Asset
	for _, a := range assets {
		if strings.TrimSpace(a.LogoURL) == "" && !a.LogoChecked {
			targets = append(targets, a)
		}
	}
	if len(targets) == 0 {
		return
	}

	go func(targets []models.Asset) {
		sem := make(chan struct{}, 5)
		var wg sync.WaitGroup
		for _, a := range targets {
			wg.Add(1)
			go func(asset models.Asset) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				logoURL := ResolveAssetLogoURL(asset.Ticker)
				updates := map[string]interface{}{"logo_checked": true}
				if logoURL != "" {
					updates["logo_url"] = logoURL
				}
				_ = s.db.Model(&models.Asset{}).Where("id = ?", asset.ID).Updates(updates).Error
			}(a)
		}
		wg.Wait()
	}(targets)
}

func (s *AssetService) GetAssetsBySector(sector string) ([]models.Asset, error) {
	var assets []models.Asset
	err := s.db.Where("sector = ?", sector).Order("ticker").Find(&assets).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get assets by sector: %w", err)
	}

	return assets, nil
}

func (s *AssetService) UpdateAsset(id uint, req UpdateAssetRequest) (*models.Asset, error) {
	var asset models.Asset
	if err := s.db.First(&asset, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("asset not found")
		}
		return nil, fmt.Errorf("failed to find asset: %w", err)
	}

	if req.Name != "" {
		asset.Name = req.Name
	}
	if req.Type != "" {
		if req.Type != models.AssetTypeStock && req.Type != models.AssetTypeETF {
			return nil, errors.New("asset type must be 'Stock' or 'ETF'")
		}
		asset.Type = req.Type
	}
	asset.Sector = req.Sector
	if strings.TrimSpace(req.LogoURL) != "" {
		asset.LogoURL = strings.TrimSpace(req.LogoURL)
	}
	if strings.TrimSpace(asset.LogoURL) == "" {
		asset.LogoURL = ResolveAssetLogoURL(asset.Ticker)
	}

	if err := s.db.Save(&asset).Error; err != nil {
		return nil, fmt.Errorf("failed to update asset: %w", err)
	}

	return &asset, nil
}

// DeleteAsset 은 자산을 소프트 삭제(목록에서 숨김)한다.
// 배당금/거래/실현손익 등 과거 이력은 마스터 행과 함께 보존되며,
// 같은 티커를 다시 추가하면 CreateAsset 이 소프트삭제 행을 복구한다.
// 단, 현재 보유 수량(>0)이 남아있는 종목은 삭제할 수 없다.
func (s *AssetService) DeleteAsset(id uint) error {
	// 활성 보유(수량 > 0) 확인 → 있으면 차단 (현재 포지션 보호)
	var activeHoldingCount int64
	s.db.Model(&models.Holding{}).Where("asset_id = ? AND quantity > 0", id).Count(&activeHoldingCount)
	if activeHoldingCount > 0 {
		return errors.New("보유 수량이 남아있는 종목은 삭제할 수 없습니다. 먼저 매도하거나 보유 내역을 정리해주세요")
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		// 수량 0인 잔여 보유 행 정리 (이력 아님 → 소프트 삭제)
		if err := tx.Where("asset_id = ?", id).Delete(&models.Holding{}).Error; err != nil {
			return fmt.Errorf("failed to clean holdings: %w", err)
		}

		// 자산 소프트 삭제 (배당/거래/실현손익 이력은 보존)
		result := tx.Delete(&models.Asset{}, id)
		if result.Error != nil {
			return fmt.Errorf("failed to delete asset: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			return errors.New("asset not found")
		}
		return nil
	})
}

// isKRCode: 거래소 꼬리표 없는 한국 종목 코드 6자리 (숫자로 시작, 영문 대문자·숫자)
func isKRCode(t string) bool {
	if len(t) != 6 || t[0] < '0' || t[0] > '9' {
		return false
	}
	for _, r := range t {
		if !(r >= '0' && r <= '9') && !(r >= 'A' && r <= 'Z') {
			return false
		}
	}
	return true
}

// sameKRCodeTickers: 한국 종목이면 같은 코드의 다른 표기 (그 티커 자신은 빼고) — 아니면 nil
func sameKRCodeTickers(t string) []string {
	code := strings.TrimSuffix(strings.TrimSuffix(t, ".KS"), ".KQ")
	if code == t && !isKRCode(t) {
		return nil
	}
	if !isKRCode(code) {
		return nil
	}
	var out []string
	for _, c := range []string{code + ".KS", code + ".KQ", code} {
		if c != t {
			out = append(out, c)
		}
	}
	return out
}
