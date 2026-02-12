package services

import (
	"fmt"
	"stock-manager/database"
	"stock-manager/models"

	"gorm.io/gorm"
)

type HoldingService struct {
	db *gorm.DB
}

func NewHoldingService() *HoldingService {
	return &HoldingService{
		db: database.GetDB(),
	}
}

type HoldingWithDetails struct {
	models.Holding
	AccountName string  `json:"account_name"`
	Ticker      string  `json:"ticker"`
	AssetName   string  `json:"asset_name"`
	AssetType   string  `json:"asset_type"`
	Sector      string  `json:"sector"`
	TotalCost   float64 `json:"total_cost"`
}

func (s *HoldingService) GetHoldingsByAccount(accountID uint) ([]HoldingWithDetails, error) {
	var holdings []models.Holding
	err := s.db.Where("account_id = ?", accountID).
		Preload("Asset").
		Preload("Account").
		Find(&holdings).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get holdings: %w", err)
	}

	return s.enrichHoldings(holdings), nil
}

func (s *HoldingService) GetAllHoldings() ([]HoldingWithDetails, error) {
	var holdings []models.Holding
	err := s.db.Preload("Asset").
		Preload("Account").
		Find(&holdings).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get holdings: %w", err)
	}

	return s.enrichHoldings(holdings), nil
}

func (s *HoldingService) GetHoldingsBySector(sector string) ([]HoldingWithDetails, error) {
	var holdings []models.Holding
	err := s.db.Joins("JOIN assets ON assets.id = holdings.asset_id").
		Where("assets.sector = ?", sector).
		Preload("Asset").
		Preload("Account").
		Find(&holdings).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get holdings by sector: %w", err)
	}

	return s.enrichHoldings(holdings), nil
}

func (s *HoldingService) enrichHoldings(holdings []models.Holding) []HoldingWithDetails {
	result := make([]HoldingWithDetails, len(holdings))
	for i, h := range holdings {
		result[i] = HoldingWithDetails{
			Holding:     h,
			AccountName: h.Account.Name,
			Ticker:      h.Asset.Ticker,
			AssetName:   h.Asset.Name,
			AssetType:   string(h.Asset.Type),
			Sector:      h.Asset.Sector,
			TotalCost:   h.AveragePrice * h.Quantity,
		}
	}
	return result
}

func (s *HoldingService) CalculateTotalValue(holdings []HoldingWithDetails, currentPrices map[string]float64) float64 {
	total := 0.0
	for _, h := range holdings {
		if price, ok := currentPrices[h.Ticker]; ok {
			total += price * h.Quantity
		}
	}
	return total
}

func (s *HoldingService) CalculateTotalCost(holdings []HoldingWithDetails) float64 {
	total := 0.0
	for _, h := range holdings {
		total += h.TotalCost
	}
	return total
}

func (s *HoldingService) GetPortfolioAllocation() (map[string]float64, error) {
	var holdings []models.Holding
	err := s.db.Preload("Asset").Find(&holdings).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get holdings: %w", err)
	}

	allocation := make(map[string]float64)
	totalValue := 0.0

	for _, h := range holdings {
		value := h.AveragePrice * h.Quantity
		allocation[h.Asset.Sector] += value
		totalValue += value
	}

	for sector := range allocation {
		allocation[sector] = (allocation[sector] / totalValue) * 100
	}

	return allocation, nil
}

func (s *HoldingService) CreateHolding(accountID uint, assetID uint, quantity float64, averagePrice float64) (*models.Holding, error) {
	// 동일 계좌에 이미 보유 중인지 확인
	var existingHolding models.Holding
	err := s.db.Where("account_id = ? AND asset_id = ?", accountID, assetID).First(&existingHolding).Error
	if err == nil {
		return nil, fmt.Errorf("이미 해당 계좌에서 이 자산을 보유하고 있습니다")
	}

	holding := &models.Holding{
		AccountID:    accountID,
		AssetID:      assetID,
		Quantity:     quantity,
		AveragePrice: averagePrice,
	}

	if err := s.db.Create(holding).Error; err != nil {
		return nil, fmt.Errorf("failed to create holding: %w", err)
	}

	return holding, nil
}

func (s *HoldingService) UpdateHolding(id uint, quantity float64, averagePrice float64) (*models.Holding, error) {
	var holding models.Holding
	if err := s.db.First(&holding, id).Error; err != nil {
		return nil, fmt.Errorf("holding not found: %w", err)
	}

	holding.Quantity = quantity
	holding.AveragePrice = averagePrice

	if err := s.db.Save(&holding).Error; err != nil {
		return nil, fmt.Errorf("failed to update holding: %w", err)
	}

	return &holding, nil
}

func (s *HoldingService) DeleteHolding(id uint) error {
	result := s.db.Delete(&models.Holding{}, id)
	if result.Error != nil {
		return fmt.Errorf("failed to delete holding: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("holding not found")
	}
	return nil
}
