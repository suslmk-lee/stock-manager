package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newDailyDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.Transaction{},
		&models.Dividend{}, &models.DailyAssetSnapshot{}, &models.DailyPositionSnapshot{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func utcDay(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func dbar(y int, m time.Month, d int, c float64) PricePoint {
	return PricePoint{Time: utcDay(y, m, d).Unix(), Close: c}
}

type dailyFixture struct {
	s        *DailySnapshotService
	db       *gorm.DB
	accA     models.Account
	accB     models.Account
	aapl, kr models.Asset
}

// 2026-10-31(토) 12:00 KST 를 "현재"로 둔 픽스처.
func newDailyFixture(t *testing.T) *dailyFixture {
	t.Helper()
	db := newDailyDB(t)
	f := &dailyFixture{db: db}
	f.accA = models.Account{Name: "일반", AccountType: models.AccountTypeGeneral}
	f.accB = models.Account{Name: "연금", AccountType: models.AccountTypePension}
	f.aapl = models.Asset{Ticker: "AAPL", Name: "Apple", Type: models.AssetTypeStock}
	f.kr = models.Asset{Ticker: "005930.KS", Name: "삼성전자", Type: models.AssetTypeStock}
	for _, v := range []interface{}{&f.accA, &f.accB, &f.aapl, &f.kr} {
		if err := db.Create(v).Error; err != nil {
			t.Fatal(err)
		}
	}
	db.Create(&models.Holding{AccountID: f.accA.ID, AssetID: f.aapl.ID, Quantity: 10, AveragePrice: 100})
	db.Create(&models.Holding{AccountID: f.accB.ID, AssetID: f.kr.ID, Quantity: 5, AveragePrice: 70000})
	// AAPL 4주를 10/28 에 매수 → 그 전에는 6주
	db.Create(&models.Transaction{AccountID: f.accA.ID, AssetID: f.aapl.ID, Type: models.TransactionTypeBuy,
		Date: utcDay(2026, 10, 28), Price: 100, Quantity: 4})
	// 10/29 수령 배당 10 USD, 세금 1.5
	db.Create(&models.Dividend{AccountID: f.accA.ID, AssetID: f.aapl.ID, Date: utcDay(2026, 10, 29),
		Amount: 10, Tax: 1.5, Currency: "USD", IsReceived: true})
	// 미수령 배당은 제외돼야 한다
	db.Create(&models.Dividend{AccountID: f.accA.ID, AssetID: f.aapl.ID, Date: utcDay(2026, 10, 27),
		Amount: 99, Currency: "USD", IsReceived: false})

	s := NewDailySnapshotService(db, nil)
	s.now = func() time.Time { return time.Date(2026, 10, 31, 12, 0, 0, 0, kst) }
	s.fetchFxNow = func() float64 { return 1500 }
	s.fetchFxHist = func() *PriceHistory {
		return &PriceHistory{Currency: "KRW", Points: []PricePoint{dbar(2026, 10, 23, 1300), dbar(2026, 10, 28, 1400)}}
	}
	s.fetchPrices = func(tk []string) map[string]*CurrentPrice {
		return map[string]*CurrentPrice{
			"AAPL":      {Symbol: "AAPL", Price: 150, Currency: "USD"},
			"005930.KS": {Symbol: "005930.KS", Price: 80000, Currency: "KRW"},
		}
	}
	s.fetchHistorys = func(tk []string, r string) map[string]*PriceHistory {
		return map[string]*PriceHistory{
			"AAPL": {Currency: "USD", Points: []PricePoint{
				dbar(2026, 10, 23, 105), dbar(2026, 10, 26, 110), dbar(2026, 10, 27, 115),
				dbar(2026, 10, 28, 120), dbar(2026, 10, 29, 130), dbar(2026, 10, 30, 140)}},
			"005930.KS": {Currency: "KRW", Points: []PricePoint{dbar(2026, 10, 23, 70000), dbar(2026, 10, 30, 72000)}},
		}
	}
	f.s = s
	return f
}

func (f *dailyFixture) row(t *testing.T, date string) models.DailyAssetSnapshot {
	t.Helper()
	var r models.DailyAssetSnapshot
	if err := f.db.Where("date = ?", date).First(&r).Error; err != nil {
		t.Fatalf("%s 행 없음: %v", date, err)
	}
	return r
}

func dnear(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func TestCaptureReplacesEstimatedAndIsIdempotent(t *testing.T) {
	f := newDailyFixture(t)
	f.db.Create(&models.DailyAssetSnapshot{Date: "2026-10-31", TotalKRW: 1, Estimated: true, Source: "estimate"})

	snap, err := f.s.CaptureToday("manual")
	if err != nil {
		t.Fatal(err)
	}
	wantTotal := 10*150*1500.0 + 5*80000.0
	if !dnear(snap.TotalKRW, wantTotal) || snap.Estimated || snap.Source != "manual" {
		t.Fatalf("capture: %+v", snap)
	}
	if !dnear(snap.RestrictedKRW, 400000) || !dnear(snap.LiquidKRW, 10*150*1500) {
		t.Fatalf("liquid/restricted: %+v", snap)
	}
	if !dnear(snap.CostKRW, 10*100*1500+5*70000) {
		t.Fatalf("cost: %v", snap.CostKRW)
	}
	// 배당: 8.5 USD × 10/29 환율(1400)
	if !dnear(snap.DividendsCumKRW, 8.5*1400) {
		t.Fatalf("dividends: %v", snap.DividendsCumKRW)
	}

	// 재실행해도 1행/2포지션
	if _, err := f.s.CaptureToday("cron"); err != nil {
		t.Fatal(err)
	}
	var n, pn int64
	f.db.Model(&models.DailyAssetSnapshot{}).Where("date = ?", "2026-10-31").Count(&n)
	f.db.Model(&models.DailyPositionSnapshot{}).Where("date = ?", "2026-10-31").Count(&pn)
	if n != 1 || pn != 2 {
		t.Fatalf("rows=%d positions=%d", n, pn)
	}
	if r := f.row(t, "2026-10-31"); r.Source != "cron" || r.Estimated {
		t.Fatalf("%+v", r)
	}

	// EnsureToday 는 실측 행이 있으면 건너뜀
	if created, _ := f.s.EnsureToday("startup"); created {
		t.Fatal("이미 실측이 있는데 재캡처됨")
	}
}

func TestCaptureFallsBackToStoredPriceOnFailure(t *testing.T) {
	f := newDailyFixture(t)
	f.db.Create(&models.DailyPositionSnapshot{Date: "2026-10-30", AccountID: f.accA.ID, AssetID: f.aapl.ID, Price: 140, Currency: "USD"})
	f.s.fetchPrices = func([]string) map[string]*CurrentPrice { return map[string]*CurrentPrice{} }
	snap, err := f.s.CaptureToday("manual")
	if err != nil {
		t.Fatal(err)
	}
	// AAPL 은 저장된 140 이월, 005930.KS 는 0
	if !dnear(snap.TotalKRW, 10*140*1500) {
		t.Fatalf("total=%v", snap.TotalKRW)
	}
}

func TestBackfillEstimation(t *testing.T) {
	f := newDailyFixture(t)
	f.db.Create(&models.DailyAssetSnapshot{Date: "2026-10-28", TotalKRW: 777, Source: "cron"}) // 실측

	n, err := f.s.Backfill(6) // 10/25 ~ 10/30
	if err != nil {
		t.Fatal(err)
	}
	if n != 5 {
		t.Fatalf("inserted=%d", n)
	}
	// 실측 보존
	if r := f.row(t, "2026-10-28"); r.TotalKRW != 777 || r.Estimated {
		t.Fatalf("실측 덮어씀: %+v", r)
	}
	// 일요일 10/25: AAPL 6주(거래 전) × 금요일 종가 105 × FX 1300 + 삼성 5 × 70000
	r := f.row(t, "2026-10-25")
	if !r.Estimated || r.Source != "estimate" {
		t.Fatalf("%+v", r)
	}
	if !dnear(r.TotalKRW, 6*105*1300+5*70000) {
		t.Fatalf("10/25 total=%v", r.TotalKRW)
	}
	if !dnear(r.RestrictedKRW, 350000) || !dnear(r.LiquidKRW, 6*105*1300) || r.DividendsCumKRW != 0 {
		t.Fatalf("%+v", r)
	}
	// 10/27: 아직 6주 (매수는 10/28)
	if r := f.row(t, "2026-10-27"); !dnear(r.TotalKRW, 6*115*1300+5*70000) {
		t.Fatalf("10/27 total=%v", r.TotalKRW)
	}
	// 10/29: 10주, FX 1400, 누적 배당 (10-1.5)×1400, 원가 = 6주×(현재 평단 100×1400) 대신
	// 정방향 재생: 매수 4주만 알려져 있으므로 4주 원가 400×1400 + 잔여 6주 100×1400
	r = f.row(t, "2026-10-29")
	if !dnear(r.TotalKRW, 10*130*1400+5*70000) {
		t.Fatalf("10/29 total=%v", r.TotalKRW)
	}
	if !dnear(r.DividendsCumKRW, 8.5*1400) {
		t.Fatalf("dividends=%v", r.DividendsCumKRW)
	}
	if !dnear(r.CostKRW, 4*100*1400+6*100*1400+5*70000) {
		t.Fatalf("cost=%v", r.CostKRW)
	}
	// 10/30: 삼성 새 종가 72000
	if r := f.row(t, "2026-10-30"); !dnear(r.TotalKRW, 10*140*1400+5*72000) {
		t.Fatalf("10/30 total=%v", r.TotalKRW)
	}

	// 멱등: 재실행 시 추가 없음
	if n, _ := f.s.Backfill(6); n != 0 {
		t.Fatalf("재실행 inserted=%d", n)
	}
	var cnt int64
	f.db.Model(&models.DailyAssetSnapshot{}).Count(&cnt)
	if cnt != 6 {
		t.Fatalf("rows=%d", cnt)
	}
}

func TestBackfillSkippedWhileRunning(t *testing.T) {
	f := newDailyFixture(t)
	f.s.running.Store(true)
	if n, err := f.s.Backfill(6); n != 0 || err != nil {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if f.s.BackfillAsync(6) {
		t.Fatal("실행 중인데 시작됨")
	}
}

func TestBuildSeriesWeeklyPicksLastOfISOWeek(t *testing.T) {
	mk := func(d string, v float64, est bool) models.DailyAssetSnapshot {
		return models.DailyAssetSnapshot{Date: d, TotalKRW: v, Estimated: est}
	}
	rows := []models.DailyAssetSnapshot{
		mk("2026-10-25", 1, true), // 일요일: 43주차
		mk("2026-10-26", 2, true), mk("2026-10-27", 3, true), mk("2026-11-01", 4, false), // 44주차 (월~일)
		mk("2026-11-02", 5, false), // 45주차
	}
	got := buildSeries(rows, "all", "week")
	var dates []string
	for _, p := range got.Points {
		dates = append(dates, p.Date)
	}
	want := []string{"2026-10-25", "2026-11-01", "2026-11-02"}
	if len(dates) != 3 || dates[0] != want[0] || dates[1] != want[1] || dates[2] != want[2] {
		t.Fatalf("dates=%v", dates)
	}
	if got.RealCount != 2 || got.EstimatedCount != 1 || got.LastRealDate != "2026-11-02" || got.FirstDate != "2026-10-25" {
		t.Fatalf("%+v", got)
	}
	if d := buildSeries(rows, "all", "day"); len(d.Points) != 5 {
		t.Fatalf("day points=%d", len(d.Points))
	}
	// NaN 정리
	rows[0].TotalKRW = math.NaN()
	if p := buildSeries(rows, "all", "day").Points[0]; p.TotalKRW != 0 {
		t.Fatal("NaN 미정리")
	}
}

func TestGetSeriesRangeAndAutoInterval(t *testing.T) {
	f := newDailyFixture(t)
	for _, d := range []string{"2026-07-01", "2026-09-15", "2026-10-20", "2026-10-21", "2025-01-01"} {
		f.db.Create(&models.DailyAssetSnapshot{Date: d, TotalKRW: 10})
	}
	s1, err := f.s.GetSeries("1m", "auto") // 2026-10-01 ~
	if err != nil || s1.Interval != "day" || len(s1.Points) != 2 {
		t.Fatalf("%+v %v", s1, err)
	}
	s2, _ := f.s.GetSeries("6m", "auto") // 주 단위: 10-20/21 는 같은 주 → 1점
	if s2.Interval != "week" || len(s2.Points) != 3 {
		t.Fatalf("%+v", s2)
	}
	s3, _ := f.s.GetSeries("all", "day")
	if len(s3.Points) != 5 || s3.Points[0].Date != "2025-01-01" {
		t.Fatalf("%+v", s3)
	}
	if s, _ := f.s.GetSeries("2y", "auto"); len(s.Points) == 0 {
		t.Fatal("2y empty")
	}
	if _, err := f.s.GetSeries("7d", "auto"); err == nil {
		t.Fatal("잘못된 range 허용")
	}
}
