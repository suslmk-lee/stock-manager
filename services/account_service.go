package services

import (
	"errors"
	"fmt"
	"math"
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
	AccountType   models.AccountType
	ForeignSettle string  // "" = 기본(USD)
	FxFeePct      float64 // 자동 환전 수수료(%)
	NoCash        bool    // 예수금 기록 안 함 (투자 대금은 연결 통장에서)
	// 직접 환전 수수료: 기본(%) · 정규 시간 우대(%) · 그 외 우대(%)
	FxSpreadPct  float64
	FxDayDiscPct float64
	FxOffDiscPct float64
}

type UpdateAccountRequest struct {
	Name          string
	Broker        string
	AccountNumber string
	MarketType    models.MarketType
	Currency      string
	Description   string
	AccountType   models.AccountType
	ForeignSettle string   // "" = 그대로
	FxFeePct      *float64 // nil = 그대로
	NoCash        *bool    // nil = 그대로
	// 직접 환전 수수료 (nil = 그대로)
	FxSpreadPct  *float64
	FxDayDiscPct *float64
	FxOffDiscPct *float64
}

// validSettle: 예수금 구성 — 달러 따로(USD) · 원화로 바로(KRW) · 자동 환전(AFX)
func validSettle(v string) bool {
	return v == models.SettleUSD || v == models.SettleKRW || v == models.SettleAutoFX
}

// validFxFee: 자동 환전 수수료는 0~5%
func validFxFee(v float64) bool { return v >= 0 && v <= 5 && !math.IsNaN(v) }

// checkFxRule: 직접 환전 수수료 — 기본 0~5%, 우대율 0~100%
func checkFxRule(spread, day, off float64) error {
	if !validFxFee(spread) {
		return fmt.Errorf("환전 기본 수수료는 0~5%% 사이여야 합니다")
	}
	for _, v := range []float64{day, off} {
		if v < 0 || v > 100 || math.IsNaN(v) {
			return fmt.Errorf("환전 우대율은 0~100%% 사이여야 합니다")
		}
	}
	return nil
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

	if req.AccountType == "" {
		req.AccountType = models.AccountTypeGeneral
	}
	if !req.AccountType.IsValid() {
		return nil, fmt.Errorf("invalid account type: %s", req.AccountType)
	}
	if req.ForeignSettle == "" {
		req.ForeignSettle = "USD"
	}
	if !validSettle(req.ForeignSettle) {
		return nil, fmt.Errorf("invalid foreign settle currency: %s", req.ForeignSettle)
	}
	if !validFxFee(req.FxFeePct) {
		return nil, fmt.Errorf("자동 환전 수수료는 0~5%% 사이여야 합니다")
	}
	if err := checkFxRule(req.FxSpreadPct, req.FxDayDiscPct, req.FxOffDiscPct); err != nil {
		return nil, err
	}

	account := &models.Account{
		Name:          req.Name,
		Broker:        req.Broker,
		AccountNumber: req.AccountNumber,
		MarketType:    req.MarketType,
		Currency:      req.Currency,
		Description:   req.Description,
		AccountType:   req.AccountType,
		ForeignSettle: req.ForeignSettle,
		FxFeePct:      req.FxFeePct,
		NoCash:        req.NoCash,
		FxSpreadPct:   req.FxSpreadPct,
		FxDayDiscPct:  req.FxDayDiscPct,
		FxOffDiscPct:  req.FxOffDiscPct,
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
	if req.AccountType != "" {
		if !req.AccountType.IsValid() {
			return nil, fmt.Errorf("invalid account type: %s", req.AccountType)
		}
		account.AccountType = req.AccountType
	}
	if req.ForeignSettle != "" {
		if !validSettle(req.ForeignSettle) {
			return nil, fmt.Errorf("invalid foreign settle currency: %s", req.ForeignSettle)
		}
		account.ForeignSettle = req.ForeignSettle
	}
	if req.FxFeePct != nil {
		if !validFxFee(*req.FxFeePct) {
			return nil, fmt.Errorf("자동 환전 수수료는 0~5%% 사이여야 합니다")
		}
		account.FxFeePct = *req.FxFeePct
	}
	if req.NoCash != nil {
		account.NoCash = *req.NoCash
	}
	if req.FxSpreadPct != nil || req.FxDayDiscPct != nil || req.FxOffDiscPct != nil {
		spread, day, off := account.FxSpreadPct, account.FxDayDiscPct, account.FxOffDiscPct
		if req.FxSpreadPct != nil {
			spread = *req.FxSpreadPct
		}
		if req.FxDayDiscPct != nil {
			day = *req.FxDayDiscPct
		}
		if req.FxOffDiscPct != nil {
			off = *req.FxOffDiscPct
		}
		if err := checkFxRule(spread, day, off); err != nil {
			return nil, err
		}
		account.FxSpreadPct, account.FxDayDiscPct, account.FxOffDiscPct = spread, day, off
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
