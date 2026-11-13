package main

import (
	"context"
	"fmt"
	"stock-manager/database"
	"stock-manager/httpapi"
	"stock-manager/models"
	"stock-manager/services"
	"stock-manager/updater"
	"time"
)

type App struct {
	ctx                  context.Context
	accountService       *services.AccountService
	assetService         *services.AssetService
	transactionService   *services.TransactionService
	holdingService       *services.HoldingService
	dividendService      *services.DividendService
	tickerService        *services.TickerService
	exchangeRateService  *services.ExchangeRateService
	snapshotService      *services.PortfolioSnapshotService
	realizedPnLService   *services.RealizedPnLService
	signalService        *services.SignalService
	dailySnapService     *services.DailySnapshotService
	accumulationService  *services.AccumulationService
	cashService          *services.CashService
	lockService          *services.LockService // 앱 잠금 (이 PC의 설정 폴더)
	dividendScoreService *services.DividendScoreService
	updater              *updater.Updater
}

// NewApp 은 서비스 인스턴스를 모두 구성한 App 을 반환한다.
// main.go 가 wails.Run 이전에 StartAPIServer 를 고루틴으로 띄우므로,
// 서비스 생성을 startup(=Wails OnStartup)까지 미루면 REST 라우트가 nil 서비스를
// 붙잡게 된다. database.InitDB() 직후 호출되는 이 시점에 함께 생성한다.
func NewApp() *App {
	a := &App{}
	a.accountService = services.NewAccountService()
	a.assetService = services.NewAssetService()
	a.transactionService = services.NewTransactionService()
	a.holdingService = services.NewHoldingService()
	a.dividendService = services.NewDividendService()
	a.tickerService = services.NewTickerService()
	a.exchangeRateService = services.NewExchangeRateService()
	a.snapshotService = services.NewPortfolioSnapshotService(database.GetDB(), a.tickerService)
	a.realizedPnLService = services.NewRealizedPnLService()
	a.signalService = services.NewSignalService(database.GetDB(), a.tickerService, a.exchangeRateService)
	a.dailySnapService = services.NewDailySnapshotService(database.GetDB(), a.tickerService)
	a.accumulationService = services.NewAccumulationService(database.GetDB(), a.tickerService)
	a.cashService = services.NewCashService(database.GetDB(), a.tickerService)
	fundamentals := services.NewFundamentalsService(nil)
	a.signalService.SetFundamentals(fundamentals)
	a.signalService.SetValuation(services.NewValuationService(database.GetDB(), a.tickerService, fundamentals))
	a.dailySnapService.SetFundamentals(fundamentals)
	// 자산 추이(일별·월별)에 예수금을 더한다
	a.dailySnapService.SetCash(a.cashService)
	a.snapshotService.SetCash(a.cashService)
	a.lockService = services.NewLockService(services.DefaultLockDir())
	a.dividendScoreService = services.NewDividendScoreService(database.GetDB(), a.tickerService)
	a.updater = updater.New(appVersion)
	return a
}

// apiServices 는 Wails 바인딩이 쓰는 서비스 인스턴스를 그대로 REST 라우트에 넘긴다.
// (시세 캐시 등 상태를 두 경로가 공유하던 기존 동작을 유지)
func (a *App) apiServices() *httpapi.Services {
	return &httpapi.Services{
		Account:       a.accountService,
		Asset:         a.assetService,
		Transaction:   a.transactionService,
		Holding:       a.holdingService,
		Dividend:      a.dividendService,
		Ticker:        a.tickerService,
		ExchangeRate:  a.exchangeRateService,
		Snapshot:      a.snapshotService,
		RealizedPnL:   a.realizedPnLService,
		Signal:        a.signalService,
		DailySnap:     a.dailySnapService,
		Accumulation:  a.accumulationService,
		Cash:          a.cashService,
		DividendScore: a.dividendScoreService,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// 지난 자동 업데이트(Windows)가 남긴 .old·임시 파일 정리 (실패해도 무시)
	go updater.CleanupOld()

	// 앱 시작 시 이번 달 스냅샷 자동 기록
	a.snapshotService.EnsureCurrentMonthSnapshotAsync()

	// 일별 총자산: 오늘 실측 보장 + 2년 추정 백필, 이후 실행 중에는 몇 시간마다 재확인 (ctx 종료 시 중단)
	a.dailySnapService.EnsureTodayAsync()
	a.dailySnapService.BackfillAsync(services.DefaultBackfillDays)
	go func() {
		t := time.NewTicker(4 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if _, err := a.dailySnapService.EnsureToday("startup"); err != nil {
					fmt.Printf("[DailySnapshot] 주기 점검 오류: %v\n", err)
				}
			}
		}
	}()

	// 주식 모으기: 장이 끝난 거래일의 회차를 지금 한 번, 이후 몇 시간마다 채운다
	go a.accumulationService.RunEvery(ctx, 4*time.Hour)

	// 신호 백그라운드 점검 (ctx 종료 시 중단)
	a.startSignalMonitor(ctx)
}

func (a *App) GetAllAccounts() (interface{}, error) {
	return a.accountService.GetAllAccounts()
}

func (a *App) GetAccount(id uint) (interface{}, error) {
	return a.accountService.GetAccount(id)
}

func (a *App) CreateAccount(name, broker, accountNumber, marketType, currency, description, accountType, foreignSettle string, fxFeePct float64) (interface{}, error) {
	return a.accountService.CreateAccount(services.CreateAccountRequest{
		Name:          name,
		Broker:        broker,
		AccountNumber: accountNumber,
		MarketType:    models.MarketType(marketType),
		Currency:      currency,
		Description:   description,
		AccountType:   models.AccountType(accountType),
		ForeignSettle: foreignSettle,
		FxFeePct:      fxFeePct,
	})
}

func (a *App) UpdateAccount(id uint, name, broker, accountNumber, marketType, currency, description, accountType, foreignSettle string, fxFeePct float64) (interface{}, error) {
	return a.accountService.UpdateAccount(id, services.UpdateAccountRequest{
		Name:          name,
		Broker:        broker,
		AccountNumber: accountNumber,
		MarketType:    models.MarketType(marketType),
		Currency:      currency,
		Description:   description,
		AccountType:   models.AccountType(accountType),
		ForeignSettle: foreignSettle,
		FxFeePct:      &fxFeePct,
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

func (a *App) GetSnapshotsByAsset(assetID uint) (interface{}, error) {
	return a.snapshotService.GetSnapshotsByAsset(assetID)
}

func (a *App) GetMonthlySnapshotByAccount(accountID uint) (interface{}, error) {
	return a.snapshotService.GetMonthlyTotalByAccount(accountID)
}

// GetDailyAssetSeries 일별 총자산 시계열 (range: 1m|3m|6m|1y|2y|all, interval: auto|day|week)
func (a *App) GetDailyAssetSeries(rangeStr string, interval string) (interface{}, error) {
	return a.dailySnapService.GetSeries(rangeStr, interval)
}

// CaptureDailySnapshot 오늘 스냅샷을 수동 캡처하고 백필을 시작한다.
func (a *App) CaptureDailySnapshot() (interface{}, error) {
	snap, err := a.dailySnapService.CaptureToday("manual")
	if err != nil {
		return nil, err
	}
	started := a.dailySnapService.BackfillAsync(services.DefaultBackfillDays)
	return map[string]interface{}{"snapshot": snap, "backfill_started": started}, nil
}

func (a *App) GetMonthlySnapshotSummary(months int) (interface{}, error) {
	return a.snapshotService.GetMonthlySummary(months)
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

// ===== 매매 신호 =====

func (a *App) GetSignalRules() (interface{}, error) {
	return a.signalService.GetSignalRules()
}

func (a *App) SaveDefaultSignalRule(rule models.SignalRule) (interface{}, error) {
	return a.signalService.SaveDefaultRule(rule)
}

func (a *App) SaveAssetSignalRule(assetID uint, rule models.SignalRule) (interface{}, error) {
	return a.signalService.SaveAssetRule(assetID, rule)
}

func (a *App) DeleteAssetSignalRule(assetID uint) error {
	return a.signalService.DeleteAssetRule(assetID)
}

func (a *App) GetSignals() (interface{}, error) {
	return a.signalService.GetSignals()
}

// ===== 전략 프로필 =====

func (a *App) GetSignalProfiles() (interface{}, error) {
	return a.signalService.GetSignalProfiles()
}

func (a *App) CreateSignalProfile(req services.CreateSignalProfileRequest) (interface{}, error) {
	return a.signalService.CreateSignalProfile(req)
}

func (a *App) UpdateSignalProfile(id uint, req services.UpdateSignalProfileRequest) (interface{}, error) {
	return a.signalService.UpdateSignalProfile(id, req)
}

func (a *App) DeleteSignalProfile(id uint) error {
	return a.signalService.DeleteSignalProfile(id)
}

func (a *App) ResetSignalProfile(id uint) (interface{}, error) {
	return a.signalService.ResetSignalProfile(id)
}

func (a *App) AssignSignalProfile(id uint, assetIDs []uint) (interface{}, error) {
	assignments, err := a.signalService.AssignSignalProfile(id, assetIDs)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"assignments": assignments}, nil
}

func (a *App) GetProfileCandidates() (interface{}, error) {
	cands, err := a.signalService.GetProfileCandidates()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"candidates": cands}, nil
}

func (a *App) DismissProfileSuggestion(assetID uint) error {
	return a.signalService.DismissProfileSuggestion(assetID)
}

// ===== 매매 신호 알림 =====

func (a *App) GetSignalEvents(limit int, unreadOnly bool) (interface{}, error) {
	events, unread, err := a.signalService.GetSignalEvents(limit, unreadOnly)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"events": events, "unread_count": unread}, nil
}

func (a *App) MarkSignalEventsRead(ids []uint, all bool) (interface{}, error) {
	unread, err := a.signalService.MarkSignalEventsRead(ids, all)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"unread_count": unread}, nil
}

func (a *App) GetUnreadSignalCount() (interface{}, error) {
	unread, err := a.signalService.GetUnreadSignalCount()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"unread_count": unread}, nil
}

func (a *App) CheckSignals() (interface{}, error) {
	events, unread, err := a.signalService.CheckSignals()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"new_events": events, "unread_count": unread}, nil
}

func (a *App) GetNotificationSettings() (interface{}, error) {
	return a.signalService.GetNotificationSettings()
}

func (a *App) SaveNotificationSettings(s models.NotificationSetting) (interface{}, error) {
	return a.signalService.SaveNotificationSettings(s)
}
