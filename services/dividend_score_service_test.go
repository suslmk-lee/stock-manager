package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newDivScoreFixture(t *testing.T) (*DividendScoreService, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.Transaction{}, &models.Dividend{}, &models.DividendScoreSetting{}, &models.DividendScoreSnapshot{}); err != nil {
		t.Fatal(err)
	}
	svc := NewDividendScoreService(db, nil)
	svc.now = func() time.Time { return dsDay("2026-11-13").Add(12 * time.Hour) }
	return svc, db
}

func TestDividendScoreRankingFlow(t *testing.T) {
	svc, db := newDivScoreFixture(t)
	acc := models.Account{Name: "토스", Broker: "토스증권", MarketType: models.MarketTypeInternational, Currency: "USD"}
	db.Create(&acc)
	grow := models.Asset{Ticker: "GROW", Name: "Grower ETF", Type: models.AssetTypeStock}
	cut := models.Asset{Ticker: "CUTX", Name: "Cutter Inc", Type: models.AssetTypeStock}
	none := models.Asset{Ticker: "NODV", Name: "No Dividend", Type: models.AssetTypeStock}
	sold := models.Asset{Ticker: "SOLD", Name: "Sold Long Ago", Type: models.AssetTypeStock}
	mid := models.Asset{Ticker: "MIDM", Name: "Bought Mid Month", Type: models.AssetTypeStock}
	for _, a := range []*models.Asset{&grow, &cut, &none, &sold, &mid} {
		db.Create(a)
	}
	// 보유: GROW·CUTX·NODV (2023년부터 보유), SOLD 는 2024년에 팔았다
	for _, a := range []models.Asset{grow, cut, none} {
		db.Create(&models.Holding{AccountID: acc.ID, AssetID: a.ID, Quantity: 10, AveragePrice: 20})
		db.Create(&models.Transaction{AccountID: acc.ID, AssetID: a.ID, Type: models.TransactionTypeBuy, Date: dsDay("2023-01-10"), Price: 20, Quantity: 10})
	}
	db.Create(&models.Transaction{AccountID: acc.ID, AssetID: sold.ID, Type: models.TransactionTypeBuy, Date: dsDay("2022-01-10"), Price: 20, Quantity: 5})
	db.Create(&models.Transaction{AccountID: acc.ID, AssetID: sold.ID, Type: models.TransactionTypeSell, Date: dsDay("2024-01-10"), Price: 20, Quantity: 5})
	// MIDM 은 이번 달 5일에 샀다 → 이번 달 순위에는 넣고(1일 기준 점수), 지난 달에는 없다
	db.Create(&models.Holding{AccountID: acc.ID, AssetID: mid.ID, Quantity: 3, AveragePrice: 20})
	db.Create(&models.Transaction{AccountID: acc.ID, AssetID: mid.ID, Type: models.TransactionTypeBuy, Date: dsDay("2026-11-05"), Price: 20, Quantity: 3})

	growEv := quarterly(dsDay("2021-12-15"), 20, 0.5, 0.10) // ~2026-09
	cutEv := quarterly(dsDay("2021-12-15"), 16, 1.0, 0)     // ~2025-09 같은 금액
	cutEv = append(cutEv, DivPerShare{Date: dsDay("2025-12-15"), Amount: 0.6}, DivPerShare{Date: dsDay("2026-03-15"), Amount: 0.6},
		DivPerShare{Date: dsDay("2026-06-15"), Amount: 0.6}, DivPerShare{Date: dsDay("2026-09-15"), Amount: 0.6})
	toMarket := func(ev []DivPerShare) []DividendEvent {
		out := make([]DividendEvent, 0, len(ev))
		for _, e := range ev {
			out = append(out, DividendEvent{Time: e.Date.Unix(), Amount: e.Amount})
		}
		return out
	}
	svc.fetchEvents = func([]string) map[string][]DividendEvent {
		return map[string][]DividendEvent{"GROW": toMarket(growEv), "CUTX": toMarket(cutEv), "MIDM": toMarket(growEv), "SOLD": toMarket(quarterly(dsDay("2021-03-01"), 20, 1, 0))}
	}
	svc.fetchHist = func([]string) map[string]*PriceHistory {
		pts := dsFlatCloses(dsDay("2023-01-01"), dsDay("2026-11-12"), 25)
		return map[string]*PriceHistory{"GROW": {Points: pts}, "CUTX": {Points: pts}, "NODV": {Points: pts}}
	}
	// 내 배당 기록: GROW 2026-09 회차만 적었다 → 2025-12·2026-03·2026-06 회차는 기록 누락
	db.Create(&models.Dividend{AccountID: acc.ID, AssetID: grow.ID, Date: dsDay("2026-09-30"), Amount: 6, Currency: "USD", IsReceived: true})

	r, err := svc.GetRanking("")
	if err != nil {
		t.Fatal(err)
	}
	if r.Month != "2026-11" || !r.Current || len(r.Months) != 12 || len(r.Rows) != 3 {
		t.Fatalf("ranking = %+v", r)
	}
	byTicker := map[string]DivScoreRow{}
	for _, row := range r.Rows {
		byTicker[row.Asset.Ticker] = row
	}
	if r.Rows[0].Asset.Ticker != "GROW" || r.Rows[0].Rank != 1 || r.Rows[0].Metrics.Status != divStatusUp || byTicker["CUTX"].Metrics.Status != divStatusDown || byTicker["CUTX"].Rank != 3 {
		t.Fatalf("rows = %+v", r.Rows)
	}
	if m := byTicker["MIDM"]; m.Rank != 2 || m.PrevRank != nil || m.MissingCount != 0 {
		t.Fatalf("이번 달에 산 종목 = %+v", m)
	}
	if r.Rows[0].PrevRank == nil || r.Rows[0].YOCPct == nil || r.Rows[0].Estimated {
		t.Fatalf("prev/yoc = %+v", r.Rows[0])
	}
	if len(r.NoDividend) != 1 || r.NoDividend[0].Ticker != "NODV" {
		t.Fatalf("no dividend = %+v", r.NoDividend)
	}
	missing := 0
	for _, m := range r.Missing {
		if m.Ticker == "GROW" && m.Status == "missing" {
			missing++
		}
		if m.AccountBroker != "토스증권" || m.AccountName != "토스" {
			t.Fatalf("기록 누락에 계좌·증권사 이름이 있어야 한다: %+v", m)
		}
		if m.Ticker == "SOLD" {
			t.Fatalf("판 종목은 기록 누락에 넣지 않는다: %+v", m)
		}
	}
	if missing != 3 || r.Rows[0].MissingCount != 3 {
		t.Fatalf("missing = %d (%+v)", missing, r.Missing)
	}

	// 지난 달은 추정, 12개월 모두 기록, 판 종목은 판 뒤의 달에 없다
	var snaps []models.DividendScoreSnapshot
	db.Find(&snaps)
	months := map[string]int{}
	for _, sn := range snaps {
		months[sn.Month]++
		if sn.AssetID == sold.ID {
			t.Fatalf("2024년에 판 종목이 최근 12개월 순위에 있다: %+v", sn)
		}
		if sn.AssetID == mid.ID && sn.Month != "2026-11" {
			t.Fatalf("이번 달에 산 종목이 지난 달 순위에 있다: %+v", sn)
		}
		if sn.Month != "2026-11" && !sn.Estimated {
			t.Fatalf("지난 달은 추정이어야 한다: %+v", sn)
		}
	}
	if len(months) != 12 {
		t.Fatalf("months = %v", months)
	}

	// 배점을 바꾸면 저장된 항목 점수는 그대로, 총점만 다시
	before := byTicker["CUTX"].Score
	if _, err := svc.UpdateSettings(models.DividendScoreSetting{Growth: 0, Stability: 0, Yield: 100, Consistency: 0, Value: 0}); err != nil {
		t.Fatal(err)
	}
	r2, _ := svc.GetRanking("2026-11")
	for _, row := range r2.Rows {
		if row.Asset.Ticker == "CUTX" && row.Score == before {
			t.Fatalf("배점을 바꿨는데 점수가 같다: %v", row.Score)
		}
	}
	if _, err := svc.UpdateSettings(models.DividendScoreSetting{}); err == nil {
		t.Fatal("배점이 모두 0 이면 거절해야 한다")
	}
	if _, err := svc.UpdateSettings(models.DividendScoreSetting{Growth: 101, Stability: 1}); err == nil {
		t.Fatal("100 넘는 배점은 거절해야 한다")
	}

	// 종목 상세: 12개월 흐름, 연도별 주당 배당, 최근 회차
	d, err := svc.GetDetail(grow.ID)
	if err != nil || len(d.History) != 12 || len(d.Years) == 0 || len(d.Payments) == 0 || d.Source != "market" {
		t.Fatalf("detail = %+v err %v", d, err)
	}
	if d.Position == nil || d.Position.Quantity != 10 || d.Position.AvgPrice != 20 || d.Position.Since != "2023-01-10" || len(d.Position.Received) != 1 || d.Position.Received[0].Total != 6 {
		t.Fatalf("내 보유 = %+v", d.Position)
	}

	// 항목별 순위: 항목마다 1..n 이 하나씩, 지난달 항목 순위는 지난달에 있던 종목만
	for _, k := range divPartKeys {
		seen := map[int]bool{}
		for _, row := range r2.Rows {
			pr := row.PartRank[k]
			if pr < 1 || pr > len(r2.Rows) || seen[pr] {
				t.Fatalf("%s 순위가 겹치거나 빠졌다: %+v", k, r2.Rows)
			}
			seen[pr] = true
			if (row.PrevRank == nil) != (row.PrevPartRank == nil) {
				t.Fatalf("지난달 항목 순위는 지난달 순위와 함께 있어야 한다: %+v", row)
			}
		}
	}
	// 배점을 수익률 100 으로 바꿨으므로 수익률 순위 = 총점 순위
	for _, row := range r2.Rows {
		if row.PartRank["yield"] != row.Rank {
			t.Fatalf("수익률만 볼 때 수익률 순위와 총점 순위가 달라야 할 이유가 없다: %+v", row)
		}
	}

	// 다시 계산: 이번 달 기록을 지우고 새로
	if err := svc.Recompute("2026-11"); err != nil {
		t.Fatal(err)
	}
	var n int64
	db.Model(&models.DividendScoreSnapshot{}).Where("month = ?", "2026-11").Count(&n)
	if n != 3 {
		t.Fatalf("recomputed = %d", n)
	}
	if _, err := svc.GetRanking("2020-01"); err == nil {
		t.Fatal("12개월 밖의 달은 거절해야 한다")
	}
}

// 내 보유: 계좌별 수량·평단, 다 팔았다가 다시 산 계좌는 다시 산 날부터, 그 뒤 받은 배당만 (세후, 받은 것만)
func TestDividendScorePosition(t *testing.T) {
	svc, db := newDivScoreFixture(t)
	svc.fetchEvents = func([]string) map[string][]DividendEvent { return map[string][]DividendEvent{} }
	svc.fetchHist = func([]string) map[string]*PriceHistory { return map[string]*PriceHistory{} }
	a := models.Account{Name: "종합계좌", Broker: "NH투자증권", MarketType: models.MarketTypeInternational, Currency: "USD"}
	b := models.Account{Name: "ISA", Broker: "한국투자증권", MarketType: models.MarketTypeDomestic, Currency: "KRW", AccountType: models.AccountTypeISA}
	db.Create(&a)
	db.Create(&b)
	x := models.Asset{Ticker: "XDIV", Name: "X Dividend", Type: models.AssetTypeETF}
	db.Create(&x)
	db.Create(&models.Transaction{AccountID: a.ID, AssetID: x.ID, Type: models.TransactionTypeBuy, Date: dsDay("2022-03-02"), Price: 25, Quantity: 10})
	db.Create(&models.Transaction{AccountID: a.ID, AssetID: x.ID, Type: models.TransactionTypeSell, Date: dsDay("2023-05-02"), Price: 28, Quantity: 10})
	db.Create(&models.Transaction{AccountID: a.ID, AssetID: x.ID, Type: models.TransactionTypeBuy, Date: dsDay("2024-02-15"), Price: 30, Quantity: 5})
	db.Create(&models.Transaction{AccountID: b.ID, AssetID: x.ID, Type: models.TransactionTypeBuy, Date: dsDay("2025-07-01"), Price: 40, Quantity: 2})
	db.Create(&models.Holding{AccountID: a.ID, AssetID: x.ID, Quantity: 5, AveragePrice: 30})
	db.Create(&models.Holding{AccountID: b.ID, AssetID: x.ID, Quantity: 2, AveragePrice: 40})
	db.Create(&models.Dividend{AccountID: a.ID, AssetID: x.ID, Date: dsDay("2022-12-20"), Amount: 9, Currency: "USD", IsReceived: true})          // 다 팔기 전 — 뺀다
	db.Create(&models.Dividend{AccountID: a.ID, AssetID: x.ID, Date: dsDay("2025-06-20"), Amount: 5, Tax: 1, Currency: "USD", IsReceived: true}) // 세후 4
	db.Create(&models.Dividend{AccountID: b.ID, AssetID: x.ID, Date: dsDay("2026-06-20"), Amount: 2, Currency: "usd", IsReceived: true})         // 최근 12개월
	db.Create(&models.Dividend{AccountID: b.ID, AssetID: x.ID, Date: dsDay("2026-10-20"), Amount: 3, Currency: "USD", IsReceived: false})        // 아직 안 받음 — 뺀다

	p, err := svc.position(x.ID, svc.clock())
	if err != nil || p == nil {
		t.Fatalf("position = %+v err %v", p, err)
	}
	if p.Quantity != 7 || p.Cost != 230 || math.Abs(p.AvgPrice-230.0/7) > 1e-9 || p.Since != "2024-02-15" {
		t.Fatalf("합계 = %+v", p)
	}
	if len(p.Accounts) != 2 || p.Accounts[0].AccountID != a.ID || p.Accounts[0].Since != "2024-02-15" || p.Accounts[1].Name != "ISA" || p.Accounts[1].AccountType != "ISA" || p.Accounts[1].Since != "2025-07-01" {
		t.Fatalf("계좌별 = %+v", p.Accounts)
	}
	if len(p.Received) != 1 || p.Received[0].Currency != "USD" || p.Received[0].Total != 6 || p.Received[0].Count != 2 || p.Received[0].Last12m != 2 {
		t.Fatalf("받은 배당 = %+v", p.Received)
	}
	// 보유하지 않은 종목은 nil
	y := models.Asset{Ticker: "NONE", Name: "Not Held", Type: models.AssetTypeStock}
	db.Create(&y)
	if p, err := svc.position(y.ID, svc.clock()); err != nil || p != nil {
		t.Fatalf("보유 안 함 = %+v err %v", p, err)
	}
}

// 공식이 바뀌면 예전 공식으로 저장된 기록을 같은 달·종목 그대로 다시 계산한다 ('추정' 여부는 유지)
func TestDividendScoreFormulaUpgrade(t *testing.T) {
	svc, db := newDivScoreFixture(t)
	acc := models.Account{Name: "토스", Broker: "토스증권", MarketType: models.MarketTypeInternational, Currency: "USD"}
	db.Create(&acc)
	a := models.Asset{Ticker: "GROW", Name: "Grower ETF", Type: models.AssetTypeStock}
	db.Create(&a)
	db.Create(&models.Holding{AccountID: acc.ID, AssetID: a.ID, Quantity: 10, AveragePrice: 20})
	db.Create(&models.Transaction{AccountID: acc.ID, AssetID: a.ID, Type: models.TransactionTypeBuy, Date: dsDay("2023-01-10"), Price: 20, Quantity: 10})
	ev := quarterly(dsDay("2021-12-15"), 20, 0.5, 0.10)
	svc.fetchEvents = func([]string) map[string][]DividendEvent {
		out := make([]DividendEvent, 0, len(ev))
		for _, e := range ev {
			out = append(out, DividendEvent{Time: e.Date.Unix(), Amount: e.Amount})
		}
		return map[string][]DividendEvent{"GROW": out}
	}
	svc.fetchHist = func([]string) map[string]*PriceHistory {
		return map[string]*PriceHistory{"GROW": {Points: dsFlatCloses(dsDay("2023-01-01"), dsDay("2026-11-12"), 25)}}
	}
	if _, err := svc.GetRanking(""); err != nil {
		t.Fatal(err)
	}
	var n int64
	db.Model(&models.DividendScoreSnapshot{}).Where("formula = ?", divScoreFormula).Count(&n)
	if n != 12 {
		t.Fatalf("새 기록은 지금 공식 버전이어야 한다: %d", n)
	}
	// 예전 공식으로 저장된 것처럼: 버전 1, 항목 점수 표시값, 10월은 '추정 아님'(그달 1일에 계산했던 기록)
	db.Model(&models.DividendScoreSnapshot{}).Where("1 = 1").Updates(map[string]any{"formula": 1, "yield": 0.123})
	db.Model(&models.DividendScoreSnapshot{}).Where("month = ?", "2026-10").Update("estimated", false)

	if _, err := svc.GetRanking(""); err != nil {
		t.Fatal(err)
	}
	var snaps []models.DividendScoreSnapshot
	db.Find(&snaps)
	if len(snaps) != 12 {
		t.Fatalf("다시 계산해도 기록 수는 같아야 한다: %d", len(snaps))
	}
	for _, sn := range snaps {
		if sn.Formula != divScoreFormula || sn.Yield == 0.123 {
			t.Fatalf("예전 공식 기록이 다시 계산되지 않았다: %+v", sn)
		}
		if want := sn.Month != "2026-11" && sn.Month != "2026-10"; sn.Estimated != want {
			t.Fatalf("'추정' 여부가 바뀌었다: %+v", sn)
		}
	}
}
