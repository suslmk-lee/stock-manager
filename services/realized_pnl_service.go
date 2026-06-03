package services

import (
	"fmt"
	"stock-manager/database"
	"stock-manager/models"

	"gorm.io/gorm"
)

type RealizedPnLService struct {
	db *gorm.DB
}

func NewRealizedPnLService() *RealizedPnLService {
	return &RealizedPnLService{
		db: database.GetDB(),
	}
}

// GetAll - 전체 실현 손익 내역 (최신순)
func (s *RealizedPnLService) GetAll() ([]models.RealizedPnL, error) {
	var list []models.RealizedPnL
	err := s.db.Preload("Account").Preload("Asset", func(db *gorm.DB) *gorm.DB { return db.Unscoped() }).
		Order("date DESC").
		Find(&list).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get realized pnl: %w", err)
	}
	return list, nil
}

// GetByAccount - 계좌별 실현 손익 내역 (최신순)
func (s *RealizedPnLService) GetByAccount(accountID uint) ([]models.RealizedPnL, error) {
	var list []models.RealizedPnL
	err := s.db.Preload("Account").Preload("Asset", func(db *gorm.DB) *gorm.DB { return db.Unscoped() }).
		Where("account_id = ?", accountID).
		Order("date DESC").
		Find(&list).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get realized pnl: %w", err)
	}
	return list, nil
}

// GetByAsset - 종목별 실현 손익 내역
func (s *RealizedPnLService) GetByAsset(assetID uint) ([]models.RealizedPnL, error) {
	var list []models.RealizedPnL
	err := s.db.Preload("Account").Preload("Asset", func(db *gorm.DB) *gorm.DB { return db.Unscoped() }).
		Where("asset_id = ?", assetID).
		Order("date DESC").
		Find(&list).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get realized pnl: %w", err)
	}
	return list, nil
}

// GetSummary - 전체 합계 통계 (통화별)
func (s *RealizedPnLService) GetSummary() (map[string]interface{}, error) {
	var results []struct {
		Currency    string
		TotalProfit float64
		Count       int64
	}

	err := s.db.Model(&models.RealizedPnL{}).
		Select("currency, SUM(profit) as total_profit, COUNT(*) as count").
		Group("currency").
		Find(&results).Error
	if err != nil {
		return nil, err
	}

	byCurrency := make(map[string]interface{})
	for _, r := range results {
		byCurrency[r.Currency] = map[string]interface{}{
			"total_profit": r.TotalProfit,
			"count":        r.Count,
		}
	}

	return map[string]interface{}{
		"by_currency": byCurrency,
	}, nil
}
