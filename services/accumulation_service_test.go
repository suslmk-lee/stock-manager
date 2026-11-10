package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type accFixture struct {
	svc  *AccumulationService
	db   *gorm.DB
	now  time.Time
	hist map[string]*PriceHistory
	acc  models.Account
}

func newAccFixture(t *testing.T) *accFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.Transaction{},
		&models.RealizedPnL{}, &models.AccumulationPlan{}); err != nil {
		t.Fatal(err)
	}
	f := &accFixture{db: db, hist: map[string]*PriceHistory{}}
	f.acc = models.Account{Name: "카카오페이", Broker: "카카오페이증권", MarketType: models.MarketTypeInternational, Currency: "KRW"}
	if err := db.Create(&f.acc).Error; err != nil {
		t.Fatal(err)
	}
	f.svc = NewAccumulationService(db, nil)
	f.svc.now = func() time.Time { return f.now }
	f.svc.fetchHistory = func(ticker, _ string) (*PriceHistory, error) { return f.hist[ticker], nil }
	f.svc.histories = func(ts []string) map[string]*PriceHistory {
		out := map[string]*PriceHistory{}
		for _, t := range ts {
			if h := f.hist[t]; h != nil {
				out[t] = h
			}
		}
		return out
	}
	f.svc.fxHistory = func() (*PriceHistory, error) {
		return &PriceHistory{Symbol: "KRW=X", Points: []PricePoint{{Time: accDay("2026-01-02").Unix(), Close: 1450}}}, nil
	}
	return f
}

func accDay(s string) time.Time {
	d, _ := time.Parse(dateLayout, s)
	return d
}

// usBars: 미국 장 (09:30 ET 봉 시각, 서머타임 해제 기간 오프셋)
func usBars(ticker string, closes map[string]float64) *PriceHistory {
	h := &PriceHistory{Symbol: ticker, Currency: "USD", GmtOffset: -5 * 3600}
	for d, c := range closes {
		h.Points = append(h.Points, PricePoint{Time: accDay(d).Add(14*time.Hour + 30*time.Minute).Unix(), Close: c})
	}
	return h
}

func krBars(ticker string, closes map[string]float64) *PriceHistory {
	h := &PriceHistory{Symbol: ticker, Currency: "KRW", GmtOffset: 9 * 3600}
	for d, c := range closes {
		h.Points = append(h.Points, PricePoint{Time: accDay(d).Unix(), Close: c}) // 09:00 KST
	}
	return h
}

func (f *accFixture) asset(t *testing.T, ticker string) models.Asset {
	t.Helper()
	a := models.Asset{Ticker: ticker, Name: ticker, Type: models.AssetTypeStock}
	if err := f.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	return a
}

func (f *accFixture) fills(t *testing.T, planID uint) []models.Transaction {
	t.Helper()
	var txs []models.Transaction
	if err := f.db.Where("plan_id = ?", planID).Order("date").Find(&txs).Error; err != nil {
		t.Fatal(err)
	}
	return txs
}

func (f *accFixture) run(t *testing.T) *AccumulationRunResult {
	t.Helper()
	res, err := f.svc.RunDue()
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Errors) > 0 {
		t.Fatalf("run errors: %v", res.Errors)
	}
	return res
}

func qtyNear(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// 카카오페이식: 1,000원으로 0.001주 단위 최대 수량. 장이 끝난 날만, 다시 돌려도 중복 없음.
func TestAccumulationKakaoStyleDaily(t *testing.T) {
	f := newAccFixture(t)
	nvda := f.asset(t, "NVDA")
	f.hist["NVDA"] = usBars("NVDA", map[string]float64{
		"2026-11-06": 180, "2026-11-09": 180, "2026-11-10": 165, "2026-11-11": 158,
	})
	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{
		AccountID: f.acc.ID, AssetID: nvda.ID, Amount: 1000, AmountCurrency: "KRW", QtyStep: 0.001,
		Schedule: "daily", AutoFrom: "2026-11-09",
	})
	if err != nil {
		t.Fatal(err)
	}

	// 11/11 장(한국 시각 11/12 새벽 마감) 전: 11/09·11/10 만
	f.now = time.Date(2026, 11, 11, 15, 0, 0, 0, time.UTC)
	if res := f.run(t); res.Created != 2 {
		t.Fatalf("created = %d, want 2", res.Created)
	}
	txs := f.fills(t, plan.ID)
	if len(txs) != 2 || !qtyNear(txs[0].Quantity, 0.003) || !qtyNear(txs[1].Quantity, 0.004) || txs[0].Price != 180 {
		t.Fatalf("fills = %+v", txs)
	}
	if res := f.run(t); res.Created != 0 {
		t.Fatalf("second run created %d", res.Created)
	}

	// 마감 뒤: 11/11 추가, 금액은 0.004주 × $158 × 1,450 = 916.4원
	f.now = time.Date(2026, 11, 11, 23, 0, 0, 0, time.UTC)
	if res := f.run(t); res.Created != 1 {
		t.Fatalf("created = %d, want 1", res.Created)
	}
	fills, err := f.svc.GetFills(plan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(fills) != 3 || fills[0].Date != "2026-11-11" || fills[0].Round != 3 || math.Abs(fills[0].Amount-916.4) > 0.01 {
		t.Fatalf("fills = %+v", fills)
	}
	var h models.Holding
	f.db.Where("account_id = ? AND asset_id = ?", f.acc.ID, nvda.ID).First(&h)
	if !qtyNear(h.Quantity, 0.011) {
		t.Fatalf("holding qty = %v", h.Quantity)
	}
}

// 다른 곳(서버/앱)이 이미 기록한 날은 고유 인덱스로 막혀 보유가 두 번 늘지 않는다
func TestAccumulationNoDoubleRecord(t *testing.T) {
	f := newAccFixture(t)
	a := f.asset(t, "SCHD")
	f.hist["SCHD"] = usBars("SCHD", map[string]float64{"2026-11-09": 27, "2026-11-10": 27.5})
	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD", Schedule: "daily", AutoFrom: "2026-11-09"})
	if err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	f.run(t)
	// 처리 기록을 지워 같은 날을 다시 시도하게 만든다 (다른 프로세스가 동시에 돈 상황)
	f.db.Model(&models.AccumulationPlan{}).Where("id = ?", plan.ID).Update("processed_through", "")
	if res := f.run(t); res.Created != 0 {
		t.Fatalf("created = %d on rerun", res.Created)
	}
	var h models.Holding
	f.db.Where("asset_id = ?", a.ID).First(&h)
	want := floorQty(1, 27, 0.000001) + floorQty(1, 27.5, 0.000001)
	if len(f.fills(t, plan.ID)) != 2 || !qtyNear(h.Quantity, want) {
		t.Fatalf("qty = %v want %v", h.Quantity, want)
	}
}

// 매주 목요일 — 목요일(11/26 추수감사절)이 휴장이면 그 주는 건너뛴다 (카카오페이와 같음).
// 시작일 전의 목요일(11/19)은 채우지 않는다.
func TestAccumulationWeeklyHolidaySkip(t *testing.T) {
	f := newAccFixture(t)
	a := f.asset(t, "AMT")
	f.hist["AMT"] = usBars("AMT", map[string]float64{
		"2026-11-19": 200, "2026-11-20": 200, "2026-11-25": 190, "2026-11-27": 195, "2026-11-30": 196, "2026-12-03": 197,
	})
	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD",
		Schedule: "weekly", Weekdays: 1 << 4, AutoFrom: "2026-11-20"})
	if err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 12, 4, 0, 0, 0, 0, time.UTC)
	f.run(t)
	txs := f.fills(t, plan.ID)
	if len(txs) != 1 || dayString(txs[0].Date) != "2026-12-03" {
		t.Fatalf("fills = %+v", txs)
	}
}

// 매월 15일 — 2026-11-15 는 일요일이라 11월은 건너뛰고 12월 15일(화)에 산다
func TestAccumulationMonthlyWeekendSkip(t *testing.T) {
	f := newAccFixture(t)
	a := f.asset(t, "O")
	f.hist["O"] = usBars("O", map[string]float64{"2026-11-13": 57, "2026-11-16": 58, "2026-11-17": 58.5, "2026-12-15": 59})
	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: a.ID, Amount: 10, AmountCurrency: "USD",
		Schedule: "monthly", MonthDay: 15, AutoFrom: "2026-11-01"})
	if err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC)
	f.run(t)
	if txs := f.fills(t, plan.ID); len(txs) != 0 {
		t.Fatalf("weekend month should be skipped: %+v", txs)
	}
	views, _ := f.svc.ListPlans()
	if views[0].NextDate != "2026-12-15" {
		t.Fatalf("next = %s", views[0].NextDate)
	}
	f.now = time.Date(2026, 12, 16, 0, 0, 0, 0, time.UTC)
	f.run(t)
	txs := f.fills(t, plan.ID)
	if len(txs) != 1 || dayString(txs[0].Date) != "2026-12-15" {
		t.Fatalf("fills = %+v", txs)
	}
}

// 수익률 -5% 이하일 때만: 평단 $100 에서 -3% 날은 건너뛰고 -6% 날은 산다
func TestAccumulationReturnCondition(t *testing.T) {
	f := newAccFixture(t)
	a := f.asset(t, "MSFT")
	if err := f.db.Create(&models.Holding{AccountID: f.acc.ID, AssetID: a.ID, Quantity: 10, AveragePrice: 100}).Error; err != nil {
		t.Fatal(err)
	}
	f.hist["MSFT"] = usBars("MSFT", map[string]float64{"2026-11-09": 97, "2026-11-10": 94})
	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD",
		Schedule: "daily", Condition: "return_below", ConditionValue: -5, AutoFrom: "2026-11-09"})
	if err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
	res := f.run(t)
	txs := f.fills(t, plan.ID)
	if res.Skipped != 1 || len(txs) != 1 || dayString(txs[0].Date) != "2026-11-10" {
		t.Fatalf("res = %+v fills = %+v", res, txs)
	}
}

// 1,000원으로 0.001주도 못 사는 고가 종목은 건너뛴다. 한국 장은 15:30 마감 뒤에만 기록한다.
func TestAccumulationBelowMinimumStepAndKRClose(t *testing.T) {
	f := newAccFixture(t)
	hi := f.asset(t, "000660.KS")
	lo := f.asset(t, "005930.KS")
	f.hist["000660.KS"] = krBars("000660.KS", map[string]float64{"2026-11-10": 1_400_000})
	f.hist["005930.KS"] = krBars("005930.KS", map[string]float64{"2026-11-10": 98_000})
	p1, _ := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: hi.ID, Amount: 1000, AmountCurrency: "KRW", QtyStep: 0.001, Schedule: "daily", AutoFrom: "2026-11-10"})
	p2, _ := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: lo.ID, Amount: 1000, AmountCurrency: "KRW", QtyStep: 0.001, Schedule: "daily", AutoFrom: "2026-11-10"})
	// 카카오페이 국내 주식: 0.0001주 단위 → 140만 원짜리를 1,000원으로 0.0007주(980원)
	p3, _ := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: hi.ID, Amount: 1000, AmountCurrency: "KRW", QtyStep: 0.0001, Schedule: "daily", AutoFrom: "2026-11-10"})

	f.now = time.Date(2026, 11, 10, 6, 0, 0, 0, time.UTC) // 15:00 KST, 장중
	if res := f.run(t); res.Created != 0 {
		t.Fatalf("created during session: %d", res.Created)
	}
	f.now = time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC) // 17:00 KST
	res := f.run(t)
	if res.Created != 2 || res.Skipped != 1 || len(f.fills(t, p1.ID)) != 0 {
		t.Fatalf("res = %+v", res)
	}
	if txs := f.fills(t, p2.ID); len(txs) != 1 || !qtyNear(txs[0].Quantity, 0.01) {
		t.Fatalf("fills = %+v", txs)
	}
	if txs := f.fills(t, p3.ID); len(txs) != 1 || !qtyNear(txs[0].Quantity, 0.0007) {
		t.Fatalf("0.0001 step fills = %+v", txs)
	}
}

// 등록할 때 지금까지 모은 것을 보유에 더하고, 목록에 회차·투자금·평가가 합쳐진다.
// 중지했다가 다시 켜면 쉬던 기간은 채우지 않는다.
func TestAccumulationOpeningAndResume(t *testing.T) {
	f := newAccFixture(t)
	a := f.asset(t, "NVDA")
	f.now = time.Date(2026, 11, 11, 6, 0, 0, 0, time.UTC) // 15:00 KST
	f.hist["NVDA"] = usBars("NVDA", map[string]float64{"2026-11-10": 160})
	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{
		AccountID: f.acc.ID, AssetID: a.ID, Amount: 1000, AmountCurrency: "KRW", QtyStep: 0.001,
		Schedule: "daily", Condition: "return_below", ConditionValue: -1,
		OpeningRounds: 22, OpeningAmount: 21343, OpeningQuantity: 0.087, AddOpeningToHoldings: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.AutoFrom != "2026-11-11" || plan.OpeningTxID == nil {
		t.Fatalf("plan = %+v", plan)
	}
	var h models.Holding
	f.db.Where("asset_id = ?", a.ID).First(&h)
	if !qtyNear(h.Quantity, 0.087) || math.Abs(h.AveragePrice-21343/1450.0/0.087) > 1e-6 {
		t.Fatalf("holding = %+v", h)
	}

	views, err := f.svc.ListPlans()
	if err != nil || len(views) != 1 {
		t.Fatal(err, len(views))
	}
	v := views[0]
	wantVal := 0.087 * 160 * 1450
	if v.Rounds != 22 || v.Invested != 21343 || v.Value == nil || math.Abs(*v.Value-wantVal) > 0.01 || v.NextDate != "2026-11-11" {
		t.Fatalf("view = %+v", v)
	}
	if v.HoldingReturnPct == nil || v.ConditionMet == nil || !*v.ConditionMet {
		t.Fatalf("condition view = %+v", v)
	}

	// 지금까지 모은 값을 고치면 보유에 더한 기록도 고쳐진다
	req := AccumulationPlanRequest{Amount: 1000, AmountCurrency: "KRW", QtyStep: 0.001, Schedule: "daily", Condition: "return_below", ConditionValue: -1,
		Status: "paused", OpeningRounds: 22, OpeningAmount: 21343, OpeningQuantity: 0.09}
	if _, err := f.svc.UpdatePlan(plan.ID, req); err != nil {
		t.Fatal(err)
	}
	f.db.Where("asset_id = ?", a.ID).First(&h)
	if !qtyNear(h.Quantity, 0.09) {
		t.Fatalf("holding after edit = %+v", h)
	}

	// 중지 동안은 기록하지 않고, 다시 켜면 그날부터
	f.hist["NVDA"] = usBars("NVDA", map[string]float64{"2026-11-10": 160, "2026-11-11": 150, "2026-11-12": 150, "2026-11-13": 150})
	f.now = time.Date(2026, 11, 13, 1, 0, 0, 0, time.UTC) // 11/13 10:00 KST
	f.run(t)
	if n := len(f.fills(t, plan.ID)); n != 0 {
		t.Fatalf("paused plan recorded %d", n)
	}
	req.Status = "active"
	p, err := f.svc.UpdatePlan(plan.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if p.AutoFrom != "2026-11-13" {
		t.Fatalf("auto_from after resume = %s", p.AutoFrom)
	}
	f.now = time.Date(2026, 11, 13, 23, 0, 0, 0, time.UTC)
	f.run(t)
	if txs := f.fills(t, plan.ID); len(txs) != 1 || dayString(txs[0].Date) != "2026-11-13" {
		t.Fatalf("fills after resume = %+v", txs)
	}
}

// 회차 고치기: 증권사 앱에 보이는 금액·수량으로 바꾸면 종목 통화 단가로 저장된다
func TestAccumulationUpdateAndDeleteFill(t *testing.T) {
	f := newAccFixture(t)
	a := f.asset(t, "NVDA")
	f.hist["NVDA"] = usBars("NVDA", map[string]float64{"2026-11-09": 180, "2026-11-10": 165})
	plan, _ := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1000, AmountCurrency: "KRW", QtyStep: 0.001, Schedule: "daily", AutoFrom: "2026-11-09"})
	f.now = time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)
	f.run(t)
	txs := f.fills(t, plan.ID)
	if err := f.svc.UpdateFill(txs[0].ID, 0.004, 960); err != nil {
		t.Fatal(err)
	}
	fills, _ := f.svc.GetFills(plan.ID)
	last := fills[len(fills)-1]
	if !qtyNear(last.Quantity, 0.004) || math.Abs(last.Amount-960) > 1e-6 {
		t.Fatalf("edited fill = %+v", last)
	}
	if err := f.svc.DeleteFill(txs[1].ID); err != nil {
		t.Fatal(err)
	}
	f.run(t) // 지운 날을 다시 채우지 않는다
	if n := len(f.fills(t, plan.ID)); n != 1 {
		t.Fatalf("fills after delete = %d", n)
	}
}

func TestAccumulationValidation(t *testing.T) {
	f := newAccFixture(t)
	a := f.asset(t, "VOO")
	bad := []AccumulationPlanRequest{
		{AccountID: f.acc.ID, AssetID: a.ID, Amount: 0, AmountCurrency: "USD", Schedule: "daily"},
		{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "EUR", Schedule: "daily"},
		{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD", Schedule: "weekly"},
		{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD", Schedule: "monthly", MonthDay: 32},
		{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD", Schedule: "daily", Condition: "price_below"},
		{AccountID: f.acc.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD", Schedule: "daily", AddOpeningToHoldings: true},
	}
	for i, req := range bad {
		if _, err := f.svc.CreatePlan(req); err == nil {
			t.Fatalf("case %d: expected error", i)
		} else if _, ok := err.(*PlanInputError); !ok {
			t.Fatalf("case %d: error type %T (%v)", i, err, err)
		}
	}
}
