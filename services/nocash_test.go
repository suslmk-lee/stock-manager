package services

import (
	"testing"
	"time"

	"stock-manager/models"
)

// 예수금 기록 안 함 (토스뱅크 펀드 모으기처럼 투자 대금이 연결 통장에서 빠져나가는 계좌):
// 예수금은 0, 현금 기록은 받지 않고, 모으기 지원금도 예수금에 남기지 않는다 (금액은 계획에 그대로).
func TestNoCashAccount(t *testing.T) {
	f := newAccFixture(t)
	if err := f.db.AutoMigrate(&models.FundPrice{}, &models.CashEntry{}, &models.Dividend{}); err != nil {
		t.Fatal(err)
	}
	bank := models.Account{Name: "토스뱅크", Broker: "토스뱅크", MarketType: models.MarketTypeDomestic, Currency: "KRW", NoCash: true}
	f.db.Create(&bank)
	funds := NewFundService(f.db)
	f.svc.SetFunds(funds)
	fund, err := funds.CreateFund("한국벨류10년투자배당", "")
	if err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 11, 18, 3, 0, 0, 0, time.UTC)
	funds.now = func() time.Time { return f.now }

	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{
		AccountID: bank.ID, AssetID: fund.ID, Amount: 1000, AmountCurrency: "KRW", Schedule: models.PlanScheduleWeekly, Weekdays: 1 << 1,
		StartedOn: "2026-11-14", AutoFrom: "2026-11-19", OpeningRounds: 1, OpeningAmount: 7000, OpeningBonus: 3000, AddOpeningToHoldings: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.OpeningBonus != 3000 || plan.BonusEntryID != nil {
		t.Fatalf("지원금 = %v, 예수금 기록 %v (남기지 않아야 한다)", plan.OpeningBonus, plan.BonusEntryID)
	}

	cash := NewCashService(f.db, nil)
	cash.now = func() time.Time { return f.now }
	sum, err := cash.GetSummary(bank.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sum.KRW != 0 || len(sum.Flows) != 0 {
		t.Fatalf("예수금 = %v, 흐름 %d (0이어야 한다 — 매수 7,000원이 빠지지 않게)", sum.KRW, len(sum.Flows))
	}
	for _, tl := range cash.Timelines() {
		if tl.AccountID == bank.ID {
			t.Fatal("자산 추이에 예수금을 더하면 안 된다")
		}
	}
	if _, err := cash.CreateEntry(bank.ID, CashEntryRequest{Currency: "KRW", Kind: models.CashDeposit, Amount: 1000}); err == nil {
		t.Fatal("예수금 기록 안 하는 계좌에 입금을 받으면 안 된다")
	}
	if _, err := cash.Reconcile(bank.ID, CashReconcileRequest{Currency: "KRW", Balance: 0}); err == nil {
		t.Fatal("잔액 맞추기도 받지 않아야 한다")
	}
}
