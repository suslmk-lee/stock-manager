package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type cashFixture struct {
	svc *CashService
	db  *gorm.DB
}

func newCashFixture(t *testing.T) *cashFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.Transaction{}, &models.Dividend{}, &models.CashEntry{}); err != nil {
		t.Fatal(err)
	}
	svc := NewCashService(db, nil)
	svc.now = func() time.Time { return time.Date(2026, 11, 12, 3, 0, 0, 0, time.UTC) } // 11/12 12:00 KST
	svc.fxHistory = func() (*PriceHistory, error) {
		return &PriceHistory{Symbol: "KRW=X", Points: []PricePoint{
			{Time: cashDay("2026-11-01").Unix(), Close: 1400},
			{Time: cashDay("2026-11-10").Unix(), Close: 1450},
		}}, nil
	}
	svc.prices = func(ts []string) map[string]float64 {
		out := map[string]float64{}
		for _, t := range ts {
			out[t] = map[string]float64{"SCHD": 28, "NVDA": 170}[t]
		}
		return out
	}
	return &cashFixture{svc: svc, db: db}
}

func cashDay(s string) time.Time {
	d, _ := time.Parse(dateLayout, s)
	return d
}

func cashNear(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func (f *cashFixture) account(t *testing.T, name, settle string) models.Account {
	t.Helper()
	a := models.Account{Name: name, Broker: "테스트", MarketType: models.MarketTypeInternational, Currency: "USD", ForeignSettle: settle}
	if err := f.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	return a
}

func (f *cashFixture) asset(t *testing.T, ticker string) models.Asset {
	t.Helper()
	a := models.Asset{Ticker: ticker, Name: ticker + " Inc", Type: models.AssetTypeStock}
	if err := f.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	return a
}

func (f *cashFixture) tx(t *testing.T, acc, asset uint, typ models.TransactionType, day string, price, qty, fee float64) {
	t.Helper()
	if err := f.db.Create(&models.Transaction{AccountID: acc, AssetID: asset, Type: typ, Date: cashDay(day), Price: price, Quantity: qty, Fee: fee}).Error; err != nil {
		t.Fatal(err)
	}
}

// 달러 계좌: 입금 + 매수(수수료 포함) + 매도(수수료 뺌) + 받은 배당(세후). 예정 배당은 빼고, 흐름마다 잔액이 쌓인다.
func TestCashUSDAccountFlows(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "달러", "USD")
	schd := f.asset(t, "SCHD")
	if _, err := f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "USD", Date: "2026-11-01", Kind: "deposit", Amount: 1000}); err != nil {
		t.Fatal(err)
	}
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeBuy, "2026-11-02", 27, 10, 0.3)
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeSell, "2026-11-05", 28, 2, 0.5)
	f.db.Create(&models.Dividend{AccountID: acc.ID, AssetID: schd.ID, Date: cashDay("2026-11-07"), Amount: 3, Tax: 0.45, Currency: "USD", IsReceived: true})
	f.db.Create(&models.Dividend{AccountID: acc.ID, AssetID: schd.ID, Date: cashDay("2026-11-20"), Amount: 9, Currency: "USD", IsReceived: false})
	f.db.Create(&models.Holding{AccountID: acc.ID, AssetID: schd.ID, Quantity: 8, AveragePrice: 27}) // 거래를 직접 넣어 보유는 따로

	sum, err := f.svc.GetSummary(acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := 1000 - 270.3 + 55.5 + 2.55
	if !cashNear(sum.USD, math.Round(want*100)/100) || sum.KRW != 0 {
		t.Fatalf("balance = %+v, want USD %.2f", sum.CashBalance, want)
	}
	if len(sum.Flows) != 4 || sum.Flows[0].Kind != "dividend" || !cashNear(sum.Flows[0].Balance, want) || sum.Flows[3].Kind != models.CashDeposit {
		t.Fatalf("flows = %+v", sum.Flows)
	}
	// 계좌 총액 = 주식 평가금(8주 × $28 × 1450) + 예수금(× 1450)
	if sum.StockValueKRW == nil || *sum.StockValueKRW != math.Round(8*28*1450) || sum.TotalKRW == nil || math.Abs(*sum.TotalKRW-(8*28*1450+want*1450)) > 1 {
		t.Fatalf("totals = %v %v", sum.StockValueKRW, sum.TotalKRW)
	}
}

// 원화 결제 계좌: 미국 주식 매수·배당이 그날 환율로 원화 예수금에서 빠지고 들어온다
func TestCashKRWSettledAccount(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "카카오페이", "KRW")
	nvda := f.asset(t, "NVDA")
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "KRW", Date: "2026-11-01", Kind: "deposit", Amount: 100000})
	f.tx(t, acc.ID, nvda.ID, models.TransactionTypeBuy, "2026-11-10", 158, 0.004, 0)
	f.db.Create(&models.Dividend{AccountID: acc.ID, AssetID: nvda.ID, Date: cashDay("2026-11-11"), Amount: 0.01, Currency: "USD", IsReceived: true})

	sum, err := f.svc.GetSummary(acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := 100000 - 158*0.004*1450 + 0.01*1450
	if !cashNear(sum.KRW, math.Round(want*100)/100) || sum.USD != 0 {
		t.Fatalf("balance = %+v want KRW %.2f", sum.CashBalance, want)
	}
	buy := sum.Flows[1]
	if buy.Kind != "buy" || buy.Currency != "KRW" || buy.Fx != 1450 || !cashNear(buy.Amount, -916.4) {
		t.Fatalf("buy flow = %+v", buy)
	}
}

// 잔액 맞추기: 계산 잔액과의 차이만큼 조정 기록, 이미 맞으면 기록하지 않음
func TestCashReconcile(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "달러", "USD")
	schd := f.asset(t, "SCHD")
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeBuy, "2026-11-02", 27, 10, 0) // 입금 기록이 없어 −270

	e, err := f.svc.Reconcile(acc.ID, CashReconcileRequest{Currency: "USD", Balance: 512.34})
	if err != nil || e == nil || !cashNear(e.Amount, 782.34) || e.Kind != models.CashAdjust || dayString(e.Date) != "2026-11-12" {
		t.Fatalf("adjust = %+v err %v", e, err)
	}
	if again, err := f.svc.Reconcile(acc.ID, CashReconcileRequest{Currency: "USD", Balance: 512.34}); err != nil || again != nil {
		t.Fatalf("second reconcile = %+v err %v", again, err)
	}
	bals, _, err := f.svc.GetBalances()
	if err != nil || len(bals) != 1 || !cashNear(bals[0].USD, 512.34) || bals[0].LastAdjusted != "2026-11-12" {
		t.Fatalf("balances = %+v err %v", bals, err)
	}
}

// 환전: 원화 −, 달러 + 두 줄이 한 쌍. 하나를 지우면 둘 다 지워진다.
func TestCashExchangeAndDelete(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "달러", "USD")
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "KRW", Date: "2026-11-01", Kind: "deposit", Amount: 200000})
	pair, err := f.svc.CreateExchange(acc.ID, CashExchangeRequest{Date: "2026-11-02", FromCurrency: "KRW", FromAmount: 145000, ToAmount: 100})
	if err != nil || len(pair) != 2 || pair[0].PairID == nil || *pair[0].PairID != pair[1].ID {
		t.Fatalf("pair = %+v err %v", pair, err)
	}
	sum, _ := f.svc.GetSummary(acc.ID)
	if !cashNear(sum.KRW, 55000) || !cashNear(sum.USD, 100) {
		t.Fatalf("after exchange = %+v", sum.CashBalance)
	}
	if err := f.svc.DeleteEntry(pair[1].ID); err != nil {
		t.Fatal(err)
	}
	sum, _ = f.svc.GetSummary(acc.ID)
	if !cashNear(sum.KRW, 200000) || sum.USD != 0 {
		t.Fatalf("after delete = %+v", sum.CashBalance)
	}
}

func TestCashValidation(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "달러", "USD")
	bad := []CashEntryRequest{
		{Currency: "EUR", Kind: "deposit", Amount: 1},
		{Currency: "USD", Kind: "deposit", Amount: 0},
		{Currency: "USD", Kind: "adjust", Amount: 1},
		{Currency: "USD", Kind: "deposit", Amount: 1, Date: "2026/11/01"},
	}
	for i, r := range bad {
		if _, err := f.svc.CreateEntry(acc.ID, r); err == nil {
			t.Fatalf("case %d: want error", i)
		} else if _, ok := err.(*CashInputError); !ok {
			t.Fatalf("case %d: error type %T", i, err)
		}
	}
	if _, err := f.svc.CreateEntry(9999, CashEntryRequest{Currency: "USD", Kind: "deposit", Amount: 1}); err != ErrCashNotFound {
		t.Fatalf("missing account err = %v", err)
	}
	// 출금은 양수로 받아 음수로 저장
	e, err := f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "USD", Kind: "withdraw", Amount: 50})
	if err != nil || e.Amount != -50 {
		t.Fatalf("withdraw = %+v err %v", e, err)
	}
}
