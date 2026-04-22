package services

import (
	"errors"
	"fmt"
	"stock-manager/database"
	"stock-manager/models"

	"gorm.io/gorm"
)

type AccountService struct {
	db *gorm.DB
}

func NewAccountService() *AccountService {
	return &AccountService{
		db: database.GetDB(),
	}
}

type CreateAccountRequest struct {
	Name          string
	Broker        string
	AccountNumber string
	MarketType    models.MarketType
	Currency      string
	Description   string
}

type UpdateAccountRequest struct {
	Name          string
	Broker        string
	AccountNumber string
	MarketType    models.MarketType
	Currency      string
	Description   string
}

func (s *AccountService) CreateAccount(req CreateAccountRequest) (*models.Account, error) {
	if req.Name == "" {
		return nil, errors.New("account name is required")
	}

	if req.Currency == "" {
		if req.MarketType == models.MarketTypeDomestic {
			req.Currency = "KRW"
		} else {
			req.Currency = "USD"
		}
	}

	if req.MarketType == "" {
		req.MarketType = models.MarketTypeDomestic
	}

	account := &models.Account{
		Name:          req.Name,
		Broker:        req.Broker,
		AccountNumber: req.AccountNumber,
		MarketType:    req.MarketType,
		Currency:      req.Currency,
		Description:   req.Description,
	}

	if err := s.db.Create(account).Error; err != nil {
		return nil, fmt.Errorf("failed to create account: %w", err)
	}

	return account, nil
}

func (s *AccountService) GetAccount(id uint) (*models.Account, error) {
	var account models.Account
	err := s.db.Preload("Holdings.Asset").First(&account, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("account not found")
		}
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	return &account, nil
}

func (s *AccountService) GetAllAccounts() ([]models.Account, error) {
	var accounts []models.Account
	err := s.db.Find(&accounts).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get accounts: %w", err)
	}

	return accounts, nil
}

func (s *AccountService) UpdateAccount(id uint, req UpdateAccountRequest) (*models.Account, error) {
	var account models.Account
	if err := s.db.First(&account, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("account not found")
		}
		return nil, fmt.Errorf("failed to find account: %w", err)
	}

	if req.Name != "" {
		account.Name = req.Name
	}
	if req.Broker != "" {
		account.Broker = req.Broker
	}
	if req.AccountNumber != "" {
		account.AccountNumber = req.AccountNumber
	}
	if req.MarketType != "" {
		account.MarketType = req.MarketType
	}
	if req.Currency != "" {
		account.Currency = req.Currency
	}
	account.Description = req.Description

	if err := s.db.Save(&account).Error; err != nil {
		return nil, fmt.Errorf("failed to update account: %w", err)
	}

	return &account, nil
}

func (s *AccountService) DeleteAccount(id uint) error {
	var count int64
	s.db.Model(&models.Holding{}).Where("account_id = ?", id).Count(&count)
	if count > 0 {
		return errors.New("cannot delete account with existing holdings")
	}

	result := s.db.Delete(&models.Account{}, id)
	if result.Error != nil {
		return fmt.Errorf("failed to delete account: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return errors.New("account not found")
	}

	return nil
}
