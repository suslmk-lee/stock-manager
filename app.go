package main

import (
	"context"
	"fmt"
	"stock-manager/database"
	"stock-manager/models"
	"stock-manager/services"
	"time"
)

type App struct {
	ctx                 context.Context
	accountService      *services.AccountService
	assetService        *services.AssetService
	transactionService  *services.TransactionService
	holdingService      *services.HoldingService
	dividendService     *services.DividendService
	tickerService       *services.TickerService
	exchangeRateService *services.ExchangeRateService
	snapshotService     *services.PortfolioSnapshotService
	realizedPnLService  *services.RealizedPnLService
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.accountService = services.NewAccountService()
	a.assetService = services.NewAssetService()
	a.transactionService = services.NewTransactionService()
	a.holdingService = services.NewHoldingService()
	a.dividendService = services.NewDividendService()
	a.tickerService = services.NewTickerService()
	a.exchangeRateService = services.NewExchangeRateService()
	a.snapshotService = services.NewPortfolioSnapshotService(database.GetDB(), a.tickerService)
	a.realizedPnLService = services.NewRealizedPnLService()

	// 앱 시작 시 이번 달 스냅샷 자동 기록
	a.snapshotService.EnsureCurrentMonthSnapshotAsync()
}

func (a *App) GetAllAccounts() (interface{}, error) {
	return a.accountService.GetAllAccounts()
}

func (a *App) GetAccount(id uint) (interface{}, error) {
	return a.accountService.GetAccount(id)
}

func (a *App) CreateAccount(name, broker, accountNumber, marketType, currency, description string) (interface{}, error) {
	return a.accountService.CreateAccount(services.CreateAccountRequest{
		Name:          name,
		Broker:        broker,
		AccountNumber: accountNumber,
		MarketType:    models.MarketType(marketType),
		Currency:      currency,
		Description:   description,
	})
}

func (a *App) UpdateAccount(id uint, name, broker, accountNumber, marketType, currency, description string) (interface{}, error) {
	return a.accountService.UpdateAccount(id, services.UpdateAccountRequest{
		Name:          name,
		Broker:        broker,
		AccountNumber: accountNumber,
		MarketType:    models.MarketType(marketType),
		Currency:      currency,
		Description:   description,
	})
}

func (a *App) DeleteAccount(id uint) error {
	return a.accountService.DeleteAccount(id)
}

func (a *App) GetAllAssets() (interface{}, error) {
	return a.assetService.GetAllAssets()
}

func (a *App) GetAssetByTicker(ticker string) (interface{}, error) {
	return a.assetService.GetAssetByTicker(ticker)
}

func (a *App) CreateAsset(ticker, name, assetType, sector string, accountID uint, quantity, averagePrice float64) (interface{}, error) {
	return a.assetService.CreateAsset(services.CreateAssetRequest{
		Ticker:       ticker,
		Name:         name,
		Type:         models.AssetType(assetType),
		Sector:       sector,
		AccountID:    accountID,
		Quantity:     quantity,
		AveragePrice: averagePrice,
	})
}

func (a *App) UpdateAsset(id uint, name, assetType, sector string) (interface{}, error) {
	return a.assetService.UpdateAsset(id, services.UpdateAssetRequest{
		Name:   name,
		Type:   models.AssetType(assetType),
		Sector: sector,
	})
}

func (a *App) DeleteAsset(id uint) error {
	return a.assetService.DeleteAsset(id)
}

func (a *App) GetAllHoldings() (interface{}, error) {
	return a.holdingService.GetAllHoldings()
}

func (a *App) GetHoldingsByAccount(accountID uint) (interface{}, error) {
	return a.holdingService.GetHoldingsByAccount(accountID)
}

func (a *App) GetHoldingsBySector(sector string) (interface{}, error) {
	return a.holdingService.GetHoldingsBySector(sector)
}

func (a *App) CreateTransaction(accountID, assetID uint, txType, date string, price, quantity, fee float64, notes string) (interface{}, error) {
	parsedDate, err := parseDate(date)
	if err != nil {
		return nil, err
	}

	return a.transactionService.CreateTransaction(services.CreateTransactionRequest{
		AccountID: accountID,
		AssetID:   assetID,
		Type:      models.TransactionType(txType),
		Date:      parsedDate,
		Price:     price,
		Quantity:  quantity,
		Fee:       fee,
		Notes:     notes,
	})
}

func (a *App) UpdateTransaction(id uint, txType, date string, price, quantity, fee float64, notes string) (interface{}, error) {
	parsedDate, err := parseDate(date)
	if err != nil {
		return nil, err
	}

	return a.transactionService.UpdateTransaction(id, services.CreateTransactionRequest{
		Type:     models.TransactionType(txType),
		Date:     parsedDate,
		Price:    price,
		Quantity: quantity,
		Fee:      fee,
		Notes:    notes,
	})
}

func (a *App) DeleteTransaction(id uint) error {
	return a.transactionService.DeleteTransaction(id)
}

func (a *App) GetTransactionsByAccount(accountID uint) (interface{}, error) {
	return a.transactionService.GetTransactionsByAccount(accountID)
}

func (a *App) GetTransactionsByAsset(assetID uint) (interface{}, error) {
	return a.transactionService.GetTransactionsByAsset(assetID)
}

func (a *App) CreateDividend(accountID, assetID uint, date string, amount, tax float64, currency string, isReceived bool, notes string) (interface{}, error) {
	parsedDate, err := parseDate(date)
	if err != nil {
		return nil, err
	}

	return a.dividendService.CreateDividend(services.CreateDividendRequest{
		AccountID:  accountID,
		AssetID:    assetID,
		Date:       parsedDate,
		Amount:     amount,
		Currency:   currency,
		Tax:        tax,
		IsReceived: isReceived,
		Notes:      notes,
	})
}

func (a *App) GetDividendsByAccount(accountID uint) (interface{}, error) {
	return a.dividendService.GetDividendsByAccount(accountID)
}

func (a *App) GetAllDividends() (interface{}, error) {
	return a.dividendService.GetAllDividends()
}

func (a *App) GetMonthlyDividends(startDate, endDate string) (interface{}, error) {
	start, err := parseDate(startDate)
	if err != nil {
		return nil, err
	}
	end, err := parseDate(endDate)
	if err != nil {
		return nil, err
	}

	return a.dividendService.GetMonthlyDividends(start, end)
}

func (a *App) GetMonthlyDividendsByAccount(accountID uint, startDate, endDate string) (interface{}, error) {
	start, err := parseDate(startDate)
	if err != nil {
		return nil, err
	}
	end, err := parseDate(endDate)
	if err != nil {
		return nil, err
	}

	return a.dividendService.GetMonthlyDividendsByAccount(accountID, start, end)
}

func (a *App) GetDividendStats() (interface{}, error) {
	return a.dividendService.GetDividendStats()
}

func (a *App) UpdateDividend(id uint, accountID uint, assetID uint, date string, amount float64, tax float64, currency string, isReceived bool, notes string) (interface{}, error) {
	parsedDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		return nil, fmt.Errorf("invalid date format: %w", err)
	}

	req := services.CreateDividendRequest{
		AccountID:  accountID,
		AssetID:    assetID,
		Date:       parsedDate,
		Amount:     amount,
		Tax:        tax,
		Currency:   currency,
		IsReceived: isReceived,
		Notes:      notes,
	}
	return a.dividendService.UpdateDividend(id, req)
}

func (a *App) DeleteDividend(id uint) error {
	return a.dividendService.DeleteDividend(id)
}

func (a *App) GetTickerInfo(ticker string) (interface{}, error) {
	return a.tickerService.GetTickerInfo(ticker)
}

func (a *App) SearchTicker(query string) (interface{}, error) {
	return a.tickerService.SearchTicker(query)
}

func (a *App) GetCurrentPrice(ticker string) (interface{}, error) {
	return a.tickerService.GetCurrentPrice(ticker)
}

// GetCurrentPrices 는 여러 티커의 시세를 동시 5개 제한으로 일괄 조회한다 (5분 캐시 적용).
func (a *App) GetCurrentPrices(tickers []string) (interface{}, error) {
	return a.tickerService.GetCurrentPrices(tickers), nil
}

func (a *App) GetPriceHistory(ticker string, rangeStr string, interval string) (interface{}, error) {
	return a.tickerService.GetPriceHistory(ticker, rangeStr, interval)
}

func (a *App) GetUSDToKRW() (float64, error) {
	return a.exchangeRateService.GetUSDToKRW()
}

func (a *App) ConvertToKRW(amount float64, currency string) (float64, error) {
	return a.exchangeRateService.ConvertToKRW(amount, currency)
}

func (a *App) CreateHolding(accountID uint, assetID uint, quantity float64, averagePrice float64) (interface{}, error) {
	return a.holdingService.CreateHolding(accountID, assetID, quantity, averagePrice)
}

func (a *App) UpdateHolding(id uint, quantity float64, averagePrice float64) (interface{}, error) {
	return a.holdingService.UpdateHolding(id, quantity, averagePrice)
}

func (a *App) DeleteHolding(id uint) error {
	return a.holdingService.DeleteHolding(id)
}

func (a *App) EnsureSnapshot() (bool, error) {
	return a.snapshotService.EnsureCurrentMonthSnapshot()
}

func (a *App) GetSnapshotsByAccount(accountID uint) (interface{}, error) {
	return a.snapshotService.GetSnapshotsByAccount(accountID)
}

func (a *App) GetMonthlySnapshotByAccount(accountID uint) (interface{}, error) {
	return a.snapshotService.GetMonthlyTotalByAccount(accountID)
}

func (a *App) GetAllRealizedPnL() (interface{}, error) {
	return a.realizedPnLService.GetAll()
}

func (a *App) GetRealizedPnLByAccount(accountID uint) (interface{}, error) {
	return a.realizedPnLService.GetByAccount(accountID)
}

func (a *App) GetRealizedPnLByAsset(assetID uint) (interface{}, error) {
	return a.realizedPnLService.GetByAsset(assetID)
}

func (a *App) GetRealizedPnLSummary() (interface{}, error) {
	return a.realizedPnLService.GetSummary()
}
