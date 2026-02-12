package services

import (
	"errors"
	"fmt"
	"stock-manager/database"
	"stock-manager/models"
	"time"

	"gorm.io/gorm"
)

type TransactionService struct {
	db *gorm.DB
}

func NewTransactionService() *TransactionService {
	return &TransactionService{
		db: database.GetDB(),
	}
}

type CreateTransactionRequest struct {
	AccountID uint
	AssetID   uint
	Type      models.TransactionType
	Date      time.Time
	Price     float64
	Quantity  float64
	Fee       float64
	Notes     string
}

func (s *TransactionService) CreateTransaction(req CreateTransactionRequest) (*models.Transaction, error) {
	if req.Quantity <= 0 {
		return nil, errors.New("quantity must be greater than 0")
	}
	if req.Price <= 0 {
		return nil, errors.New("price must be greater than 0")
	}
	if req.Fee < 0 {
		return nil, errors.New("fee cannot be negative")
	}

	var account models.Account
	if err := s.db.First(&account, req.AccountID).Error; err != nil {
		return nil, fmt.Errorf("account not found: %w", err)
	}

	var asset models.Asset
	if err := s.db.First(&asset, req.AssetID).Error; err != nil {
		return nil, fmt.Errorf("asset not found: %w", err)
	}

	transaction := &models.Transaction{
		AccountID: req.AccountID,
		AssetID:   req.AssetID,
		Type:      req.Type,
		Date:      req.Date,
		Price:     req.Price,
		Quantity:  req.Quantity,
		Fee:       req.Fee,
		Notes:     req.Notes,
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(transaction).Error; err != nil {
			return fmt.Errorf("failed to create transaction: %w", err)
		}

		if err := s.updateHolding(tx, req); err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return transaction, nil
}

func (s *TransactionService) updateHolding(tx *gorm.DB, req CreateTransactionRequest) error {
	var holding models.Holding
	err := tx.Where("account_id = ? AND asset_id = ?", req.AccountID, req.AssetID).First(&holding).Error

	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("failed to query holding: %w", err)
	}

	isNewHolding := errors.Is(err, gorm.ErrRecordNotFound)

	switch req.Type {
	case models.TransactionTypeBuy:
		return s.processBuy(tx, &holding, req, isNewHolding)
	case models.TransactionTypeSell:
		return s.processSell(tx, &holding, req, isNewHolding)
	default:
		return fmt.Errorf("invalid transaction type: %s", req.Type)
	}
}

func (s *TransactionService) processBuy(tx *gorm.DB, holding *models.Holding, req CreateTransactionRequest, isNew bool) error {
	if isNew {
		holding.AccountID = req.AccountID
		holding.AssetID = req.AssetID
		holding.Quantity = req.Quantity
		holding.AveragePrice = (req.Price*req.Quantity + req.Fee) / req.Quantity

		if err := tx.Create(holding).Error; err != nil {
			return fmt.Errorf("failed to create holding: %w", err)
		}
	} else {
		totalCost := holding.AveragePrice * holding.Quantity
		newCost := req.Price*req.Quantity + req.Fee
		newQuantity := holding.Quantity + req.Quantity

		holding.AveragePrice = (totalCost + newCost) / newQuantity
		holding.Quantity = newQuantity

		if err := tx.Save(holding).Error; err != nil {
			return fmt.Errorf("failed to update holding: %w", err)
		}
	}

	return nil
}

func (s *TransactionService) processSell(tx *gorm.DB, holding *models.Holding, req CreateTransactionRequest, isNew bool) error {
	if isNew {
		return errors.New("cannot sell asset that is not held")
	}

	if holding.Quantity < req.Quantity {
		return fmt.Errorf("insufficient quantity: have %.4f, trying to sell %.4f", holding.Quantity, req.Quantity)
	}

	holding.Quantity -= req.Quantity

	if holding.Quantity == 0 {
		if err := tx.Delete(holding).Error; err != nil {
			return fmt.Errorf("failed to delete holding: %w", err)
		}
	} else {
		if err := tx.Save(holding).Error; err != nil {
			return fmt.Errorf("failed to update holding: %w", err)
		}
	}

	return nil
}

func (s *TransactionService) GetTransactionsByAccount(accountID uint) ([]models.Transaction, error) {
	var transactions []models.Transaction
	err := s.db.Where("account_id = ?", accountID).
		Preload("Asset").
		Order("date DESC").
		Find(&transactions).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get transactions: %w", err)
	}

	return transactions, nil
}

func (s *TransactionService) GetTransactionsByAsset(assetID uint) ([]models.Transaction, error) {
	var transactions []models.Transaction
	err := s.db.Where("asset_id = ?", assetID).
		Preload("Account").
		Order("date DESC").
		Find(&transactions).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get transactions: %w", err)
	}

	return transactions, nil
}

func (s *TransactionService) DeleteTransaction(transactionID uint) error {
	return errors.New("transaction deletion requires recalculation of holdings - not implemented for data integrity")
}
