package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

const testJPY = 8.335 // ¥1 = ₩8.335

func TestFxSymbolAndBook(t *testing.T) {
	for _, c := range []struct {
		ccy, sym string
		mult     float64
	}{{"KRW", "", 1}, {"", "", 1}, {"USD", "KRW=X", 1}, {"JPY", "JPYKRW=X", 1}, {"jpy", "JPYKRW=X", 1}, {"GBp", "GBPKRW=X", 0.01}} {
		if sym, mult := fxSymbol(c.ccy); sym != c.sym || mult != c.mult {
			t.Errorf("fxSymbol(%q) = %q %v", c.ccy, sym, mult)
		}
	}
	if c := currencyFor("2621.T", ""); c != "JPY" {
		t.Fatalf("도쿄 상장은 엔화로 짐작해야 한다: %s", c)
	}
	if c := currencyFor("AAPL", ""); c != "USD" {
		t.Fatalf("꼬리표 없으면 달러: %s", c)
	}
	calls := 0
	b := newFxBook(1400, func(time.Time) float64 { return 1350 }, func(c string) float64 { calls++; return map[string]float64{"JPY": testJPY}[c] },
		func(c string, fb float64) func(time.Time) float64 {
			return func(time.Time) float64 { return 9.1 }
		})
	if b.now("KRW") != 1 || b.now("USD") != 1400 || b.now("JPY") != testJPY || b.now("JPY") != testJPY || calls != 1 {
		t.Fatalf("now: %v %v %v calls=%d", b.now("KRW"), b.now("USD"), b.now("JPY"), calls)
	}
	if b.at("USD", time.Now()) != 1350 || b.at("JPY", time.Now()) != 9.1 || b.at("KRW", time.Now()) != 1 {
		t.Fatal("at: 날짜별 환율을 써야 한다")
	}
	if b.now("HKD") != 0 || b.at("HKD", time.Now()) != 9.1 {
		t.Fatal("모르는 통화는 0 (날짜별 조회기가 있으면 그 값)")
	}
}

// 오늘 캡처: 엔화 종목은 엔화 환율로 (달러 환율 1500 이 아니라)
func TestDailyCaptureJPY(t *testing.T) {
	f := newDailyFixture(t)
	jp := models.Asset{Ticker: "2621.T", Name: "미국채20년엔화헷지ETF", Type: models.AssetTypeETF}
	f.db.Create(&jp)
	f.db.Create(&models.Holding{AccountID: f.accA.ID, AssetID: jp.ID, Quantity: 100, AveragePrice: 950})
	prev := f.s.fetchPrices
	f.s.fetchPrices = func(tk []string) map[string]*CurrentPrice {
		m := prev(tk)
		m["2621.T"] = &CurrentPrice{Symbol: "2621.T", Price: 961, Currency: "JPY"}
		return m
	}
	f.s.fxNowFor = func(c string) float64 { return map[string]float64{"JPY": testJPY}[c] }

	snap, err := f.s.CaptureToday("manual")
	if err != nil {
		t.Fatal(err)
	}
	jpValue := 100 * 961 * testJPY
	want := 10*150*1500.0 + 5*80000.0 + jpValue
	if !dnear(snap.TotalKRW, want) || !dnear(snap.CostKRW, 10*100*1500+5*70000+100*950*testJPY) {
		t.Fatalf("total %v want %v (cost %v)", snap.TotalKRW, want, snap.CostKRW)
	}
	var pos models.DailyPositionSnapshot
	f.db.Where("asset_id = ?", jp.ID).First(&pos)
	if pos.Currency != "JPY" || pos.FxRate != testJPY || !dnear(pos.ValueKRW, jpValue) {
		t.Fatalf("엔화 포지션 = %+v", pos)
	}

	// 엔화 환율을 모르면 달러 환율로 평가하지 않고 뺀다
	f.s.fxNowFor = func(string) float64 { return 0 }
	snap, _ = f.s.CaptureToday("manual")
	if !dnear(snap.TotalKRW, 10*150*1500.0+5*80000.0) {
		t.Fatalf("환율 모를 때 total %v", snap.TotalKRW)
	}
}

// 백필 추정: 엔화 종목은 그날 엔화 환율로
func TestDailyBackfillJPY(t *testing.T) {
	f := newDailyFixture(t)
	jp := models.Asset{Ticker: "2621.T", Name: "미국채20년엔화헷지ETF", Type: models.AssetTypeETF}
	f.db.Create(&jp)
	f.db.Create(&models.Holding{AccountID: f.accA.ID, AssetID: jp.ID, Quantity: 100, AveragePrice: 950})
	prevH := f.s.fetchHistorys
	f.s.fetchHistorys = func(tk []string, r string) map[string]*PriceHistory {
		m := prevH(tk, r)
		m["2621.T"] = &PriceHistory{Currency: "JPY", Points: []PricePoint{dbar(2026, 10, 23, 950), dbar(2026, 10, 30, 960)}}
		return m
	}
	f.s.fxNowFor = func(c string) float64 { return map[string]float64{"JPY": testJPY}[c] }
	f.s.fxAtFor = func(c string, fb float64) func(time.Time) float64 {
		return func(time.Time) float64 { return 8.2 }
	}
	if _, err := f.s.Backfill(3); err != nil {
		t.Fatal(err)
	}
	var pos models.DailyPositionSnapshot
	if err := f.db.Where("asset_id = ? AND date = ?", jp.ID, "2026-10-30").First(&pos).Error; err != nil {
		t.Fatal(err)
	}
	if pos.FxRate != 8.2 || !dnear(pos.ValueKRW, 100*960*8.2) || !dnear(pos.CostKRW, 100*950*8.2) {
		t.Fatalf("추정 엔화 포지션 = %+v", pos)
	}
}

// 예전에 달러 환율로 저장된 엔화 포지션을 바로잡는다 (합계도), 두 번 불러도 같다
func TestRepairForeignFx(t *testing.T) {
	f := newDailyFixture(t)
	jp := models.Asset{Ticker: "2621.T", Name: "미국채20년엔화헷지ETF", Type: models.AssetTypeETF}
	f.db.Create(&jp)
	wrongV, wrongC := 100*961*1400.0, 100*950*1400.0
	f.db.Create(&models.DailyAssetSnapshot{Date: "2026-10-29", TotalKRW: 400000 + wrongV, CostKRW: 350000 + wrongC, LiquidKRW: wrongV, RestrictedKRW: 400000, UsdKrw: 1400})
	f.db.Create(&models.DailyPositionSnapshot{Date: "2026-10-29", AccountID: f.accA.ID, AssetID: jp.ID, Quantity: 100, Price: 961, Currency: "JPY", FxRate: 1400, ValueKRW: wrongV, CostKRW: wrongC})
	f.db.Create(&models.DailyPositionSnapshot{Date: "2026-10-29", AccountID: f.accB.ID, AssetID: f.kr.ID, Quantity: 5, Price: 80000, Currency: "KRW", FxRate: 1, ValueKRW: 400000, CostKRW: 350000})
	f.s.fxNowFor = func(c string) float64 { return map[string]float64{"JPY": testJPY}[c] }
	f.s.fxAtFor = func(c string, fb float64) func(time.Time) float64 { return func(time.Time) float64 { return 8.3 } }

	for i := 0; i < 2; i++ {
		if err := f.s.repairForeignFx(); err != nil {
			t.Fatal(err)
		}
		r := f.row(t, "2026-10-29")
		good := 100 * 961 * 8.3
		if !dnear(r.TotalKRW, 400000+good) || !dnear(r.CostKRW, 350000+100*950*8.3) || !dnear(r.LiquidKRW, good) || !dnear(r.RestrictedKRW, 400000) {
			t.Fatalf("%d회차 합계 = %+v", i+1, r)
		}
		var pos models.DailyPositionSnapshot
		f.db.Where("asset_id = ?", jp.ID).First(&pos)
		if pos.FxRate != 8.3 || !dnear(pos.ValueKRW, good) {
			t.Fatalf("%d회차 포지션 = %+v", i+1, pos)
		}
	}
}

// 월별: 엔화 스냅샷 행은 그달 환율로 원화로 바꿔 돌려준다 (화면은 원화·달러만 환산)
func TestMonthlySnapshotJPYToKRW(t *testing.T) {
	db := newDailyDB(t)
	if err := db.AutoMigrate(&models.PortfolioSnapshot{}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 13, 12, 0, 0, 0, kst)
	db.Create(&models.PortfolioSnapshot{AccountID: 1, AssetID: 9, Year: 2026, Month: 11, Quantity: 100, Price: 961, MarketValue: 96100, Currency: "JPY"})
	db.Create(&models.PortfolioSnapshot{AccountID: 1, AssetID: 2, Year: 2026, Month: 11, Quantity: 2, Price: 190, MarketValue: 380, Currency: "USD"})
	s := NewPortfolioSnapshotService(db, nil)
	s.fxLookup = func(c string) func(time.Time) float64 {
		return func(time.Time) float64 { return map[string]float64{"JPY": testJPY}[c] }
	}
	out, err := s.getMonthlySummary(1, now)
	if err != nil {
		t.Fatal(err)
	}
	var krw, usd float64
	for _, r := range out {
		switch r.Currency {
		case "KRW":
			krw += r.TotalValue
		case "USD":
			usd += r.TotalValue
		default:
			t.Fatalf("원화·달러가 아닌 행이 남았다: %+v", r)
		}
	}
	if math.Abs(krw-96100*testJPY) > 1e-6 || usd != 380 {
		t.Fatalf("krw %v usd %v", krw, usd)
	}
	rows, _ := s.GetSnapshotsByAccountAndAsset(1, 9)
	if len(rows) != 1 || rows[0].Currency != "KRW" || math.Abs(rows[0].MarketValue-96100*testJPY) > 1e-6 || math.Abs(rows[0].Price-961*testJPY) > 1e-9 {
		t.Fatalf("계좌·종목 행 = %+v", rows)
	}
}
