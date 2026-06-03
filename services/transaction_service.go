package services

import (
	"errors"
	"fmt"
	"stock-manager/database"
	"stock-manager/models"
	"strings"
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

		if err := s.updateHolding(tx, req, transaction, &account); err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return transaction, nil
}

func (s *TransactionService) updateHolding(tx *gorm.DB, req CreateTransactionRequest, transaction *models.Transaction, account *models.Account) error {
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
		return s.processSell(tx, &holding, req, isNewHolding, transaction, account)
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

func (s *TransactionService) processSell(tx *gorm.DB, holding *models.Holding, req CreateTransactionRequest, isNew bool, transaction *models.Transaction, account *models.Account) error {
	if isNew {
		return errors.New("cannot sell asset that is not held")
	}

	if holding.Quantity < req.Quantity {
		return fmt.Errorf("insufficient quantity: have %.4f, trying to sell %.4f", holding.Quantity, req.Quantity)
	}

	// 매도 시점의 평단가 기준으로 실현 손익 계산
	buyAvgPrice := holding.AveragePrice
	grossProfit := (req.Price - buyAvgPrice) * req.Quantity
	profit := grossProfit - req.Fee
	costBasis := buyAvgPrice * req.Quantity
	profitPercent := 0.0
	if costBasis > 0 {
		profitPercent = (profit / costBasis) * 100
	}

	// 티커 기준으로 통화 결정
	currency := "USD"
	if holding.Asset.Ticker != "" {
		t := strings.ToUpper(holding.Asset.Ticker)
		if strings.HasSuffix(t, ".KS") || strings.HasSuffix(t, ".KQ") {
			currency = "KRW"
		}
	} else if account != nil && account.Currency != "" {
		currency = account.Currency
	}

	pnl := &models.RealizedPnL{
		TransactionID: transaction.ID,
		AccountID:     req.AccountID,
		AssetID:       req.AssetID,
		Date:          req.Date,
		Quantity:      req.Quantity,
		BuyAvgPrice:   buyAvgPrice,
		SellPrice:     req.Price,
		Fee:           req.Fee,
		Profit:        profit,
		ProfitPercent: profitPercent,
		Currency:      currency,
		Notes:         req.Notes,
	}
	if err := tx.Create(pnl).Error; err != nil {
		return fmt.Errorf("failed to create realized pnl: %w", err)
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
		// 소프트삭제된 자산도 표시 (과거 거래 내역의 종목명 유지)
		Preload("Asset", func(db *gorm.DB) *gorm.DB { return db.Unscoped() }).
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

// marketCurrency 는 티커(우선)와 계좌 통화로 실현손익 통화를 결정한다.
func marketCurrency(asset models.Asset, account models.Account) string {
	currency := "USD"
	if asset.Ticker != "" {
		t := strings.ToUpper(asset.Ticker)
		if strings.HasSuffix(t, ".KS") || strings.HasSuffix(t, ".KQ") {
			currency = "KRW"
		}
	} else if account.Currency != "" {
		currency = account.Currency
	}
	return currency
}

// reverseTxEffect 는 현재 (qty, totalCost) 에서 거래 1건의 효과를 되돌린다.
// 보유가 거래 없이 직접 시드된 경우에도 안전하도록, 매도는 실현손익에 저장된
// BuyAvgPrice 를 사용해 0부터 재생하지 않고 현재 상태에서 증분으로 보정한다.
func (s *TransactionService) reverseTxEffect(tx *gorm.DB, txn *models.Transaction, qty, totalCost float64) (float64, float64, error) {
	switch txn.Type {
	case models.TransactionTypeBuy:
		qty -= txn.Quantity
		totalCost -= txn.Price*txn.Quantity + txn.Fee
	case models.TransactionTypeSell:
		// 매도 시 사용했던 평단가(BuyAvgPrice)로 되돌린다.
		var pnl models.RealizedPnL
		buyAvg := 0.0
		if err := tx.Where("transaction_id = ?", txn.ID).First(&pnl).Error; err == nil {
			buyAvg = pnl.BuyAvgPrice
		}
		qty += txn.Quantity
		totalCost += buyAvg * txn.Quantity
		// 기존 실현손익 하드 삭제 (uniqueIndex + soft delete 충돌 방지)
		if err := tx.Unscoped().Where("transaction_id = ?", txn.ID).Delete(&models.RealizedPnL{}).Error; err != nil {
			return 0, 0, fmt.Errorf("failed to clear realized pnl: %w", err)
		}
	}
	if qty < 0 {
		qty = 0
	}
	if totalCost < 0 {
		totalCost = 0
	}
	return qty, totalCost, nil
}

// persistHolding 은 최종 (qty, totalCost) 로 보유를 갱신/생성/삭제한다.
func (s *TransactionService) persistHolding(tx *gorm.DB, accountID, assetID uint, qty, totalCost float64) error {
	var holding models.Holding
	hErr := tx.Where("account_id = ? AND asset_id = ?", accountID, assetID).First(&holding).Error
	hasHolding := hErr == nil
	if hErr != nil && !errors.Is(hErr, gorm.ErrRecordNotFound) {
		return fmt.Errorf("failed to query holding: %w", hErr)
	}

	if qty <= 1e-9 {
		if hasHolding {
			if err := tx.Delete(&holding).Error; err != nil {
				return fmt.Errorf("failed to delete holding: %w", err)
			}
		}
		return nil
	}

	avg := totalCost / qty
	if avg < 0 {
		avg = 0
	}
	if hasHolding {
		holding.Quantity = qty
		holding.AveragePrice = avg
		if err := tx.Save(&holding).Error; err != nil {
			return fmt.Errorf("failed to update holding: %w", err)
		}
		return nil
	}
	holding = models.Holding{AccountID: accountID, AssetID: assetID, Quantity: qty, AveragePrice: avg}
	if err := tx.Create(&holding).Error; err != nil {
		return fmt.Errorf("failed to create holding: %w", err)
	}
	return nil
}

// UpdateTransaction 은 거래 내용을 수정하고 보유/실현손익을 증분 보정한다.
// 계좌/자산은 변경할 수 없으며, 잘못 입력한 경우 삭제 후 재등록한다.
func (s *TransactionService) UpdateTransaction(id uint, req CreateTransactionRequest) (*models.Transaction, error) {
	if req.Quantity <= 0 {
		return nil, errors.New("quantity must be greater than 0")
	}
	if req.Price <= 0 {
		return nil, errors.New("price must be greater than 0")
	}
	if req.Fee < 0 {
		return nil, errors.New("fee cannot be negative")
	}

	var existing models.Transaction
	if err := s.db.First(&existing, id).Error; err != nil {
		return nil, fmt.Errorf("transaction not found: %w", err)
	}

	err := s.db.Transaction(func(tx *gorm.DB) error {
		var account models.Account
		if err := tx.First(&account, existing.AccountID).Error; err != nil {
			return fmt.Errorf("account not found: %w", err)
		}
		var asset models.Asset
		if err := tx.First(&asset, existing.AssetID).Error; err != nil {
			return fmt.Errorf("asset not found: %w", err)
		}

		// 현재 보유 상태
		var holding models.Holding
		hErr := tx.Where("account_id = ? AND asset_id = ?", existing.AccountID, existing.AssetID).First(&holding).Error
		if hErr != nil && !errors.Is(hErr, gorm.ErrRecordNotFound) {
			return fmt.Errorf("failed to query holding: %w", hErr)
		}
		qty := holding.Quantity
		totalCost := holding.AveragePrice * holding.Quantity

		// 1) 기존 거래 효과 되돌리기
		qty, totalCost, err := s.reverseTxEffect(tx, &existing, qty, totalCost)
		if err != nil {
			return err
		}
		baseAvg := 0.0
		if qty > 0 {
			baseAvg = totalCost / qty
		}

		// 2) 거래 내용 갱신
		existing.Type = req.Type
		existing.Date = req.Date
		existing.Price = req.Price
		existing.Quantity = req.Quantity
		existing.Fee = req.Fee
		existing.Notes = req.Notes
		if err := tx.Save(&existing).Error; err != nil {
			return fmt.Errorf("failed to update transaction: %w", err)
		}

		// 3) 새 거래 효과 적용
		if err := s.applyTxEffect(tx, &existing, &qty, &totalCost, baseAvg, marketCurrency(asset, account)); err != nil {
			return err
		}

		return s.persistHolding(tx, existing.AccountID, existing.AssetID, qty, totalCost)
	})
	if err != nil {
		return nil, err
	}
	return &existing, nil
}

// applyTxEffect 는 (qty, totalCost) 에 거래 1건의 효과를 적용하고,
// 매도면 실현손익 행을 생성한다. baseAvg 는 매도 시점 평단가(현재 평단가)이다.
func (s *TransactionService) applyTxEffect(tx *gorm.DB, txn *models.Transaction, qty, totalCost *float64, baseAvg float64, currency string) error {
	switch txn.Type {
	case models.TransactionTypeBuy:
		*qty += txn.Quantity
		*totalCost += txn.Price*txn.Quantity + txn.Fee
	case models.TransactionTypeSell:
		if txn.Quantity > *qty+1e-9 {
			return fmt.Errorf("매도 수량(%.4f)이 보유 수량(%.4f)을 초과합니다", txn.Quantity, *qty)
		}
		profit := (txn.Price-baseAvg)*txn.Quantity - txn.Fee
		costBasis := baseAvg * txn.Quantity
		profitPercent := 0.0
		if costBasis > 0 {
			profitPercent = (profit / costBasis) * 100
		}
		pnl := &models.RealizedPnL{
			TransactionID: txn.ID,
			AccountID:     txn.AccountID,
			AssetID:       txn.AssetID,
			Date:          txn.Date,
			Quantity:      txn.Quantity,
			BuyAvgPrice:   baseAvg,
			SellPrice:     txn.Price,
			Fee:           txn.Fee,
			Profit:        profit,
			ProfitPercent: profitPercent,
			Currency:      currency,
			Notes:         txn.Notes,
		}
		if err := tx.Create(pnl).Error; err != nil {
			return fmt.Errorf("failed to create realized pnl: %w", err)
		}
		*qty -= txn.Quantity
		*totalCost -= baseAvg * txn.Quantity
	}
	if *qty < 0 {
		*qty = 0
	}
	if *totalCost < 0 {
		*totalCost = 0
	}
	return nil
}

// DeleteTransaction 은 거래를 삭제하고 보유/실현손익을 증분 보정한다.
func (s *TransactionService) DeleteTransaction(transactionID uint) error {
	var existing models.Transaction
	if err := s.db.First(&existing, transactionID).Error; err != nil {
		return fmt.Errorf("transaction not found: %w", err)
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		var holding models.Holding
		hErr := tx.Where("account_id = ? AND asset_id = ?", existing.AccountID, existing.AssetID).First(&holding).Error
		if hErr != nil && !errors.Is(hErr, gorm.ErrRecordNotFound) {
			return fmt.Errorf("failed to query holding: %w", hErr)
		}
		qty := holding.Quantity
		totalCost := holding.AveragePrice * holding.Quantity

		qty, totalCost, err := s.reverseTxEffect(tx, &existing, qty, totalCost)
		if err != nil {
			return err
		}

		if err := tx.Delete(&existing).Error; err != nil {
			return fmt.Errorf("failed to delete transaction: %w", err)
		}

		return s.persistHolding(tx, existing.AccountID, existing.AssetID, qty, totalCost)
	})
}
