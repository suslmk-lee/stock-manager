package services

import (
	"fmt"
	"strings"
	"testing"

	"stock-manager/models"
)

// 예정 배당: 입금 전 회차(판 종목 포함) · 미리 넣은 기록 · 배당락 추정을 합치고, 추정 회차 창 안의 미리 넣은 기록은 그것만 남긴다.
func TestUpcomingDividends(t *testing.T) {
	svc, db := newDivScoreFixture(t) // 지금 2026-11-13 12:00 KST
	db.AutoMigrate(&models.Dividend{})
	a := models.Account{Name: "토스", Broker: "토스증권", MarketType: models.MarketTypeInternational, Currency: "USD"}
	b := models.Account{Name: "연금", Broker: "미래에셋", MarketType: models.MarketTypeDomestic, Currency: "KRW"}
	db.Create(&a)
	db.Create(&b)
	pend := models.Asset{Ticker: "PEND", Name: "Pending Quarterly", Type: models.AssetTypeStock}
	mont := models.Asset{Ticker: "MONT", Name: "Monthly Payer", Type: models.AssetTypeStock}
	sold := models.Asset{Ticker: "SOLDP", Name: "Sold After Ex", Type: models.AssetTypeStock}
	jp := models.Asset{Ticker: "2621.T", Name: "iShares JP", Type: models.AssetTypeStock}
	for _, x := range []*models.Asset{&pend, &mont, &sold, &jp} {
		db.Create(x)
	}
	// PEND: 10주, 11-03 배당락 뒤 기록 없음 → 입금 전 (기한 01-02). 다음 회차(02-02)는 45일 밖
	db.Create(&models.Holding{AccountID: a.ID, AssetID: pend.ID, Quantity: 10, AveragePrice: 20})
	db.Create(&models.Transaction{AccountID: a.ID, AssetID: pend.ID, Type: models.TransactionTypeBuy, Date: dsDay("2023-01-10"), Price: 20, Quantity: 10})
	// MONT: 월배당 (매달 20일). A 100주(기록 다 있음), B 50주(9·10월 기록 — 그 전은 언제 샀는지 몰라 따지지 않음)
	db.Create(&models.Holding{AccountID: a.ID, AssetID: mont.ID, Quantity: 100, AveragePrice: 10})
	db.Create(&models.Transaction{AccountID: a.ID, AssetID: mont.ID, Type: models.TransactionTypeBuy, Date: dsDay("2024-06-01"), Price: 10, Quantity: 100})
	db.Create(&models.Holding{AccountID: b.ID, AssetID: mont.ID, Quantity: 50, AveragePrice: 10})
	montEv := []DividendEvent{}
	for i := 0; i < 22; i++ { // 2025-01-20 ~ 2026-10-20
		ex := dsDay("2025-01-20").AddDate(0, i, 0)
		montEv = append(montEv, DividendEvent{Time: ex.Unix(), Amount: 0.1})
		if !ex.Before(dsDay("2025-11-01")) {
			db.Create(&models.Dividend{AccountID: a.ID, AssetID: mont.ID, Date: ex.AddDate(0, 0, 10), Amount: 8.5, Currency: "USD", IsReceived: true})
		}
	}
	for _, d := range []string{"2026-09-30", "2026-10-30"} {
		db.Create(&models.Dividend{AccountID: b.ID, AssetID: mont.ID, Date: dsDay(d), Amount: 4.25, Currency: "USD", IsReceived: true})
	}
	// A 계좌 MONT 미리 넣은 기록 11-30 → 11-19 추정 회차와 같은 회차 (추정은 빠진다). 45일 밖·받은 기록은 넣지 않는다
	db.Create(&models.Dividend{AccountID: a.ID, AssetID: mont.ID, Date: dsDay("2026-11-30"), Amount: 10, Tax: 1.5, Currency: "USD"})
	db.Create(&models.Dividend{AccountID: a.ID, AssetID: mont.ID, Date: dsDay("2027-03-01"), Amount: 10, Currency: "USD"})
	db.Create(&models.Dividend{AccountID: a.ID, AssetID: jp.ID, Date: dsDay("2026-12-10"), Amount: 500, Currency: "JPY", IsReceived: true})
	// SOLDP: 10-30 배당락 뒤 11-05 에 다 팔았다 → 배당은 들어온다 (입금 전, 기한 12-29)
	db.Create(&models.Transaction{AccountID: a.ID, AssetID: sold.ID, Type: models.TransactionTypeBuy, Date: dsDay("2025-01-10"), Price: 20, Quantity: 20})
	db.Create(&models.Transaction{AccountID: a.ID, AssetID: sold.ID, Type: models.TransactionTypeSell, Date: dsDay("2026-11-05"), Price: 20, Quantity: 20})
	// 2621.T: 보유·거래 없이 미리 넣은 엔화 기록 — 환율을 모르면 원화 환산 없음
	db.Create(&models.Dividend{AccountID: a.ID, AssetID: jp.ID, Date: dsDay("2026-12-01"), Amount: 1000, Currency: "JPY"})

	quarterlyFrom := func(start string, n int) []DividendEvent {
		var out []DividendEvent
		for i := 0; i < n; i++ {
			out = append(out, DividendEvent{Time: dsDay(start).AddDate(0, 3*i, 0).Unix(), Amount: 0.5})
		}
		return out
	}
	svc.fetchEvents = func([]string) map[string][]DividendEvent {
		return map[string][]DividendEvent{"PEND": quarterlyFrom("2024-02-03", 12), "MONT": montEv, "SOLDP": quarterlyFrom("2025-01-30", 8)}
	}
	fx := func(ccy string) float64 {
		if ccy == "USD" {
			return 1400
		}
		return 0
	}

	r, err := svc.GetUpcoming(0, fx)
	if err != nil {
		t.Fatal(err)
	}
	if r.AsOf != "2026-11-13" || r.Days != 45 {
		t.Fatalf("as_of/days = %s/%d", r.AsOf, r.Days)
	}
	var got []string
	for _, u := range r.Items {
		got = append(got, fmt.Sprintf("%s %s %s %s %.2f", u.Kind, u.Ticker, accName(u.AccountID, a, b), u.sortDate(), u.ExpectedNet))
	}
	want := []string{
		"forecast MONT B 2026-11-19 4.25",
		"manual MONT A 2026-11-30 8.50",
		"manual 2621.T A 2026-12-01 1000.00",
		"forecast MONT A 2026-12-19 8.50",
		"forecast MONT B 2026-12-19 4.25",
		"pending SOLDP A 2026-12-29 8.50",
		"pending PEND A 2027-01-02 4.25",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("items:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	for _, u := range r.Items {
		switch u.Kind {
		case UpcomingForecast:
			if !u.Estimated || u.ExDate == "" || u.DividendID != nil || u.PerShare != 0.1 {
				t.Fatalf("forecast = %+v", u)
			}
		case UpcomingManual:
			if u.Estimated || u.DividendID == nil || u.Date == "" {
				t.Fatalf("manual = %+v", u)
			}
		case UpcomingPending:
			if u.Estimated || u.ExDate == "" || u.PayBy == "" || u.AccountBroker != "토스증권" {
				t.Fatalf("pending = %+v", u)
			}
		}
		if u.Currency == "JPY" {
			if u.ExpectedNetKRW != nil {
				t.Fatalf("환율을 모르는 통화는 원화 환산이 없어야 한다: %+v", u)
			}
		} else if u.ExpectedNetKRW == nil || *u.ExpectedNetKRW != u.ExpectedNet*1400 {
			t.Fatalf("원화 환산 = %+v", u)
		}
	}
	if m := r.Items[1]; m.Quantity != 100 || m.PerShare != 0.1 {
		t.Fatalf("미리 넣은 기록의 수량·주당 = %+v", m)
	}
	if r.TotalExpectedKRW != (4.25+8.5+8.5+4.25+8.5+4.25)*1400 {
		t.Fatalf("total = %v", r.TotalExpectedKRW)
	}
	if len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "JPY") {
		t.Fatalf("warnings = %v", r.Warnings)
	}

	// 기간: 120 넘으면 120, 30일이면 12-19 추정까지만 (입금 전 회차는 기한과 상관없이 넣는다)
	if r, _ := svc.GetUpcoming(500, fx); r.Days != 120 {
		t.Fatalf("days = %d", r.Days)
	}
	r30, _ := svc.GetUpcoming(30, fx)
	kinds := map[string]int{}
	for _, u := range r30.Items {
		kinds[u.Kind]++
	}
	if kinds[UpcomingForecast] != 1 || kinds[UpcomingManual] != 2 || kinds[UpcomingPending] != 2 {
		t.Fatalf("30일 = %v", kinds)
	}
}

func accName(id uint, a, b models.Account) string {
	if id == a.ID {
		return "A"
	}
	if id == b.ID {
		return "B"
	}
	return "?"
}

// 추정 회차의 첫 날짜는 배당 점수의 '다음 배당 예상'과 같다
func TestForecastRoundsMatchNextExpected(t *testing.T) {
	now := dsDay("2026-11-13").Add(12 * 60 * 60 * 1e9)
	ev := quarterly(dsDay("2021-12-15"), 20, 0.5, 0.10) // ~2026-09-15
	m, _, ok := computeDivScore(ev, nil, now, "market")
	if !ok || m.NextExpected == "" {
		t.Fatalf("metrics = %+v", m)
	}
	f := forecastRounds(ev, now, "2027-06-30")
	if len(f) < 2 || f[0].Date.In(kst).Format(dateLayout) != m.NextExpected {
		t.Fatalf("forecast = %+v, next expected %s", f, m.NextExpected)
	}
	if f[0].Amount != ev[len(ev)-1].Amount {
		t.Fatalf("주당 배당은 최근 정기 회차 = %v", f[0].Amount)
	}
	// 최근 12개월 회차가 없으면 추정하지 않는다
	if f := forecastRounds(ev, dsDay("2027-10-01"), "2027-12-31"); len(f) != 0 {
		t.Fatalf("12개월 회차 없음 = %+v", f)
	}
	// 늦은 회차(주기의 1.6배 + 20일 지남)도: 월배당이 08-20 에서 멈춤 → 11-13 엔 최근 12개월 10회·간격 36.5일인데 85일 지남 (09-01 엔 12회·30일 간격으로 09-19 부터)
	var monthly []DivPerShare
	for i := 0; i < 20; i++ {
		monthly = append(monthly, DivPerShare{Date: dsDay("2025-01-20").AddDate(0, i, 0), Amount: 0.1})
	}
	if f := forecastRounds(monthly, now, "2027-06-30"); len(f) != 0 {
		t.Fatalf("늦은 회차 = %+v", f)
	}
	if f := forecastRounds(monthly, dsDay("2026-09-01"), "2026-12-31"); len(f) != 4 || f[0].Date.In(kst).Format(dateLayout) != "2026-09-19" {
		t.Fatalf("월배당 추정 = %+v", f)
	}
}
