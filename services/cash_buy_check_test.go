package services

import (
	"testing"

	"stock-manager/models"
)

// 매수 기록 전 예수금 확인: 이 매수 몫만큼 모자란 금액 (전부터 마이너스였던 것은 빼고)
func TestBuyShorts(t *testing.T) {
	// 원화 138원 → 10,547원 매수 → −10,409원: 10,409원 모자람
	if s := buyShorts(138, 0, -10409, 0); len(s) != 1 || s[0].Currency != "KRW" || s[0].Short != 10409 || s[0].Balance != 138 {
		t.Fatalf("%+v", s)
	}
	// 이미 −5,000 이던 계좌에서 3,000원 매수: 이 매수 몫 3,000 만
	if s := buyShorts(-5000, 0, -8000, 0); len(s) != 1 || s[0].Short != 3000 {
		t.Fatalf("%+v", s)
	}
	// 달러는 센트 올림, 충분하면 없음
	if s := buyShorts(0, 0.5, 0, -0.701); len(s) != 1 || s[0].Currency != "USD" || s[0].Short != 0.71 {
		t.Fatalf("%+v", s)
	}
	if s := buyShorts(1000, 10, 500, 3); len(s) != 0 {
		t.Fatalf("%+v", s)
	}
}

func TestCheckBuy(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "연금저축", models.SettleUSD)
	kr := f.asset(t, "458730.KS")
	us := f.asset(t, "SCHD")
	// 잔액을 맞추기 전에는 확인하지 않음
	if c, err := f.svc.CheckBuy(acc.ID, BuyCashRequest{AssetID: kr.ID, Date: "2026-11-12", Price: 10000, Quantity: 5}); err != nil || c.Tracked || len(c.Shorts) != 0 {
		t.Fatalf("not reconciled = %+v %v", c, err)
	}
	f.svc.Reconcile(acc.ID, CashReconcileRequest{Currency: "KRW", Balance: 30000, Date: "2026-11-10"})
	f.svc.Reconcile(acc.ID, CashReconcileRequest{Currency: "USD", Balance: 10, Date: "2026-11-10"})
	// 국내 5만 원 (수수료 10원): 원화 3만 → 20,010원 모자람
	c, err := f.svc.CheckBuy(acc.ID, BuyCashRequest{AssetID: kr.ID, Date: "2026-11-12", Price: 10000, Quantity: 5, Fee: 10})
	if err != nil || !c.Tracked || len(c.Shorts) != 1 || c.Shorts[0].Currency != "KRW" || c.Shorts[0].Short != 20010 || c.Shorts[0].Balance != 30000 {
		t.Fatalf("kr = %+v %v", c, err)
	}
	// 미국 $28 (원화·달러 따로 계좌): $10 → $18 모자람 — 원화 3만 원이 그날 환율(1,450)로 $18 를 바꾸기에 충분해 환전 기록을 제안
	c, _ = f.svc.CheckBuy(acc.ID, BuyCashRequest{AssetID: us.ID, Date: "2026-11-12", Price: 28, Quantity: 1})
	if len(c.Shorts) != 1 || c.Shorts[0].Currency != "USD" || c.Shorts[0].Short != 18 || c.Shorts[0].ExchangeKRW != 26100 {
		t.Fatalf("us = %+v", c)
	}
	// 원화로도 모자라면 환전 대신 달러 입금
	c, _ = f.svc.CheckBuy(acc.ID, BuyCashRequest{AssetID: us.ID, Date: "2026-11-12", Price: 28, Quantity: 2})
	if len(c.Shorts) != 1 || c.Shorts[0].Short != 46 || c.Shorts[0].ExchangeKRW != 0 {
		t.Fatalf("us big = %+v", c)
	}
	// 충분하면 없음
	if c, _ = f.svc.CheckBuy(acc.ID, BuyCashRequest{AssetID: kr.ID, Date: "2026-11-12", Price: 10000, Quantity: 2}); len(c.Shorts) != 0 {
		t.Fatalf("enough = %+v", c)
	}
	// 예수금을 기록하지 않는 계좌는 확인하지 않음
	nc := f.account(t, "토스뱅크", models.SettleUSD)
	f.db.Model(&nc).Update("no_cash", true)
	if c, _ = f.svc.CheckBuy(nc.ID, BuyCashRequest{AssetID: kr.ID, Price: 10000, Quantity: 5}); c.Tracked {
		t.Fatalf("no cash = %+v", c)
	}
}
