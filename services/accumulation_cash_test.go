package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

// 토스증권식 (원화·외화 따로 + 직접 환전 수수료): 모으기 회차만 달러가 모자라면 모자란 만큼 원화에서
// 정규 시간 밖 우대율(기본 1% × 50% = 0.5%)로 바꾼다. 직접 산 매수는 바꾸지 않는다 (환전은 직접).
func TestCashPlanAutoFx(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "토스증권", models.SettleUSD)
	f.db.Model(&acc).Updates(map[string]any{"fx_spread_pct": 1, "fx_day_disc_pct": 95, "fx_off_disc_pct": 50})
	gpiq := f.asset(t, "GPIQ")
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "KRW", Date: "2026-11-01", Kind: "deposit", Amount: 10000})
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "USD", Date: "2026-11-01", Kind: "deposit", Amount: 1.5})
	plan := uint(7)
	mk := func(day string, qty float64, planID *uint) {
		if err := f.db.Create(&models.Transaction{AccountID: acc.ID, AssetID: gpiq.ID, Type: models.TransactionTypeBuy, Date: cashDay(day), Price: 50, Quantity: qty, PlanID: planID}).Error; err != nil {
			t.Fatal(err)
		}
	}
	mk("2026-11-10", 0.02, &plan) // $1 — 달러로
	mk("2026-11-11", 0.02, &plan) // $1 — 달러 $0.50 + 원화로 $0.50
	mk("2026-11-11", 0.1, nil)    // 직접 산 $5 — 바꾸지 않아 달러 마이너스

	sum, err := f.svc.GetSummary(acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	k := math.Round(0.5 * 1450 * 1.005) // 729
	if !cashNear(sum.KRW, 10000-k) || !cashNear(sum.USD, -5) {
		t.Fatalf("balance = %+v, want KRW %.0f USD -5", sum.CashBalance, 10000-k)
	}
	auto := 0
	for _, fl := range sum.Flows {
		if fl.Kind == "autofx" {
			auto++
			if !cashNear(fl.Fx, 1450*1.005) {
				t.Errorf("autofx fx = %v", fl.Fx)
			}
		}
	}
	if auto != 2 {
		t.Fatalf("autofx lines = %d, want 2", auto)
	}
}

func newTossAccount(t *testing.T, f *accFixture) models.Account {
	t.Helper()
	if err := f.db.AutoMigrate(&models.CashEntry{}, &models.Dividend{}); err != nil {
		t.Fatal(err)
	}
	toss := models.Account{Name: "토스증권", Broker: "토스증권", MarketType: models.MarketTypeInternational, Currency: "USD",
		ForeignSettle: models.SettleUSD, FxSpreadPct: 1, FxDayDiscPct: 95, FxOffDiscPct: 50}
	if err := f.db.Create(&toss).Error; err != nil {
		t.Fatal(err)
	}
	return toss
}

// 토스증권 모으기: 달러가 있으면 달러로, 모자라면 원화에서 0.5% 수수료로 바꿔 사고, 원화까지 모자라면 사지 않는다.
// 같은 계좌의 여러 모으기는 날짜 순으로 같은 예수금을 나눠 쓴다. 입금하면 그다음 회차부터 다시 산다.
func TestAccumulationTossCash(t *testing.T) {
	f := newAccFixture(t)
	toss := newTossAccount(t, f)
	cash := NewCashService(f.db, nil)
	cash.fxHistory = f.svc.fxHistory
	// 잔액 맞추기 뒤부터 확인: 달러 $1.50, 원화 2,200원 ($1.50 남짓 — 1,450 × 1.005 = 1,457.25원/달러)
	if _, err := cash.Reconcile(toss.ID, CashReconcileRequest{Currency: "USD", Balance: 1.5, Date: "2026-11-06"}); err != nil {
		t.Fatal(err)
	}
	if _, err := cash.Reconcile(toss.ID, CashReconcileRequest{Currency: "KRW", Balance: 2200, Date: "2026-11-06"}); err != nil {
		t.Fatal(err)
	}
	gpiq, qqqi := f.asset(t, "GPIQ"), f.asset(t, "QQQI")
	closes := map[string]float64{"2026-11-09": 50, "2026-11-10": 50, "2026-11-11": 50, "2026-11-12": 50}
	f.hist["GPIQ"], f.hist["QQQI"] = usBars("GPIQ", closes), usBars("QQQI", closes)
	var plans []*models.AccumulationPlan
	for _, a := range []models.Asset{gpiq, qqqi} {
		p, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: toss.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD",
			Schedule: "daily", AutoFrom: "2026-11-09"})
		if err != nil {
			t.Fatal(err)
		}
		plans = append(plans, p)
	}

	// 11/11 장 마감 뒤: 11/09 두 회차 (달러 $1 + $0.50, 원화로 $0.50 = 729원) · 11/10 GPIQ (원화로 $1 = 1,457원)
	// 남은 원화 14원으로는 11/10 QQQI 부터 못 산다
	f.now = time.Date(2026, 11, 11, 23, 0, 0, 0, time.UTC)
	res := f.run(t)
	if res.Created != 3 || res.NoCash != 3 {
		t.Fatalf("created %d no_cash %d, want 3 · 3", res.Created, res.NoCash)
	}
	if n := len(f.fills(t, plans[0].ID)); n != 2 {
		t.Fatalf("GPIQ fills = %d, want 2", n)
	}
	if n := len(f.fills(t, plans[1].ID)); n != 1 {
		t.Fatalf("QQQI fills = %d, want 1", n)
	}
	var p0, p1 models.AccumulationPlan
	f.db.First(&p0, plans[0].ID)
	f.db.First(&p1, plans[1].ID)
	if p0.CashShortFrom != "2026-11-11" || p1.CashShortFrom != "2026-11-10" || p1.ProcessedThrough != "2026-11-11" {
		t.Fatalf("short from = %q / %q, processed %q", p0.CashShortFrom, p1.CashShortFrom, p1.ProcessedThrough)
	}
	sum, err := cash.GetSummary(toss.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sum.USD < -0.001 || sum.KRW < 0 {
		t.Fatalf("예수금이 마이너스가 되면 안 된다: %+v", sum.CashBalance)
	}

	// 11/12 원화 입금 → 11/12 두 회차 모두 원화로 바꿔 사고 표시를 지운다
	if _, err := cash.CreateEntry(toss.ID, CashEntryRequest{Currency: "KRW", Date: "2026-11-12", Kind: "deposit", Amount: 10000}); err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 11, 12, 23, 0, 0, 0, time.UTC)
	if res := f.run(t); res.Created != 2 || res.NoCash != 0 {
		t.Fatalf("after deposit created %d no_cash %d", res.Created, res.NoCash)
	}
	f.db.First(&p0, plans[0].ID)
	f.db.First(&p1, plans[1].ID)
	if p0.CashShortFrom != "" || p1.CashShortFrom != "" {
		t.Fatalf("short from not cleared: %q / %q", p0.CashShortFrom, p1.CashShortFrom)
	}
}

// 잔액을 맞춘 적이 없는 토스증권 계좌는 예수금을 믿을 수 없어 예전처럼 확인 없이 기록한다
func TestAccumulationTossCashUnreconciled(t *testing.T) {
	f := newAccFixture(t)
	toss := newTossAccount(t, f)
	a := f.asset(t, "SPYI")
	f.hist["SPYI"] = usBars("SPYI", map[string]float64{"2026-11-09": 50, "2026-11-10": 50})
	if _, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: toss.ID, AssetID: a.ID, Amount: 1, AmountCurrency: "USD", Schedule: "daily", AutoFrom: "2026-11-09"}); err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 11, 10, 23, 0, 0, 0, time.UTC)
	if res := f.run(t); res.Created != 2 || res.NoCash != 0 {
		t.Fatalf("created %d no_cash %d, want 2 · 0", res.Created, res.NoCash)
	}
}

// 메리츠·미래에셋처럼 달러로 사는 계좌(자동 환전 없음): 1,000원 회차를 그날 환율로 바꾼 달러가 모자라면 기록하지 않는다.
// 원화가 있어도 쓰지 않는다. 직접 환전을 기록하면 그다음 회차부터 다시 산다.
func TestAccumulationUSDAccountCash(t *testing.T) {
	f := newAccFixture(t)
	if err := f.db.AutoMigrate(&models.CashEntry{}, &models.Dividend{}); err != nil {
		t.Fatal(err)
	}
	acc := models.Account{Name: "Super365", Broker: "메리츠증권", MarketType: models.MarketTypeInternational, Currency: "USD", ForeignSettle: models.SettleUSD}
	f.db.Create(&acc)
	cash := NewCashService(f.db, nil)
	cash.fxHistory = f.svc.fxHistory
	cash.Reconcile(acc.ID, CashReconcileRequest{Currency: "USD", Balance: 1.2, Date: "2026-11-06"})
	cash.Reconcile(acc.ID, CashReconcileRequest{Currency: "KRW", Balance: 50000, Date: "2026-11-06"})
	schd := f.asset(t, "SCHD")
	f.hist["SCHD"] = usBars("SCHD", map[string]float64{"2026-11-09": 27, "2026-11-10": 27, "2026-11-11": 27})
	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: acc.ID, AssetID: schd.ID, Amount: 1000, AmountCurrency: "KRW", Schedule: "daily", AutoFrom: "2026-11-09"})
	if err != nil {
		t.Fatal(err)
	}
	// 1,000원 ÷ 1,450 = $0.69 → 11/09 산 뒤 $0.51 남아 11/10 부터 못 삼 (원화 5만 원은 쓰지 않음)
	f.now = time.Date(2026, 11, 10, 23, 0, 0, 0, time.UTC)
	if res := f.run(t); res.Created != 1 || res.NoCash != 1 {
		t.Fatalf("created %d no_cash %d, want 1 · 1", res.Created, res.NoCash)
	}
	var p models.AccumulationPlan
	f.db.First(&p, plan.ID)
	if p.CashShortFrom != "2026-11-10" {
		t.Fatalf("short from = %q", p.CashShortFrom)
	}
	// 11/11 원화 → 달러 환전을 기록하면 11/11 회차는 산다
	if _, err := cash.CreateExchange(acc.ID, CashExchangeRequest{Date: "2026-11-11", FromCurrency: "KRW", FromAmount: 14500, ToAmount: 10}); err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 11, 11, 23, 0, 0, 0, time.UTC)
	if res := f.run(t); res.Created != 1 || res.NoCash != 0 {
		t.Fatalf("after exchange created %d no_cash %d", res.Created, res.NoCash)
	}
	f.db.First(&p, plan.ID)
	if p.CashShortFrom != "" {
		t.Fatalf("short from not cleared: %q", p.CashShortFrom)
	}
}

// 미국 주식도 원화로 바로 사는 계좌(카카오페이 원화 모으기 등): 원화가 모자라면 기록하지 않는다
func TestAccumulationKRWSettleCash(t *testing.T) {
	f := newAccFixture(t)
	if err := f.db.AutoMigrate(&models.CashEntry{}, &models.Dividend{}); err != nil {
		t.Fatal(err)
	}
	f.db.Model(&f.acc).Update("foreign_settle", models.SettleKRW)
	cash := NewCashService(f.db, nil)
	cash.fxHistory = f.svc.fxHistory
	cash.Reconcile(f.acc.ID, CashReconcileRequest{Currency: "KRW", Balance: 1500, Date: "2026-11-06"})
	nvda := f.asset(t, "NVDA")
	f.hist["NVDA"] = usBars("NVDA", map[string]float64{"2026-11-09": 180, "2026-11-10": 180})
	if _, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: nvda.ID, Amount: 1000, AmountCurrency: "KRW", QtyStep: 0.001, Schedule: "daily", AutoFrom: "2026-11-09"}); err != nil {
		t.Fatal(err)
	}
	// 0.003주 × $180 × 1,450 = 783원 → 11/09 산 뒤 717원 남아 11/10 은 못 삼
	f.now = time.Date(2026, 11, 10, 23, 0, 0, 0, time.UTC)
	if res := f.run(t); res.Created != 1 || res.NoCash != 1 {
		t.Fatalf("created %d no_cash %d, want 1 · 1", res.Created, res.NoCash)
	}
}
