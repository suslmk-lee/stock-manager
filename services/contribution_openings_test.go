package services

import (
	"math"
	"testing"

	"stock-manager/models"
)

// 부담금 배분 고치기에서 시작 잔고: 처음에 한 상품만 넣고 고치기로 나머지를 더해 시작할 수 있다.
// 바뀐 상품만 매수 기록을 다시 만들고, 입금은 하나를 합계로, 회차가 없으면 시작 잔고 날짜도 옮긴다.
func TestContributionEditOpenings(t *testing.T) {
	f := newContribFixture(t)
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.01 }
	openingTxs := func() []models.Transaction {
		var txs []models.Transaction
		f.db.Where("account_id = ? AND notes LIKE ?", f.acc.ID, contribOpeningNote+"%").Order("id").Find(&txs)
		return txs
	}
	deposits := func() []models.CashEntry {
		var es []models.CashEntry
		f.db.Where("account_id = ? AND notes = ?", f.acc.ID, contribOpeningDepositNote).Find(&es)
		return es
	}
	view := func() ContributionPlanView {
		vs, err := f.s.ListPlans()
		if err != nil || len(vs) != 1 {
			t.Fatalf("ListPlans = %v, %v", vs, err)
		}
		return vs[0]
	}

	// 1) 한 상품만 시작 잔고와 함께
	p, err := f.s.CreatePlan(ContributionPlanRequest{AccountID: f.acc.ID, Amount: 520840, MonthDay: 31, AutoFrom: "2026-11-15", StartedOn: "2026-11-14",
		Items: []ContributionItemRequest{{AssetID: f.etf.ID, Weight: 100, OpeningQty: 20, OpeningAvg: 16862}}})
	if err != nil {
		t.Fatal(err)
	}
	firstTx := openingTxs()[0].ID
	if h := f.holding(t, f.etf.ID); !near(h.Quantity, 20) {
		t.Fatalf("ETF 보유 = %v", h.Quantity)
	}
	if v := view(); !near(v.Items[0].OpeningQty, 20) || !near(v.Items[0].OpeningAvg, 16862) {
		t.Fatalf("목록의 시작 잔고 = %+v", v.Items[0])
	}

	// 2) 고치기로 펀드를 더하며 시작 잔고도 — ETF 는 그대로 (매수 기록을 다시 만들지 않는다)
	req := ContributionPlanRequest{Amount: 520840, MonthDay: 31, AutoFrom: "2026-11-15", StartedOn: "2026-11-14", Openings: true,
		Items: []ContributionItemRequest{{AssetID: f.etf.ID, Weight: 50, OpeningQty: 20, OpeningAvg: 16862}, {AssetID: f.fund.ID, Weight: 50, OpeningCost: 1000000, OpeningValue: 1050000}}}
	if _, err := f.s.UpdatePlan(p.ID, req); err != nil {
		t.Fatal(err)
	}
	txs := openingTxs()
	if len(txs) != 2 || txs[0].ID != firstTx {
		t.Fatalf("시작 잔고 매수 = %+v", txs)
	}
	if h := f.holding(t, f.fund.ID); !near(h.Quantity, 1000) {
		t.Fatalf("펀드 좌수 = %v", h.Quantity)
	}
	if nav := f.funds.NavOn(f.fund.ID, "2026-11-14"); !near(nav, 1050) {
		t.Fatalf("펀드 기준가 = %v", nav)
	}
	if ds := deposits(); len(ds) != 1 || !near(ds[0].Amount, 20*16862+1000000) {
		t.Fatalf("시작 잔고 입금 = %+v", ds)
	}
	if v := view(); !near(v.Items[1].OpeningCost, 1000000) || !near(v.Items[1].OpeningValue, 1050000) {
		t.Fatalf("목록의 펀드 시작 잔고 = %+v", v.Items[1])
	}

	// 3) 시작 잔고 없이 부담금만 고치면 시작 잔고는 그대로, 연결도 이어 간다
	if _, err := f.s.UpdatePlan(p.ID, ContributionPlanRequest{Amount: 600000, MonthDay: 31, AutoFrom: "2026-11-15",
		Items: []ContributionItemRequest{{AssetID: f.etf.ID, Weight: 50}, {AssetID: f.fund.ID, Weight: 50}}}); err != nil {
		t.Fatal(err)
	}
	if len(openingTxs()) != 2 || !near(f.holding(t, f.etf.ID).Quantity, 20) {
		t.Fatal("시작 잔고를 건드리지 않아야 한다")
	}
	if v := view(); !near(v.Items[0].OpeningQty, 20) || v.Items[0].OpeningTxID == nil {
		t.Fatalf("연결이 끊겼다: %+v", v.Items[0])
	}

	// 4) ETF 수량을 고치고 자동 기록 시작일도 옮긴다 (회차가 없으니 시작 잔고 날짜도 함께)
	req.Amount = 600000
	req.AutoFrom, req.StartedOn = "2026-11-20", "2026-11-19"
	req.Items[0].OpeningQty, req.Items[0].OpeningAvg = 25, 16800
	if _, err := f.s.UpdatePlan(p.ID, req); err != nil {
		t.Fatal(err)
	}
	txs = openingTxs()
	if len(txs) != 2 {
		t.Fatalf("시작 잔고 매수 = %+v", txs)
	}
	for _, tx := range txs {
		if dayString(tx.Date) != "2026-11-19" {
			t.Fatalf("날짜를 옮겨야 한다: %+v", tx)
		}
	}
	if h := f.holding(t, f.etf.ID); !near(h.Quantity, 25) || !near(h.AveragePrice, 16800) {
		t.Fatalf("ETF 보유 = %+v", h)
	}
	if nav := f.funds.NavOn(f.fund.ID, "2026-11-19"); !near(nav, 1050) {
		t.Fatalf("옮긴 날 펀드 기준가 = %v", nav)
	}
	if ds := deposits(); len(ds) != 1 || !near(ds[0].Amount, 25*16800+1000000) || dayString(ds[0].Date) != "2026-11-19" {
		t.Fatalf("시작 잔고 입금 = %+v", ds)
	}
	if v := view(); v.StartedOn != "2026-11-19" {
		t.Fatalf("시작 잔고 날짜 = %s", v.StartedOn)
	}

	// 5) 연결 전에 만든 계획처럼 연결을 지워도 메모·날짜로 찾아 중복을 만들지 않는다
	f.db.Model(&models.ContributionItem{}).Where("plan_id = ?", p.ID).Update("opening_tx_id", nil)
	f.db.Model(&models.ContributionPlan{}).Where("id = ?", p.ID).Update("opening_deposit_id", nil)
	if _, err := f.s.UpdatePlan(p.ID, req); err != nil {
		t.Fatal(err)
	}
	if len(openingTxs()) != 2 || len(deposits()) != 1 {
		t.Fatalf("옛 계획에서 중복: %d 매수, %d 입금", len(openingTxs()), len(deposits()))
	}

	// 6) 펀드 시작 잔고를 비우면 그 매수를 지운다
	req.Items[1].OpeningCost, req.Items[1].OpeningValue = 0, 0
	if _, err := f.s.UpdatePlan(p.ID, req); err != nil {
		t.Fatal(err)
	}
	if h := f.holding(t, f.fund.ID); h.Quantity > 1e-9 {
		t.Fatalf("펀드 보유가 남았다: %v", h.Quantity)
	}
	if ds := deposits(); len(ds) != 1 || !near(ds[0].Amount, 25*16800) {
		t.Fatalf("시작 잔고 입금 = %+v", ds)
	}
}
