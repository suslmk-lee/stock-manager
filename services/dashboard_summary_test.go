package services

import (
	"errors"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newDashboardFixture(t *testing.T) (*DashboardService, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Dividend{}); err != nil {
		t.Fatal(err)
	}
	s := NewDashboardService(db, nil, nil, nil, nil)
	s.now = func() time.Time { return dsDay("2026-11-27").Add(12 * time.Hour) }
	return s, db
}

func TestDashboardSummary(t *testing.T) {
	s, db := newDashboardFixture(t)
	acc := models.Account{Name: "토스", Broker: "토스증권", Currency: "USD"}
	db.Create(&acc)
	o := models.Asset{Ticker: "O", Name: "Realty Income", Type: models.AssetTypeStock}
	kr := models.Asset{Ticker: "005930.KS", Name: "삼성전자", Type: models.AssetTypeStock}
	db.Create(&o)
	db.Create(&kr)
	utcDay := func(d string) time.Time { t, _ := time.Parse(dateLayout, d); return t } // 웹은 UTC 자정으로 저장한다
	for _, d := range []models.Dividend{
		{AccountID: acc.ID, AssetID: o.ID, Date: utcDay("2026-11-27"), Amount: 12, Tax: 1.8, Currency: "USD", IsReceived: true},    // 오늘 (세후 10.2)
		{AccountID: acc.ID, AssetID: kr.ID, Date: dsDay("2026-11-27"), Amount: 3610, Currency: "KRW", IsReceived: true},            // 오늘 (KST 자정 저장)
		{AccountID: acc.ID, AssetID: o.ID, Date: utcDay("2026-11-03"), Amount: 5, Tax: 0.75, Currency: "USD", IsReceived: true},    // 이번 달 (세후 4.25)
		{AccountID: acc.ID, AssetID: kr.ID, Date: utcDay("2026-02-15"), Amount: 1000, Tax: 154, Currency: "KRW", IsReceived: true}, // 올해 (세후 846)
		{AccountID: acc.ID, AssetID: o.ID, Date: utcDay("2025-12-31"), Amount: 99, Currency: "USD", IsReceived: true},              // 작년
		{AccountID: acc.ID, AssetID: o.ID, Date: utcDay("2026-11-28"), Amount: 7, Currency: "USD", IsReceived: true},               // 내일 날짜
		{AccountID: acc.ID, AssetID: o.ID, Date: utcDay("2026-11-20"), Amount: 8, Currency: "USD", IsReceived: false},              // 받지 않음
		{AccountID: acc.ID, AssetID: o.ID, Date: utcDay("2026-11-10"), Amount: 100, Currency: "JPY", IsReceived: true},             // 환율 모름 → 합계에서 뺀다
	} {
		db.Create(&d)
	}
	s.series = func() (*DailySeries, error) {
		return &DailySeries{LastRealDate: "2026-11-26", Points: []DailyPoint{
			{Date: "2026-11-24", TotalKRW: 1000000, UsdKrw: 1390},
			{Date: "2026-11-25", TotalKRW: 1010000, CostKRW: 900000, CashKRW: 50000, UsdKrw: 1395},
			{Date: "2026-11-26", TotalKRW: 1030200, CostKRW: 905000, CashKRW: 40000, UsdKrw: 1400},
			{Date: "2026-11-27", TotalKRW: 1100000, UsdKrw: 1410, Estimated: true},
		}}, nil
	}
	var gotUSD float64
	s.upcoming = func(days int, fx func(string) float64) (*UpcomingDividends, error) {
		if days != 30 {
			t.Errorf("days = %d", days)
		}
		gotUSD = fx("USD")
		return &UpcomingDividends{Items: make([]UpcomingDividend, 3), TotalExpectedKRW: 12345}, nil
	}
	s.unread = func() (int64, error) { return 4, nil }
	s.fxNow = func(string) float64 { return 0 }

	r := s.GetSummary()
	if len(r.Errors) != 0 {
		t.Fatalf("errors = %v", r.Errors)
	}
	if r.AsOf != "2026-11-27T12:00:00+09:00" || r.UsdKrw == nil || *r.UsdKrw != 1400 || gotUSD != 1400 {
		t.Fatalf("as_of/usd = %s %v %v", r.AsOf, r.UsdKrw, gotUSD)
	}
	p := r.Portfolio
	if p == nil || p.TotalKRW != 1030200 || p.CostKRW != 905000 || p.CashKRW != 40000 || p.LastRealDate != "2026-11-26" || p.Estimated {
		t.Fatalf("portfolio = %+v", p)
	}
	if p.DayChangeKRW == nil || *p.DayChangeKRW != 20200 || p.DayChangePct == nil || *p.DayChangePct != 2 {
		t.Fatalf("day change = %v %v", p.DayChangeKRW, p.DayChangePct)
	}
	d := r.Dividends
	// 받은 배당은 세후 (기록 금액 − 세금): 오늘 $10.2·3610원, 이번 달 +$4.25, 올해 +846원 (환율 1400)
	if d == nil || len(d.TodayReceived) != 2 || d.TodayReceivedKRW != 14280+3610 {
		t.Fatalf("today = %+v", d)
	}
	for _, x := range d.TodayReceived {
		if x.Ticker == "" || x.AccountName != "토스" || x.AmountKRW == nil {
			t.Fatalf("today item = %+v", x)
		}
		if x.Ticker == "O" && (x.Amount != 10.2 || x.Tax != 1.8 || *x.AmountKRW != 14280) {
			t.Fatalf("세후 금액·세금 = %+v (원화 %v)", x, *x.AmountKRW)
		}
	}
	if d.MtdKRW != 14280+3610+5950 || d.YtdKRW != 14280+3610+5950+846 {
		t.Fatalf("mtd/ytd = %v / %v", d.MtdKRW, d.YtdKRW)
	}
	if d.Upcoming30dCount == nil || *d.Upcoming30dCount != 3 || d.Upcoming30dKRW == nil || *d.Upcoming30dKRW != 12345 {
		t.Fatalf("upcoming = %v %v", d.Upcoming30dCount, d.Upcoming30dKRW)
	}
	if r.Signals == nil || r.Signals.UnreadCount != 4 {
		t.Fatalf("signals = %+v", r.Signals)
	}
}

// 한 칸이 실패해도 나머지는 낸다: 총자산 실패(환율은 시세로) · 신호 실패 · 예정 배당 시간 초과
func TestDashboardSummaryPartialFailure(t *testing.T) {
	s, db := newDashboardFixture(t)
	acc := models.Account{Name: "토스", Broker: "토스증권", Currency: "USD"}
	db.Create(&acc)
	db.Create(&models.Dividend{AccountID: acc.ID, AssetID: 1, Date: dsDay("2026-11-10"), Amount: 10, Currency: "USD", IsReceived: true})
	s.series = func() (*DailySeries, error) { return nil, errors.New("db down") }
	s.unread = func() (int64, error) { return 0, errors.New("no table") }
	s.fxNow = func(ccy string) float64 {
		if ccy == "USD" {
			return 1500
		}
		return 0
	}
	release := make(chan struct{})
	defer close(release)
	s.upcoming = func(int, func(string) float64) (*UpcomingDividends, error) {
		<-release
		return &UpcomingDividends{}, nil
	}
	s.upcomingTimeout = 50 * time.Millisecond

	r := s.GetSummary()
	if r.Portfolio != nil || r.Errors["portfolio"] != "db down" {
		t.Fatalf("portfolio = %+v / %v", r.Portfolio, r.Errors)
	}
	if r.Signals != nil || r.Errors["signals"] != "no table" {
		t.Fatalf("signals = %+v / %v", r.Signals, r.Errors)
	}
	if r.Errors["upcoming"] == "" || r.Dividends == nil || r.Dividends.Upcoming30dCount != nil || r.Dividends.Upcoming30dKRW != nil {
		t.Fatalf("upcoming = %+v / %v", r.Dividends, r.Errors)
	}
	if r.UsdKrw == nil || *r.UsdKrw != 1500 || r.Dividends.MtdKRW != 15000 {
		t.Fatalf("usd/mtd = %v / %v", r.UsdKrw, r.Dividends.MtdKRW)
	}

	// 예정 배당 오류는 그 칸만, 서비스가 없는 칸도 오류로
	s2, _ := newDashboardFixture(t)
	s2.upcoming = func(int, func(string) float64) (*UpcomingDividends, error) { return nil, errors.New("events down") }
	r2 := s2.GetSummary()
	if r2.Errors["upcoming"] != "events down" || r2.Errors["portfolio"] == "" || r2.Errors["signals"] == "" || r2.Dividends == nil || r2.UsdKrw != nil {
		t.Fatalf("r2 = %+v / %v", r2, r2.Errors)
	}
}
