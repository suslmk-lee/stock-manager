package services

import (
	"math"
	"strings"
	"testing"
	"time"

	"stock-manager/models"
)

// 미래에셋 소수점 모으기처럼 한 회차 배당을 온주·소수점으로 나눠 (같은 날, 세금도 각각) 받는 계좌
func TestHoldingChecksSplitPayments(t *testing.T) {
	now := dsDay("2026-11-13").Add(12 * time.Hour)
	type round struct {
		ex, paid string
		dps      float64
	}
	rounds := []round{{"2026-07-01", "2026-07-06", 0.637}, {"2026-08-03", "2026-08-06", 0.705}, {"2026-09-01", "2026-09-04", 0.683}, {"2026-10-01", "2026-10-06", 0.567}, {"2026-11-02", "2026-11-04", 0.540}}
	var market []DividendEvent
	for _, r := range rounds {
		market = append(market, DividendEvent{Time: dsDay(r.ex).Unix(), Amount: r.dps})
	}
	acc := models.Account{ID: 1, Name: "종합", Broker: "미래에셋증권", AccountType: models.AccountTypeGeneral}
	build := func(skip func(i int, part string) bool) *divScoreAsset {
		var recs []models.Dividend
		id := uint(0)
		for i, r := range rounds {
			for _, part := range []struct {
				name string
				qty  float64
			}{{"온주", 12}, {"소수점", 0.73}} {
				if skip != nil && skip(i, part.name) {
					continue
				}
				id++
				recs = append(recs, models.Dividend{ID: id, AccountID: 1, Date: dsDay(r.paid), Amount: math.Round(part.qty*r.dps*0.85*100) / 100, Currency: "USD", IsReceived: true, Notes: part.name, CreatedAt: now.Add(-72 * time.Hour)})
			}
		}
		return &divScoreAsset{
			asset:   models.Asset{ID: 7, Ticker: "JEPQ", Name: "JEPQ"},
			qtyAt:   QuantityAtFunc(map[uint]float64{1: 12.73}, []AcctTxn{{AccountID: 1, Type: models.TransactionTypeBuy, Date: dsDay("2026-06-02"), Quantity: 12.73}}),
			acctIDs: []uint{1},
			market:  market,
			records: recs,
			firstTx: map[uint]time.Time{1: dsDay("2026-06-02")},
		}
	}
	accounts := map[uint]models.Account{1: acc}

	// 1) 온주·소수점 모두 기록 → 회차마다 합쳐서 맞음, 지난 회차도 어긋나지 않는다
	list := holdingChecks(build(nil), accounts)[1]
	if len(list) != len(rounds) {
		t.Fatalf("회차 %d개: %+v", len(list), list)
	}
	for i, c := range list {
		if c.Status != models.HoldingCheckOK || c.Records != 2 || c.ExDate != rounds[i].ex || math.Abs(c.Implied-12.73) > 0.05 {
			t.Fatalf("%s 회차 = %+v", rounds[i].ex, c)
		}
	}
	if m := missingRecords(build(nil), accounts, now); len(m) != 0 {
		t.Fatalf("누락 = %+v", m)
	}

	// 2) 마지막 회차의 소수점 배당을 아직 안 넣었으면 '앱이 더 많음'이지만 소수점 계좌로 표시 (알림은 이틀 기다린다)
	a := build(func(i int, part string) bool { return i == len(rounds)-1 && part == "소수점" })
	last := latestHoldingChecks(a, accounts, now)
	if len(last) != 1 || last[0].Status != models.HoldingCheckOver || !last[0].Fractional || last[0].Records != 1 {
		t.Fatalf("한쪽만 = %+v", last)
	}
	if msg := HoldingCheckMessage(last[0]); !strings.Contains(msg, "온주·소수점") {
		t.Fatalf("문구 = %q", msg)
	}

	// 3) 8월 회차를 통째로 안 넣었으면 그 회차만 누락 (남는 기록이 앞 회차를 채워 가려지지 않는다)
	a = build(func(i int, _ string) bool { return i == 1 })
	miss := missingRecords(a, accounts, now)
	got := []string{}
	for _, m := range miss {
		if m.Status == "missing" {
			got = append(got, m.ExDate)
		}
	}
	if strings.Join(got, ",") != "2026-08-03" {
		t.Fatalf("누락 = %v (%+v)", got, miss)
	}
}

// 소수점 계좌에서 한쪽 배당만 기록하면 이틀 동안은 알리지 않는다
func TestHoldingAlertsSplitGrace(t *testing.T) {
	svc, db := newDivScoreFixture(t)
	db.AutoMigrate(&models.HoldingCheckAlert{}, &models.SignalEvent{})
	now := svc.clock()
	acc := models.Account{Name: "종합", Broker: "미래에셋증권", AccountType: models.AccountTypeGeneral}
	db.Create(&acc)
	jepq := models.Asset{Ticker: "JEPQ", Name: "JEPQ", Type: models.AssetTypeETF}
	db.Create(&jepq)
	db.Create(&models.Holding{AccountID: acc.ID, AssetID: jepq.ID, Quantity: 12.73, AveragePrice: 50})
	db.Create(&models.Transaction{AccountID: acc.ID, AssetID: jepq.ID, Type: models.TransactionTypeBuy, Date: dsDay("2026-06-02"), Price: 50, Quantity: 12.73})
	svc.fetchEvents = func([]string) map[string][]DividendEvent {
		return map[string][]DividendEvent{"JEPQ": {{Time: dsDay("2026-11-02").Unix(), Amount: 0.54}}}
	}
	whole := models.Dividend{AccountID: acc.ID, AssetID: jepq.ID, Date: dsDay("2026-11-04"), Amount: math.Round(12*0.54*0.85*100) / 100, Currency: "USD", IsReceived: true, CreatedAt: now.Add(-3 * time.Hour)}
	db.Create(&whole)
	if evs, _ := svc.HoldingAlerts(true, now); len(evs) != 0 {
		t.Fatalf("한쪽만 기록하고 3시간 — 아직 알리지 않아야 한다: %+v", evs)
	}
	// 소수점 배당도 기록하면 맞아서 알릴 게 없다 (저장 직후 확인도 없음)
	frac := models.Dividend{AccountID: acc.ID, AssetID: jepq.ID, Date: dsDay("2026-11-04"), Amount: math.Round(0.73*0.54*0.85*100) / 100, Currency: "USD", IsReceived: true, CreatedAt: now.Add(-72 * time.Hour)}
	db.Create(&frac)
	db.Model(&whole).Update("created_at", now.Add(-72*time.Hour))
	if evs, _ := svc.HoldingAlerts(true, now); len(evs) != 0 {
		t.Fatalf("둘 다 기록했는데 알림: %+v", evs)
	}
	if c, err := svc.CheckDividend(frac.ID); err != nil || c != nil {
		t.Fatalf("CheckDividend = %+v, %v", c, err)
	}
	// 소수점 배당을 지운 채 이틀이 지나면 알린다
	db.Delete(&frac)
	if evs, _ := svc.HoldingAlerts(true, now); len(evs) != 1 || !strings.Contains(evs[0].Message, "온주·소수점") {
		t.Fatalf("이틀 지나 알림 = %+v", evs)
	}
}
