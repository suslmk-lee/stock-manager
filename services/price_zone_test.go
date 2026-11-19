package services

import (
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// zoneSeries: 2020-01-01 부터 하루 간격 종가
func zoneSeries(n int, f func(i int) float64) []PricePoint {
	t0 := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Unix()
	out := make([]PricePoint, n)
	for i := range out {
		out[i] = PricePoint{Time: t0 + int64(i)*86400, Close: f(i)}
	}
	return out
}

// 2년 주기로 오르내리는 가격 (100 ± 20): 바닥(i = 375 + 500k)에서 산 날은 1년 뒤 꼭대기 근처
func zoneWave(i int) float64 { return 100 + 20*math.Sin(2*math.Pi*float64(i)/500) }

// 분기마다 주당 1 배당 (연 4)
func zoneDivs(n int) []DividendEvent {
	t0 := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Unix()
	var out []DividendEvent
	for d := 45; d < n; d += 91 {
		out = append(out, DividendEvent{Time: t0 + int64(d)*86400, Amount: 1})
	}
	return out
}

func TestComputeZone(t *testing.T) {
	// 바닥에서 끝나는 파동: 1년·3년 최저 → 아주 좋은 가격, 배당률도 지난 중 가장 높음, 과거에 싸게 산 날은 통함, 아직 내려가는 중
	n := 1376
	z, ok := computeZone("JEPI", zoneSeries(n, zoneWave), zoneDivs(n))
	if !ok {
		t.Fatal("계산 안 됨")
	}
	if z.Currency != "USD" || z.Pos1y != 0 || z.Pos3y != 0 || z.Level != models.ZoneLevelGreat || math.Abs(z.Price-80) > 0.01 {
		t.Fatalf("가격 위치 = %+v", z)
	}
	if !(z.Great < z.Good && z.Good < z.Mid) || z.Great < 80 || z.Low1y != z.Price || math.Abs(z.High1y-120) > 0.01 {
		t.Fatalf("가격대 = 아주 %v · 좋은 %v · 중간 %v · 1년 %v~%v", z.Great, z.Good, z.Mid, z.Low1y, z.High1y)
	}
	if math.Abs(z.Yield-5) > 0.01 || z.YieldPos < 95 || z.YieldGoodPrice <= z.Price {
		t.Fatalf("배당률 %v · 위치 %v · 배당률 높은 가격 %v", z.Yield, z.YieldPos, z.YieldGoodPrice)
	}
	if !z.Falling || z.FromLow20 > 0 || z.MA20 <= z.Price {
		t.Fatalf("흐름 = 내려가는 중 %v · 20일 저점 대비 %v · 20일선 %v", z.Falling, z.FromLow20, z.MA20)
	}
	if z.Verdict != models.ZoneVerdictWorks || z.CheapEpisodes < 2 || z.CheapDays < zoneMinCheapDays || z.CheapAvg <= z.AllAvg || z.CheapWin < 90 {
		t.Fatalf("자기 검증 = %s · 싼 날 %d(%d구간) 평균 %v 승률 %v · 전체 %v", z.Verdict, z.CheapDays, z.CheapEpisodes, z.CheapAvg, z.CheapWin, z.AllAvg)
	}
	if z.Score < 98 {
		t.Fatalf("가격 매력 = %v (가격 100 × 0.7 + 배당률 위치 × 0.3)", z.Score)
	}

	// 꼭대기에서 끝나면 비싼 편
	hi, _ := computeZone("JEPI", zoneSeries(1126, zoneWave), zoneDivs(1126))
	if hi.Level != models.ZoneLevelHigh || hi.Pos1y != 100 || hi.Falling || hi.Score > 5 {
		t.Fatalf("꼭대기 = %+v", hi)
	}

	// 계속 내려가는 종목: 매일 1년 최저라 싸 보이지만 1년 뒤는 늘 손해 → 안 통함, 가격 매력 절반
	trap, _ := computeZone("NKE", zoneSeries(1000, func(i int) float64 { return 200 * math.Pow(0.999, float64(i)) }), nil)
	if trap.Verdict != models.ZoneVerdictTrap || trap.CheapAvg >= 0 || trap.Level != models.ZoneLevelGreat || math.Abs(trap.Score-50) > 0.01 || trap.Yield != 0 || trap.YieldPos != -1 {
		t.Fatalf("함정 = %s · 평균 %v · 가격 매력 %v · 배당 %v/%v", trap.Verdict, trap.CheapAvg, trap.Score, trap.Yield, trap.YieldPos)
	}

	// 국내 종목은 원 단위, 1년이 안 되면 계산하지 않는다
	kr, _ := computeZone("005930.KS", zoneSeries(800, func(i int) float64 { return 60000 + 100*float64(i%300) }), nil)
	if kr.Currency != "KRW" || kr.Good != math.Round(kr.Good) || kr.Verdict != models.ZoneVerdictFew {
		t.Fatalf("국내 = %+v", kr)
	}
	if _, ok := computeZone("NEW", zoneSeries(200, zoneWave), nil); ok {
		t.Fatal("1년 미만은 계산하지 않아야 한다")
	}
}

type zoneFixture struct {
	svc   *PriceZoneService
	db    *gorm.DB
	now   time.Time
	data  map[string][]PricePoint
	calls int
	mu    sync.Mutex
}

func newZoneFixture(t *testing.T) *zoneFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.PriceZone{}, &models.SignalEvent{}); err != nil {
		t.Fatal(err)
	}
	f := &zoneFixture{db: db, data: map[string][]PricePoint{}}
	f.svc = NewPriceZoneService(db, nil)
	f.svc.now = func() time.Time { return f.now }
	f.svc.fetch = func(ticker string) (*PriceHistory, []DividendEvent, error) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls++
		pts := f.data[ticker]
		return &PriceHistory{Symbol: ticker, Points: pts}, zoneDivs(len(pts)), nil
	}
	return f
}

func (f *zoneFixture) hold(t *testing.T, ticker string, qty float64) models.Asset {
	t.Helper()
	a := models.Asset{Ticker: ticker, Name: ticker + " 이름", Type: models.AssetTypeETF}
	if err := f.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&models.Holding{AccountID: 1, AssetID: a.ID, Quantity: qty, AveragePrice: 50}).Error; err != nil {
		t.Fatal(err)
	}
	return a
}

// 백그라운드 계산 → 날짜별 저장(같은 날은 덮어씀, 30일 지난 기록은 지움) → 좋은 가격대에 새로 들어오면 한 번 알림
func TestPriceZoneRefreshAndAlerts(t *testing.T) {
	f := newZoneFixture(t)
	f.db.Create(&models.Account{Name: "토스증권", Broker: "토스증권"})
	jepi := f.hold(t, "JEPI", 10)
	f.hold(t, "FUND:ABC", 100) // 펀드는 빼고
	f.hold(t, "SOLD", 0)       // 다 판 종목도 빼고
	newco := f.hold(t, "NEWCO", 3)
	f.data["JEPI"] = zoneSeries(1126, zoneWave) // 꼭대기 (비싼 편)
	f.data["NEWCO"] = zoneSeries(100, zoneWave)  // 1년 미만 → 기록 없음

	// 지난 기록: 40일 전은 지우고 29일 전은 남긴다
	f.db.Create(&models.PriceZone{AssetID: jepi.ID, Date: "2026-10-10", Level: models.ZoneLevelHigh})
	f.db.Create(&models.PriceZone{AssetID: jepi.ID, Date: "2026-10-21", Level: models.ZoneLevelHigh})

	f.now = time.Date(2026, 11, 19, 1, 0, 0, 0, time.UTC) // 11/19 10:00 KST
	if ran, err := f.svc.RefreshIfStale(); err != nil || !ran {
		t.Fatalf("첫 계산 = %v %v", ran, err)
	}
	if f.calls != 2 {
		t.Fatalf("이력 요청 = %d (JEPI·NEWCO)", f.calls)
	}
	var dates []string
	f.db.Model(&models.PriceZone{}).Where("asset_id = ?", jepi.ID).Order("date").Pluck("date", &dates)
	if strings.Join(dates, ",") != "2026-10-21,2026-11-19" {
		t.Fatalf("남은 날짜 = %v", dates)
	}

	// 4시간 안에는 다시 계산하지 않는다 (앱과 서버가 같은 DB)
	f.now = f.now.Add(3 * time.Hour)
	if ran, _ := f.svc.RefreshIfStale(); ran || f.calls != 2 {
		t.Fatalf("새 기록이 있는데 다시 계산함 (%d)", f.calls)
	}
	if evs, _ := f.svc.Alerts(true, f.now); len(evs) != 0 {
		t.Fatalf("비싼 편인데 알림 %v", evs)
	}

	// 다음 날: 바닥 → 아주 좋은 가격 (전날은 비싼 편) → 알림 한 번
	f.now = time.Date(2026, 11, 20, 1, 0, 0, 0, time.UTC)
	f.data["JEPI"] = zoneSeries(1376, zoneWave)
	other := f.hold(t, "OTHER", 1) // 처음 계산하는 종목은 바닥이어도 알리지 않는다
	f.data["OTHER"] = zoneSeries(1376, zoneWave)
	if ran, err := f.svc.RefreshIfStale(); err != nil || !ran {
		t.Fatalf("다음 날 계산 = %v %v", ran, err)
	}
	evs, err := f.svc.Alerts(true, f.now)
	if err != nil || len(evs) != 1 {
		t.Fatalf("알림 = %v %v", evs, err)
	}
	ev := evs[0]
	if ev.AssetID != jepi.ID || ev.Kind != models.SignalEventKindZone || ev.ToAction != "ZONE" || ev.ReadAt != nil || ev.Name != "JEPI 이름" ||
		!strings.HasPrefix(ev.Message, "아주 좋은 가격에 들어왔어요 · $80.00") || !strings.Contains(ev.Message, "아직 내려가는 중") {
		t.Fatalf("알림 내용 = %+v", ev)
	}
	if evs, _ := f.svc.Alerts(true, f.now); len(evs) != 0 {
		t.Fatalf("같은 날 또 알림 %v", evs)
	}
	// 같은 날 다시 계산해도(덮어쓰기) 알린 표시는 남는다
	f.now = f.now.Add(5 * time.Hour)
	if ran, _ := f.svc.RefreshIfStale(); !ran {
		t.Fatal("4시간이 지났는데 다시 계산하지 않음")
	}
	var today []models.PriceZone
	f.db.Where("date = ?", "2026-11-20").Order("asset_id").Find(&today)
	if len(today) != 2 || !today[0].Alerted || today[1].Alerted {
		t.Fatalf("오늘 기록 = %+v", today)
	}
	if evs, _ := f.svc.Alerts(true, f.now); len(evs) != 0 {
		t.Fatalf("다시 계산한 뒤 또 알림 %v", evs)
	}

	// 화면: 보유 종목(펀드·다 판 종목 제외) 3개 가운데 계산된 2개, 가격 매력 높은 순 · 종목 상세는 30일 이력
	list, err := f.svc.GetLatest()
	if err != nil || list.Held != 3 || len(list.Rows) != 2 || list.Date != "2026-11-20" || list.UpdatedAt == nil {
		t.Fatalf("목록 = %+v %v", list, err)
	}
	for _, r := range list.Rows {
		if r.AssetID == newco.ID {
			t.Fatal("1년 미만 종목이 목록에 있음")
		}
	}
	if list.Rows[0].Name == "" || list.Rows[0].Score < list.Rows[1].Score {
		t.Fatalf("정렬·이름 = %+v", list.Rows)
	}
	d, err := f.svc.GetAsset(jepi.ID)
	if err != nil || d.Zone == nil || d.Zone.Date != "2026-11-20" || d.Zone.Name != "JEPI 이름" || len(d.History) != 3 || d.History[0].Date != "2026-10-21" {
		t.Fatalf("상세 = %+v %v", d, err)
	}
	if e, _ := f.svc.GetAsset(other.ID); e.Zone == nil || len(e.History) != 1 {
		t.Fatalf("처음 계산한 종목 상세 = %+v", e)
	}

	// 알림이 꺼져 있으면 읽은 상태로 남긴다 · 7일 안에 알린 종목은 다시 알리지 않는다
	f.now = time.Date(2026, 11, 22, 1, 0, 0, 0, time.UTC)
	f.data["JEPI"] = zoneSeries(1126, zoneWave)
	f.svc.Refresh()
	f.now = time.Date(2026, 11, 23, 1, 0, 0, 0, time.UTC)
	f.data["JEPI"] = zoneSeries(1376, zoneWave)
	f.svc.Refresh()
	if evs, _ := f.svc.Alerts(false, f.now); len(evs) != 0 {
		t.Fatalf("7일 안에 다시 알림 %v", evs)
	}
}

func TestCombineAlerts(t *testing.T) {
	a := func(bool, time.Time) ([]models.SignalEvent, error) { return []models.SignalEvent{{Name: "a"}}, nil }
	b := func(bool, time.Time) ([]models.SignalEvent, error) { return []models.SignalEvent{{Name: "b"}}, gorm.ErrInvalidData }
	evs, err := CombineAlerts(a, nil, b)(true, time.Now())
	if len(evs) != 2 || err != gorm.ErrInvalidData {
		t.Fatalf("합친 알림 = %v %v", evs, err)
	}
}
