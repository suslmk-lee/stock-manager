package services

import (
	"errors"
	"fmt"
	"stock-manager/database"
	"stock-manager/models"
	"strings"

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
	AccountID    uint
	Quantity     float64
	AveragePrice float64
}

type UpdateAssetRequest struct {
	Name   string
	Type   models.AssetType
	Sector string
}

func (s *AssetService) CreateAsset(req CreateAssetRequest) (*models.Asset, error) {
	// 디버깅: 받은 요청 로그
	fmt.Printf("CreateAsset called with: Ticker=%s, Name=%s, AccountID=%d, Quantity=%f\n",
		req.Ticker, req.Name, req.AccountID, req.Quantity)

	if req.Ticker == "" {
		return nil, errors.New("ticker is required")
	}
	if req.Name == "" {
		return nil, errors.New("asset name is required")
	}

	req.Ticker = strings.ToUpper(req.Ticker)

	// 한국 티커 자동 감지 (숫자 6자리이고 .KS/.KQ가 없는 경우)
	if len(req.Ticker) == 6 && strings.IndexFunc(req.Ticker, func(r rune) bool {
		return r < '0' || r > '9'
	}) == -1 {
		// 숫자 6자리인 경우 .KS 추가
		if !strings.HasSuffix(req.Ticker, ".KS") && !strings.HasSuffix(req.Ticker, ".KQ") {
			req.Ticker = req.Ticker + ".KS"
		}
	}

	var existing models.Asset
	err := s.db.Where("ticker = ?", req.Ticker).First(&existing).Error

	// 이미 존재하는 자산인 경우
	if err == nil {
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
		Ticker: req.Ticker,
		Name:   req.Name,
		Type:   req.Type,
		Sector: req.Sector,
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

	return assets, nil
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

	if err := s.db.Save(&asset).Error; err != nil {
		return nil, fmt.Errorf("failed to update asset: %w", err)
	}

	return &asset, nil
}

func (s *AssetService) DeleteAsset(id uint) error {
	// 보유 내역 확인
	var holdingCount int64
	s.db.Model(&models.Holding{}).Where("asset_id = ?", id).Count(&holdingCount)
	if holdingCount > 0 {
		return errors.New("이 자산에 대한 보유 내역이 있습니다. 먼저 모든 보유 내역을 삭제해주세요")
	}

	// 배당금 기록 확인
	var dividendCount int64
	s.db.Model(&models.Dividend{}).Where("asset_id = ?", id).Count(&dividendCount)
	if dividendCount > 0 {
		return errors.New("이 자산에 대한 배당금 기록이 있습니다. 먼저 모든 배당금 기록을 삭제해주세요")
	}

	// 거래 내역 확인
	var transactionCount int64
	s.db.Model(&models.Transaction{}).Where("asset_id = ?", id).Count(&transactionCount)
	if transactionCount > 0 {
		return errors.New("이 자산에 대한 거래 내역이 있습니다. 먼저 모든 거래 내역을 삭제해주세요")
	}

	result := s.db.Delete(&models.Asset{}, id)
	if result.Error != nil {
		return fmt.Errorf("failed to delete asset: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return errors.New("asset not found")
	}

	return nil
}
