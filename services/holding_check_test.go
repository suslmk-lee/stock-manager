package services

import (
	"math"
	"strings"
	"testing"
	"time"

	"stock-manager/models"
)

// 배당 기록으로 본 보유 수량: 맞음 · 매수 빠짐(매달 늘어 모으기로 보임) · 세전으로 기록 · 연금 계좌(세금 없음) · 국내 ETF(세율 범위)
func TestHoldingChecks(t *testing.T) {
	svc, db := newDivScoreFixture(t)
	db.AutoMigrate(&models.HoldingCheckAlert{}, &models.SignalEvent{})
	now := svc.clock()

	meritz := models.Account{Name: "Super365", Broker: "메리츠증권", AccountType: models.AccountTypeGeneral}
	toss := models.Account{Name: "토스증권", Broker: "토스증권", AccountType: models.AccountTypeGeneral}
	kakao := models.Account{Name: "종합계좌", Broker: "카카오증권", AccountType: models.AccountTypeGeneral}
	pension := models.Account{Name: "연금저축", Broker: "미래에셋증권", AccountType: models.AccountTypePension}
	general := models.Account{Name: "주식계좌", Broker: "NH투자증권", AccountType: models.AccountTypeGeneral}
	for _, a := range []*models.Account{&meritz, &toss, &kakao, &pension, &general} {
		db.Create(a)
	}
	jepq := models.Asset{Ticker: "JEPQ", Name: "JPMorgan Nasdaq Equity Premium Income ETF", Type: models.AssetTypeETF}
	krEtf := models.Asset{Ticker: "458730.KS", Name: "TIGER 미국배당다우존스", Type: models.AssetTypeETF}
	db.Create(&jepq)
	db.Create(&krEtf)

	type round struct {
		ex, paid string
		dps      float64
	}
	rounds := []round{{"2026-07-01", "2026-07-06", 0.637}, {"2026-08-03", "2026-08-06", 0.705}, {"2026-09-01", "2026-09-04", 0.683}, {"2026-10-01", "2026-10-06", 0.567}, {"2026-11-02", "2026-11-04", 0.540}}
	var market []DividendEvent
	for _, r := range rounds {
		market = append(market, DividendEvent{Time: dsDay(r.ex).Unix(), Amount: r.dps})
	}
	krRounds := []round{{"2026-07-30", "2026-08-03", 60}, {"2026-08-28", "2026-09-02", 60}, {"2026-09-29", "2026-10-06", 60}, {"2026-10-30", "2026-11-04", 60}}
	var krMarket []DividendEvent
	for _, r := range krRounds {
		krMarket = append(krMarket, DividendEvent{Time: dsDay(r.ex).Unix(), Amount: r.dps})
	}
	svc.fetchEvents = func(tickers []string) map[string][]DividendEvent {
		return map[string][]DividendEvent{"JEPQ": market, "458730.KS": krMarket}
	}
	old := now.Add(-time.Hour) // 저장하고 시간이 지난 기록 (알림 대상)
	rec := func(acc models.Account, asset models.Asset, paid string, amount float64, ccy string) {
		db.Create(&models.Dividend{AccountID: acc.ID, AssetID: asset.ID, Date: dsDay(paid), Amount: amount, Currency: ccy, IsReceived: true, CreatedAt: old})
	}
	// 메리츠: 10주 그대로, 세후 금액 → 맞음
	db.Create(&models.Holding{AccountID: meritz.ID, AssetID: jepq.ID, Quantity: 10, AveragePrice: 50})
	// 토스: 앱은 11.07주, 실제로는 매달 0.2주씩 늘어 11/2 에 11.5주 → 매수 빠짐 · 모으기로 보임
	db.Create(&models.Holding{AccountID: toss.ID, AssetID: jepq.ID, Quantity: 11.07, AveragePrice: 50})
	// 카카오: 6.42주, 마지막 회차만 세전 금액으로 기록
	db.Create(&models.Holding{AccountID: kakao.ID, AssetID: jepq.ID, Quantity: 6.42, AveragePrice: 50})
	tossQty := []float64{10.7, 10.9, 11.1, 11.3, 11.5}
	for i, r := range rounds {
		rec(meritz, jepq, r.paid, math.Round(10*r.dps*0.85*100)/100, "USD")
		rec(toss, jepq, r.paid, math.Round(tossQty[i]*r.dps*0.85*100)/100, "USD")
		amt := 6.42 * r.dps * 0.85
		if i == len(rounds)-1 {
			amt = 6.42 * r.dps // 세전
		}
		rec(kakao, jepq, r.paid, math.Round(amt*100)/100, "USD")
	}
	// 국내 ETF: 연금 계좌는 세금 없이 100주분, 일반 계좌는 과세표준이 작아 세금이 10%만 떼였다 → 둘 다 맞음
	db.Create(&models.Holding{AccountID: pension.ID, AssetID: krEtf.ID, Quantity: 100, AveragePrice: 12000})
	db.Create(&models.Holding{AccountID: general.ID, AssetID: krEtf.ID, Quantity: 50, AveragePrice: 12000})
	for _, r := range krRounds {
		rec(pension, krEtf, r.paid, 100*r.dps, "KRW")
		rec(general, krEtf, r.paid, math.Round(50*r.dps*0.9), "KRW")
	}

	assets, err := svc.loadAssets(now.AddDate(-1, 0, 0), false)
	if err != nil {
		t.Fatal(err)
	}
	accounts, _ := svc.accountMap()
	got := map[uint]models.HoldingCheck{}
	for _, a := range assets {
		for _, c := range latestHoldingChecks(a, accounts, now) {
			got[c.AccountID] = c
		}
	}
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.02 }
	if c := got[meritz.ID]; c.Status != models.HoldingCheckOK || !near(c.Implied, 10) {
		t.Errorf("메리츠 = %+v", c)
	}
	if c := got[toss.ID]; c.Status != models.HoldingCheckShort || !near(c.Implied, 11.5) || !near(c.AppQty, 11.07) || !c.Recurring || c.ExDate != "2026-11-02" || c.BuyDate != "2026-11-01" {
		t.Errorf("토스 = %+v", c)
	}
	if c := got[kakao.ID]; c.Status != models.HoldingCheckGross || !near(c.FixedAmount, 2.95) {
		t.Errorf("카카오 = %+v", c)
	}
	if c := got[pension.ID]; c.Status != models.HoldingCheckOK {
		t.Errorf("연금 = %+v", c)
	}
	if c := got[general.ID]; c.Status != models.HoldingCheckOK {
		t.Errorf("일반 국내 ETF = %+v", c)
	}

	// 기록 저장 직후 확인: 맞으면 nil, 다르면 결과
	var last models.Dividend
	db.Where("account_id = ?", toss.ID).Order("date DESC").First(&last)
	if c, err := svc.CheckDividend(last.ID); err != nil || c == nil || c.Status != models.HoldingCheckShort {
		t.Fatalf("CheckDividend 토스 = %+v, %v", c, err)
	}
	// 지난 회차 기록(7월: 그때 10.7주 · 앱 11.07주)을 고쳐 저장해도 묻지 않는다 — 최근 기록만
	var first models.Dividend
	db.Where("account_id = ?", toss.ID).Order("date ASC").First(&first)
	if c, err := svc.CheckDividend(first.ID); err != nil || c != nil {
		t.Fatalf("CheckDividend 지난 기록 = %+v, %v", c, err)
	}
	var lastM models.Dividend
	db.Where("account_id = ?", meritz.ID).Order("date DESC").First(&lastM)
	if c, err := svc.CheckDividend(lastM.ID); err != nil || c != nil {
		t.Fatalf("CheckDividend 메리츠 = %+v, %v", c, err)
	}

	// 알림: 맞지 않는 계좌만 한 번씩, 다시 돌려도 또 만들지 않는다
	evs, err := svc.HoldingAlerts(true, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 2 {
		t.Fatalf("알림 %d개: %+v", len(evs), evs)
	}
	for _, e := range evs {
		if e.Kind != models.SignalEventKindHolding || e.ReadAt != nil || e.ID == 0 {
			t.Fatalf("알림 = %+v", e)
		}
	}
	if !strings.Contains(evs[0].Message+evs[1].Message, "매수 0.43주가 빠진 것 같아요") || !strings.Contains(evs[0].Message+evs[1].Message, "세전 금액 같아요") {
		t.Fatalf("문구: %q / %q", evs[0].Message, evs[1].Message)
	}
	if again, _ := svc.HoldingAlerts(true, now); len(again) != 0 {
		t.Fatalf("같은 기록으로 또 알림: %+v", again)
	}

	// 방금 저장한 기록은 화면에서 바로 안내하므로 20분 동안은 알리지 않는다
	fresh := models.Dividend{AccountID: general.ID, AssetID: krEtf.ID, Date: dsDay("2026-11-12"), Amount: 9000, Currency: "KRW", IsReceived: true}
	db.Create(&fresh)
	krMarket = append(krMarket, DividendEvent{Time: dsDay("2026-11-10").Unix(), Amount: 60})
	if evs, _ := svc.HoldingAlerts(true, now); len(evs) != 0 {
		t.Fatalf("방금 기록한 것을 바로 알림: %+v", evs)
	}
	db.Model(&fresh).Update("created_at", old)
	if evs, _ := svc.HoldingAlerts(false, now); len(evs) != 1 || evs[0].ReadAt == nil {
		t.Fatalf("알림 꺼짐이면 읽음으로: %+v", evs)
	}
}

// 국내 12월 결산 배당이 1분기 배당락(3월 말) 뒤 4월에 들어와도, 짝 없는 결산 회차의 주당 배당으로 맞춰 본다
func TestHoldingChecksKRAnnualFallback(t *testing.T) {
	market := []DividendEvent{{Time: dsDay("2025-12-29").Unix(), Amount: 1000}, {Time: dsDay("2026-03-30").Unix(), Amount: 361}}
	a := &divScoreAsset{
		asset:   models.Asset{ID: 3, Ticker: "005930.KS", Name: "삼성전자"},
		qtyAt:   QuantityAtFunc(map[uint]float64{1: 10}, nil),
		acctIDs: []uint{1},
		market:  market,
		records: []models.Dividend{{ID: 1, AccountID: 1, Date: dsDay("2026-04-17"), Amount: 8460, Currency: "KRW", IsReceived: true}},
	}
	list := holdingChecks(a, map[uint]models.Account{1: {ID: 1, AccountType: models.AccountTypeGeneral}})[1]
	if len(list) != 1 || list[0].Status != models.HoldingCheckOK || list[0].ExDate != "2025-12-29" {
		t.Fatalf("결산 배당 = %+v", list)
	}
}
