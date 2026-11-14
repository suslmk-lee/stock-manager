package services

import (
	"math"
	"testing"

	"stock-manager/models"
)

// 퇴직연금 현금성자산: 은행 앱 금액에 맞추면 늘어난 차이는 이자, 줄어든 차이는 잔액 맞추기. 따로 산 상품은 추가 매수로 (펀드는 금액만).
func TestContributionCashAndExtraBuy(t *testing.T) {
	f := newContribFixture(t)
	if err := f.db.AutoMigrate(&models.Dividend{}); err != nil { // 예수금 계산이 배당도 본다
		t.Fatal(err)
	}
	cash := NewCashService(f.db, nil)
	cash.now = f.s.now
	f.s.SetCash(cash)
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.01 }

	p, err := f.s.CreatePlan(ContributionPlanRequest{AccountID: f.acc.ID, Amount: 520840, MonthDay: 31, AutoFrom: "2026-11-15", StartedOn: "2026-11-12",
		Items: []ContributionItemRequest{{AssetID: f.etf.ID, Weight: 100, OpeningQty: 20, OpeningAvg: 16862}}})
	if err != nil {
		t.Fatal(err)
	}
	view := func() ContributionPlanView {
		vs, err := f.s.ListPlans()
		if err != nil || len(vs) != 1 {
			t.Fatalf("ListPlans = %v, %v", vs, err)
		}
		return vs[0]
	}
	// 시작 잔고만큼 입금이 있어 현금성자산은 0
	if v := view(); !near(v.Cash, 0) || v.CashSyncedOn != "" {
		t.Fatalf("처음 현금성자산 = %v (%s)", v.Cash, v.CashSyncedOn)
	}

	// 은행 앱 현금성자산 120,000원 · 금리 3.03% — 늘어난 차이는 이자로
	r, err := f.s.SyncCash(p.ID, 120000, "2026-11-12", 3.03)
	if err != nil || r.Kind != models.CashInterest || !near(r.Amount, 120000) {
		t.Fatalf("맞추기 = %+v, %v", r, err)
	}
	v := view()
	if !near(v.Cash, 120000) || !near(v.CashRate, 3.03) || v.CashSyncedOn != "2026-11-12" {
		t.Fatalf("맞춘 뒤 = 현금 %v 금리 %v 맞춘 날 %s", v.Cash, v.CashRate, v.CashSyncedOn)
	}
	// 예수금 화면에서도 '맞춘 날'로 본다 (잔액을 맞추라는 안내가 남지 않게)
	if bs, _, _ := cash.GetBalances(); len(bs) != 1 || bs[0].LastAdjusted != "2026-11-12" {
		t.Fatalf("예수금 맞춘 날 = %+v", bs)
	}
	// 이자가 붙어 120,300 → 300원이 이자, 금리는 그대로(음수)
	if r, _ := f.s.SyncCash(p.ID, 120300, "2026-11-13", -1); r.Kind != models.CashInterest || !near(r.Amount, 300) {
		t.Fatalf("이자 = %+v", r)
	}
	if v := view(); !near(v.CashRate, 3.03) {
		t.Fatalf("금리가 바뀌었다: %v", v.CashRate)
	}

	// 현금성자산으로 펀드 5만 원 · ETF 2주 × 16,000 을 추가 매수 → 배분 밖 펀드도 보이고 현금성자산이 준다
	other, err := f.funds.CreateFund("한국투자TDF알아서2040", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RecordBuy(p.ID, ContributionBuyRequest{AssetID: other.ID, Date: "2026-11-13", Amount: 50000}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.RecordBuy(p.ID, ContributionBuyRequest{AssetID: f.etf.ID, Date: "2026-11-13", Quantity: 2, Price: 16000}); err != nil {
		t.Fatal(err)
	}
	v = view()
	if !near(v.Cash, 120300-50000-32000) {
		t.Fatalf("추가 매수 뒤 현금성자산 = %v", v.Cash)
	}
	if len(v.Others) != 1 || v.Others[0].AssetID != other.ID || !near(v.Others[0].Quantity, 50) || !near(v.Others[0].Cost, 50000) || !v.Others[0].IsFund {
		t.Fatalf("배분 밖 보유 = %+v", v.Others)
	}
	if !near(v.Items[0].Quantity, 22) {
		t.Fatalf("ETF 보유 = %v", v.Items[0].Quantity)
	}

	// 은행 앱이 더 적으면(수수료 등) 잔액 맞추기로
	if r, err := f.s.SyncCash(p.ID, 38000, "2026-11-13", -1); err != nil || r.Kind != models.CashAdjust || !near(r.Amount, -300) {
		t.Fatalf("줄어든 차이 = %+v, %v", r, err)
	}
	if _, err := f.s.SyncCash(p.ID, -1, "2026-11-13", -1); err == nil {
		t.Fatal("음수 금액은 받지 않아야 한다")
	}

	// 잘못된 입력
	if _, err := f.s.RecordBuy(p.ID, ContributionBuyRequest{AssetID: other.ID, Amount: 0}); err == nil {
		t.Fatal("펀드는 금액이 있어야 한다")
	}
	if _, err := f.s.RecordBuy(p.ID, ContributionBuyRequest{AssetID: f.etf.ID, Quantity: 1}); err == nil {
		t.Fatal("ETF 는 체결가가 있어야 한다")
	}
}
