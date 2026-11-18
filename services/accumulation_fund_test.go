package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

// 토스 펀드 모으기: 첫 투자 지원금 3,000원 + 첫 투자 3,000원 + 11/16(월) 1,000원 = 지금까지 3회 7,000원, 이후 매주 월요일 1,000원.
// 회차는 앱 기준가로 좌수를 세고, 월요일이 공휴일이면 다음 영업일에 산다. 지원금은 예수금에 기타 수입으로.
func TestAccumulationFundWeekly(t *testing.T) {
	f := newAccFixture(t)
	if err := f.db.AutoMigrate(&models.FundPrice{}, &models.CashEntry{}); err != nil {
		t.Fatal(err)
	}
	f.acc = models.Account{Name: "토스증권", Broker: "토스증권", MarketType: models.MarketTypeDomestic, Currency: "KRW"}
	f.db.Create(&f.acc)
	funds := NewFundService(f.db)
	funds.now = func() time.Time { return f.now }
	f.svc.SetFunds(funds)
	fund, err := funds.CreateFund("미래에셋미국S&P500인덱스", "")
	if err != nil {
		t.Fatal(err)
	}
	f.now = time.Date(2026, 11, 18, 3, 0, 0, 0, time.UTC) // 11/18(수) 12:00 KST

	plan, err := f.svc.CreatePlan(AccumulationPlanRequest{
		AccountID: f.acc.ID, AssetID: fund.ID, Amount: 1000, AmountCurrency: "KRW",
		Schedule: models.PlanScheduleWeekly, Weekdays: 1 << 1, Condition: models.PlanConditionReturnBelow, ConditionValue: -5,
		StartedOn: "2026-11-09", AutoFrom: "2026-11-19",
		OpeningRounds: 3, OpeningAmount: 7000, OpeningBonus: 3000, AddOpeningToHoldings: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	// 펀드는 조건 없이 항상, 좌수 단위
	if plan.Condition != models.PlanConditionAlways || plan.QtyStep != contribQtyStep || !qtyNear(plan.OpeningQuantity, 7) {
		t.Fatalf("계획 = %+v", plan)
	}
	var h models.Holding
	f.db.Where("account_id = ? AND asset_id = ?", f.acc.ID, fund.ID).First(&h)
	if !qtyNear(h.Quantity, 7) || math.Abs(h.AveragePrice-1000) > 1e-6 {
		t.Fatalf("보유 = %+v", h)
	}
	var bonus models.CashEntry
	if err := f.db.First(&bonus, *plan.BonusEntryID).Error; err != nil || bonus.Kind != models.CashInterest || bonus.Amount != 3000 || dayString(bonus.Date) != "2026-11-09" {
		t.Fatalf("지원금 = %+v (%v)", bonus, err)
	}

	// 토스 앱 평가금액 7,100원에 맞춤 → 기준가 1,014.29
	f.now = time.Date(2026, 11, 21, 3, 0, 0, 0, time.UTC)
	if _, err := funds.Reconcile(f.acc.ID, fund.ID, 7100, "2026-11-20"); err != nil {
		t.Fatal(err)
	}
	// 영업일: 11/30(월)은 쉬는 날로
	days := map[string]float64{}
	for _, d := range []string{"2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-12-01", "2026-12-02"} {
		days[d] = 30000
	}
	f.hist[fundCalendarTicker] = krBars(fundCalendarTicker, days)
	f.now = time.Date(2026, 12, 2, 12, 0, 0, 0, time.UTC) // 12/2 장 마감 뒤
	f.run(t)
	f.run(t) // 다시 돌려도 그대로

	fills := f.fills(t, plan.ID)
	if len(fills) != 2 || dayString(fills[0].Date) != "2026-11-23" || dayString(fills[1].Date) != "2026-12-01" {
		t.Fatalf("회차 = %+v", fills)
	}
	nav := 7100.0 / 7
	for _, x := range fills {
		if math.Abs(x.Price*x.Quantity-1000) > 1e-6 || math.Abs(x.Quantity-math.Floor(1000/nav/contribQtyStep)*contribQtyStep) > 1e-9 {
			t.Fatalf("회차 금액·좌수 = %+v", x)
		}
	}

	views, err := f.svc.ListPlans()
	if err != nil || len(views) != 1 {
		t.Fatal(views, err)
	}
	v := views[0]
	if !v.IsFund || math.Abs(v.CurrentPrice-nav) > 1e-6 || v.PriceDate != "2026-11-20" || math.Abs(v.Invested-9000) > 1e-6 || v.Rounds != 5 {
		t.Fatalf("목록 = 펀드 %v 기준가 %v (%s) 투자 %v 회차 %d", v.IsFund, v.CurrentPrice, v.PriceDate, v.Invested, v.Rounds)
	}

	// 지원금을 지우면 예수금 기록도 지운다
	if _, err := f.svc.UpdatePlan(plan.ID, AccumulationPlanRequest{Amount: 1000, AmountCurrency: "KRW", Schedule: models.PlanScheduleWeekly, Weekdays: 1 << 1,
		StartedOn: "2026-11-09", AutoFrom: "2026-11-19", OpeningRounds: 3, OpeningAmount: 7000}); err != nil {
		t.Fatal(err)
	}
	var n int64
	f.db.Model(&models.CashEntry{}).Where("kind = ?", models.CashInterest).Count(&n)
	if n != 0 {
		t.Fatalf("지원금 기록이 남았다: %d", n)
	}
	// 펀드는 원화로만
	if _, err := f.svc.CreatePlan(AccumulationPlanRequest{AccountID: f.acc.ID, AssetID: fund.ID, Amount: 1, AmountCurrency: "USD", Schedule: models.PlanScheduleDaily}); err == nil {
		t.Fatal("달러 펀드 모으기는 받지 않아야 한다")
	}
}
