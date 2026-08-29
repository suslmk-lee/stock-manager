package httpapi

import (
	"stock-manager/database"
	"stock-manager/services"
)

// Services 는 HTTP 핸들러가 사용하는 서비스 묶음이다.
// 데스크톱(Wails 내장)과 클라우드(Fly.io) 서버가 동일한 라우트 정의를 공유하기 위해,
// 각 실행 환경이 구성한 서비스 인스턴스를 이 구조체로 주입한다.
type Services struct {
	Account      *services.AccountService
	Asset        *services.AssetService
	Transaction  *services.TransactionService
	Holding      *services.HoldingService
	Dividend     *services.DividendService
	Ticker       *services.TickerService
	ExchangeRate *services.ExchangeRateService
	Snapshot     *services.PortfolioSnapshotService
	RealizedPnL  *services.RealizedPnLService
}

// NewServices 는 기본 서비스 묶음을 생성한다.
// database.InitDB() 가 끝난 뒤에 호출해야 한다 (Snapshot 이 DB 핸들을 필요로 함).
func NewServices() *Services {
	ticker := services.NewTickerService()

	return &Services{
		Account:      services.NewAccountService(),
		Asset:        services.NewAssetService(),
		Transaction:  services.NewTransactionService(),
		Holding:      services.NewHoldingService(),
		Dividend:     services.NewDividendService(),
		Ticker:       ticker,
		ExchangeRate: services.NewExchangeRateService(),
		Snapshot:     services.NewPortfolioSnapshotService(database.GetDB(), ticker),
		RealizedPnL:  services.NewRealizedPnLService(),
	}
}
