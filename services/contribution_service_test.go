package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type contribFixture struct {
	s     *ContributionService
	funds *FundService
	db    *gorm.DB
	acc   models.Account
	etf   models.Asset
	fund  *models.Asset
	bars  map[string]float64 // 360750.KS 거래일 종가
}

func newContribFixture(t *testing.T) *contribFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.Transaction{}, &models.RealizedPnL{},
		&models.CashEntry{}, &models.ContributionPlan{}, &models.ContributionItem{}, &models.FundPrice{}); err != nil {
		t.Fatal(err)
	}
	f := &contribFixture{db: db, bars: map[string]float64{"2026-09-25": 21000, "2026-10-26": 21500}}
	f.acc = models.Account{Name: "회사 퇴직연금", Broker: "IBK기업은행", MarketType: models.MarketTypeDomestic, AccountType: models.AccountTypeDC, Currency: "KRW"}
	db.Create(&f.acc)
	f.etf = models.Asset{Ticker: "360750.KS", Name: "TIGER 미국S&P500", Type: models.AssetTypeETF}
	db.Create(&f.etf)
	f.funds = NewFundService(db)
	clock := func() time.Time { return time.Date(2026, 11, 13, 12, 0, 0, 0, kst) }
	f.funds.now = clock
	f.fund, err = f.funds.CreateFund("미래에셋전략배분TDF2045", "K55301BU6139")
	if err != nil {
		t.Fatal(err)
	}
	f.s = NewContributionService(db, nil, f.funds)
	f.s.now = clock
	f.s.getHistory = func(tk, r string) (*PriceHistory, error) {
		h := &PriceHistory{Symbol: tk, Currency: "KRW"}
		for d, c := range f.bars {
			day, _ := parseDay(d)
			h.Points = append(h.Points, PricePoint{Time: day.Add(6 * time.Hour).Unix(), Close: c})
		}
		return h, nil
	}
	return f
}

func (f *contribFixture) holding(t *testing.T, assetID uint) models.Holding {
	t.Helper()
	var h models.Holding
	f.db.Where("account_id = ? AND asset_id = ?", f.acc.ID, assetID).First(&h)
	return h
}

func TestContributionPlanRunsMonthly(t *testing.T) {
	f := newContribFixture(t)
	if f.fund.Ticker != "FUND:K55301BU6139" || f.fund.Type != models.AssetTypeFund || tickerCurrency(f.fund.Ticker) != "KRW" {
		t.Fatalf("펀드 자산 = %+v", f.fund)
	}
	plan, err := f.s.CreatePlan(ContributionPlanRequest{
		AccountID: f.acc.ID, Amount: 300000, MonthDay: 25, StartedOn: "2026-08-31", AutoFrom: "2026-09-01",
		Items: []ContributionItemRequest{
			{AssetID: f.etf.ID, Weight: 40, OpeningQty: 10, OpeningAvg: 20000},
			{AssetID: f.fund.ID, Weight: 60, OpeningCost: 1000000, OpeningValue: 1100000},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	// 시작 잔고: 펀드는 원금 100만 원 = 1,000좌(기준가 1,000), 평가금액 110만 원 → 기준가 1,100
	if h := f.holding(t, f.fund.ID); math.Abs(h.Quantity-1000) > 1e-9 || math.Abs(h.AveragePrice-1000) > 1e-9 {
		t.Fatalf("펀드 시작 잔고 = %+v", h)
	}
	if nav := f.funds.NavOn(f.fund.ID, "2026-09-01"); math.Abs(nav-1100) > 1e-9 {
		t.Fatalf("시작 기준가 = %v", nav)
	}
	// 시작 잔고만큼 그동안의 부담금 입금도 남긴다 (예수금이 마이너스가 되지 않게)
	var opening models.CashEntry
	if err := f.db.Where("account_id = ? AND contrib_plan_id IS NULL AND kind = ?", f.acc.ID, models.CashDeposit).First(&opening).Error; err != nil || opening.Amount != 10*20000+1000000 {
		t.Fatalf("시작 잔고 입금 = %+v err %v", opening, err)
	}

	res, err := f.s.RunDue()
	if err != nil {
		t.Fatal(err)
	}
	// 9/25(금), 10/25(일 — ETF 는 10/26 월요일 종가) 두 회차. 11/25 는 아직
	if res.Rounds != 2 || res.Buys != 4 || res.Pending != 0 || len(res.Errors) != 0 {
		t.Fatalf("run = %+v", res)
	}
	etf := f.holding(t, f.etf.ID)
	if etf.Quantity != 20 { // 10 + 120,000/21,000 → 5주 + 120,000/21,500 → 5주
		t.Fatalf("ETF 수량 = %v", etf.Quantity)
	}
	var etfTx []models.Transaction
	f.db.Where("asset_id = ? AND contrib_plan_id = ?", f.etf.ID, plan.ID).Order("date").Find(&etfTx)
	if len(etfTx) != 2 || dayString(etfTx[1].Date) != "2026-10-26" || etfTx[1].Price != 21500 {
		t.Fatalf("ETF 매수 = %+v", etfTx)
	}
	fund := f.holding(t, f.fund.ID)
	wantUnits := 1000 + 2*math.Floor(180000/1100.0/contribQtyStep)*contribQtyStep
	if math.Abs(fund.Quantity-wantUnits) > 1e-6 {
		t.Fatalf("펀드 좌수 = %v want %v", fund.Quantity, wantUnits)
	}
	var deps []models.CashEntry
	f.db.Where("contrib_plan_id = ?", plan.ID).Find(&deps)
	if len(deps) != 2 || deps[0].Amount != 300000 || deps[0].Kind != models.CashDeposit {
		t.Fatalf("입금 = %+v", deps)
	}

	// 다시 돌려도, 처리 날짜를 지우고 다시 돌려도(다른 곳에서 동시에 돈 경우) 늘지 않는다
	if res, _ := f.s.RunDue(); res.Rounds != 0 || res.Buys != 0 {
		t.Fatalf("두 번째 run = %+v", res)
	}
	f.db.Model(&models.ContributionPlan{}).Where("id = ?", plan.ID).Update("processed_through", "")
	if res, _ := f.s.RunDue(); res.Buys != 0 {
		t.Fatalf("중복 기록 = %+v", res)
	}
	var n int64
	f.db.Model(&models.Transaction{}).Where("contrib_plan_id = ?", plan.ID).Count(&n)
	f.db.Model(&models.CashEntry{}).Where("contrib_plan_id = ?", plan.ID).Count(&n)
	if n != 2 {
		t.Fatalf("입금 수 = %d", n)
	}

	// 회차와 목록
	rounds, err := f.s.GetRounds(plan.ID)
	if err != nil || len(rounds) != 2 || rounds[0].Date != "2026-10-25" || len(rounds[0].Buys) != 2 || rounds[0].Deposit != 300000 {
		t.Fatalf("회차 = %+v err %v", rounds, err)
	}
	views, err := f.s.ListPlans()
	if err != nil || len(views) != 1 || views[0].Rounds != 2 || views[0].Paid != 600000 || views[0].NextDate != "2026-11-25" {
		t.Fatalf("목록 = %+v err %v", views, err)
	}

	// 펀드 평가금액 맞추기 → 기준가, 시세 조회(TickerService)가 펀드 티커에 그 값으로 답한다
	if _, err := f.funds.Reconcile(f.acc.ID, f.fund.ID, 1500000, "2026-11-10"); err != nil {
		t.Fatal(err)
	}
	wantNav := 1500000 / fund.Quantity
	ts := NewTickerService()
	ts.SetLocalPrices(f.funds)
	p := ts.GetCurrentPrices([]string{f.fund.Ticker})[f.fund.Ticker]
	if p == nil || math.Abs(p.Price-wantNav) > 1e-9 || p.Currency != "KRW" {
		t.Fatalf("펀드 현재가 = %+v want %v", p, wantNav)
	}
	h, err := ts.GetPriceHistory(f.fund.Ticker, "1y", "1d")
	if err != nil || len(h.Points) < 3 || math.Abs(h.Points[len(h.Points)-1].Close-wantNav) > 1e-9 {
		t.Fatalf("펀드 이력 = %+v err %v", h, err)
	}
	if ev, err := ts.GetDividendEvents(f.fund.Ticker); err != nil || len(ev) != 0 {
		t.Fatalf("펀드 배당 이벤트는 없어야 한다: %v %v", ev, err)
	}

	// 회차 지우기 → 기록과 보유가 빠지고, 다시 채우지 않는다
	if err := f.s.DeleteRound(plan.ID, "2026-10-25"); err != nil {
		t.Fatal(err)
	}
	if h := f.holding(t, f.etf.ID); h.Quantity != 15 {
		t.Fatalf("회차 지운 뒤 ETF = %v", h.Quantity)
	}
	if res, _ := f.s.RunDue(); res.Buys != 0 {
		t.Fatalf("지운 회차를 다시 채웠다: %+v", res)
	}
}

// ETF 시세가 아직 없으면 그 회차는 기다렸다가 다음에 마저 (펀드·입금은 한 번만)
func TestContributionWaitsForPrice(t *testing.T) {
	f := newContribFixture(t)
	delete(f.bars, "2026-10-26")
	plan, err := f.s.CreatePlan(ContributionPlanRequest{
		AccountID: f.acc.ID, Amount: 100000, MonthDay: 25, AutoFrom: "2026-09-01",
		Items: []ContributionItemRequest{{AssetID: f.etf.ID, Weight: 50}, {AssetID: f.fund.ID, Weight: 50}},
	})
	if err != nil {
		t.Fatal(err)
	}
	res, _ := f.s.RunDue()
	if res.Rounds != 1 || res.Pending != 1 {
		t.Fatalf("run = %+v", res)
	}
	var p models.ContributionPlan
	f.db.First(&p, plan.ID)
	if p.ProcessedThrough != "2026-09-25" {
		t.Fatalf("처리 날짜 = %s", p.ProcessedThrough)
	}
	f.bars["2026-10-26"] = 20000
	res, _ = f.s.RunDue()
	if res.Rounds != 1 || res.Buys != 1 { // ETF 만 새로 (펀드·입금은 지난번에 남김)
		t.Fatalf("다시 run = %+v", res)
	}
	var n int64
	f.db.Model(&models.CashEntry{}).Where("contrib_plan_id = ?", plan.ID).Count(&n)
	if n != 2 {
		t.Fatalf("입금 = %d", n)
	}
}

func TestContributionValidationAndDueDates(t *testing.T) {
	f := newContribFixture(t)
	us := models.Asset{Ticker: "SCHD", Name: "Schwab", Type: models.AssetTypeETF}
	f.db.Create(&us)
	for _, req := range []ContributionPlanRequest{
		{AccountID: f.acc.ID, Amount: 100000, MonthDay: 25, Items: []ContributionItemRequest{{AssetID: f.etf.ID, Weight: 50}, {AssetID: f.fund.ID, Weight: 40}}},
		{AccountID: f.acc.ID, Amount: 100000, MonthDay: 25, Items: []ContributionItemRequest{{AssetID: us.ID, Weight: 100}}},
		{AccountID: f.acc.ID, Amount: 0, MonthDay: 25, Items: []ContributionItemRequest{{AssetID: f.etf.ID, Weight: 100}}},
		{AccountID: f.acc.ID, Amount: 100000, MonthDay: 32, Items: []ContributionItemRequest{{AssetID: f.etf.ID, Weight: 100}}},
	} {
		if _, err := f.s.CreatePlan(req); err == nil {
			t.Fatalf("거절해야 한다: %+v", req)
		}
	}
	if got := dueDates(31, "2026-01-15", "2026-04-30"); len(got) != 4 || got[0] != "2026-01-31" || got[1] != "2026-02-28" || got[3] != "2026-04-30" {
		t.Fatalf("말일 납입 = %v", got)
	}
	if _, err := f.funds.Reconcile(f.acc.ID, f.fund.ID, 1000, "2026-11-10"); err == nil {
		t.Fatal("보유하지 않은 펀드는 맞출 수 없다")
	}
	if _, err := f.funds.Reconcile(f.acc.ID, f.etf.ID, 1000, "2026-11-10"); err == nil {
		t.Fatal("상장 종목은 평가금액을 맞추지 않는다")
	}
}
