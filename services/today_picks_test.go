package services

import (
	"math"
	"strings"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 마지막 결과: 이번 실행에서 계산한 것, 없으면 DB 에 남긴 것 (앱을 새로 켰을 때) — 3일 안의 것만, 7일 지난 기록은 지운다
func TestTodayPicksCached(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.TodaySnapshot{}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 20, 14, 0, 0, 0, time.UTC) // 11/20 23:00 KST
	clock := func() time.Time { return now }
	s := &TodayService{db: db, now: clock}
	if s.GetTodayPicksCached() != nil {
		t.Fatal("계산한 적 없으면 nil")
	}
	db.Create(&models.TodaySnapshot{Date: "2026-11-10", Data: "{}", ComputedAt: now.AddDate(0, 0, -10)}) // 7일 지나 지워질 기록
	p := &TodayPicks{Date: "2026-11-20", ComputedAt: now, Picks: []TodayPick{{Rank: 1, Ticker: "JEPI"}}}
	s.last = p
	s.saveSnapshot(p)
	if c := s.GetTodayPicksCached(); c != p {
		t.Fatalf("이번 실행 결과 = %+v", c)
	}

	// 앱을 새로 켬 (메모리 비어 있음) → DB 에 남긴 결과, 다음 날이어도 3일 안이면 (계산 시각과 함께)
	now = now.Add(10 * time.Hour) // 11/21 09:00 KST
	r := &TodayService{db: db, now: clock}
	c := r.GetTodayPicksCached()
	if c == nil || c.Date != "2026-11-20" || len(c.Picks) != 1 || c.Picks[0].Ticker != "JEPI" || !c.ComputedAt.Equal(p.ComputedAt) {
		t.Fatalf("다시 켠 뒤 = %+v", c)
	}
	// 같은 날 다시 계산하면 그날 기록을 덮어쓴다
	p2 := &TodayPicks{Date: "2026-11-20", ComputedAt: now, Picks: []TodayPick{{Rank: 1, Ticker: "JEPQ"}}}
	r.saveSnapshot(p2)
	var rows []models.TodaySnapshot
	db.Order("date").Find(&rows)
	if len(rows) != 1 || rows[0].Date != "2026-11-20" {
		t.Fatalf("남은 기록 = %+v (7일 지난 11/10 은 지우고 11/20 은 한 줄)", rows)
	}
	if c := (&TodayService{db: db, now: clock}).GetTodayPicksCached(); c == nil || c.Picks[0].Ticker != "JEPQ" {
		t.Fatalf("덮어쓴 결과 = %+v", c)
	}
	// 3일 넘게 지난 결과는 먼저 보여 주지 않는다
	now = now.Add(80 * time.Hour)
	if c := (&TodayService{db: db, now: clock}).GetTodayPicksCached(); c != nil {
		t.Fatalf("오래된 결과 = %+v", c)
	}
}

// 오늘 살 종목: 가격 매력 30 · 신호 25 · 배당 20 · 비중 10 · 살 돈 15 (배당 점수·가격 매력이 없으면 그 몫은 신호로),
// 매도·막힌·오늘 산·오늘 모으기 종목은 빼고 상위 3개
func TestRankToday(t *testing.T) {
	today := "2026-11-19"
	checks := func(met, total int) []SignalCheck {
		out := make([]SignalCheck, total)
		for i := range out {
			out[i] = SignalCheck{Code: "c", Label: "조건" + string(rune('A'+i)), Met: i < met}
		}
		return out
	}
	acc := func(id uint) []SignalAccountBreakdown { return []SignalAccountBreakdown{{AccountID: id}} }
	items := []SignalItem{
		{AssetID: 1, Ticker: "402970.KS", Name: "ACE 미국배당다우존스", Currency: "KRW", Action: SignalBuy, CurrentPrice: 15455, WeightPct: 4,
			BuyChecks: checks(3, 4), SuggestedBuyKRW: 185460, SuggestedBuyQty: 12, Accounts: acc(1)},
		{AssetID: 2, Ticker: "JEPQ", Name: "JEPQ", Currency: "USD", Action: SignalHold, CurrentPrice: 54.12, WeightPct: 10, BuyMaxWeightPct: 15,
			BuyChecks: checks(2, 4), SuggestedBuyKRW: 200000, Accounts: acc(2)},
		{AssetID: 3, Ticker: "475720.KS", Name: "RISE 200위클리커버드콜", Currency: "KRW", Action: SignalHold, CurrentPrice: 9994, WeightPct: 2,
			BuyChecks: checks(1, 4), SuggestedBuyKRW: 99940, Accounts: acc(3)},
		{AssetID: 4, Ticker: "SPYI", Action: SignalSell, CurrentPrice: 50, BuyChecks: checks(4, 4), Accounts: acc(2)},                             // 매도
		{AssetID: 5, Ticker: "QQQI", Action: SignalBuy, CurrentPrice: 50, BuyChecks: checks(4, 4), BuyExcludedReason: "cooldown", Accounts: acc(2)}, // 쉬는 기간
		{AssetID: 6, Ticker: "GPIQ", Action: SignalBuy, CurrentPrice: 50, BuyChecks: checks(4, 4), LastBuyDate: today, Accounts: acc(2)},         // 오늘 이미 삼
		{AssetID: 7, Ticker: "SCHD", Action: SignalBuy, CurrentPrice: 27, BuyChecks: checks(4, 4), Accounts: acc(2)},                             // 오늘 모으기
		{AssetID: 8, Ticker: "005930.KS", Name: "삼성전자", Currency: "KRW", Action: SignalHold, CurrentPrice: 60000, WeightPct: 30,
			BuyChecks: checks(0, 4), Accounts: acc(1)}, // 점수 낮음
		{AssetID: 9, Ticker: "FUND:XZU9SMKB", Name: "한국벨류10년투자배당", Currency: "KRW", Action: SignalHold, CurrentPrice: 1007, WeightPct: 1,
			BuyChecks: checks(2, 4), SuggestedBuyKRW: 1000, Accounts: acc(4)}, // 예수금 기록 안 하는 토스뱅크
	}
	divRows := map[uint]DivScoreRow{
		1: {AssetID: 1, Score: 80, Rank: 1, Parts: DivScoreParts{Yield: 0.9}},
		2: {AssetID: 2, Score: 70, Rank: 3, Parts: DivScoreParts{Yield: 0.7}},
	}
	// JEPQ 만 가격대 기록이 있다: 좋은 가격 · 과거에 통함 · 아직 내려가는 중
	zones := map[uint]PriceZoneRow{
		2: {PriceZone: models.PriceZone{AssetID: 2, Currency: "USD", Score: 80, Level: models.ZoneLevelGood, Pos1y: 3, Good: 54.5,
			Verdict: models.ZoneVerdictWorks, CheapAvg: 11.7, AllAvg: 7.8, Falling: true, MA20: 57.27}},
	}
	planned := map[uint]bool{7: true}
	accounts := map[uint]models.Account{
		1: {ID: 1, Name: "토스증권", Broker: "토스증권"},
		2: {ID: 2, Name: "Super365", Broker: "메리츠증권", ForeignSettle: models.SettleUSD},
		3: {ID: 3, Name: "종합", Broker: "카카오증권"},
		4: {ID: 4, Name: "토스뱅크", Broker: "토스뱅크", NoCash: true},
	}
	balances := map[uint]CashBalance{1: {KRW: 412300}, 2: {USD: 230.4}, 3: {KRW: 96120}}

	picks, considered := rankToday(items, divRows, zones, planned, accounts, balances, 1400, today)
	if considered != 4 {
		t.Fatalf("점수를 넘긴 종목 = %d (1·2·3·9)", considered)
	}
	got := []uint{}
	for _, p := range picks {
		got = append(got, p.AssetID)
	}
	if len(picks) != 3 || got[0] != 1 || got[1] != 2 || got[2] != 9 {
		t.Fatalf("순서 = %v (1, 2, 9 — 3번은 4위)", got)
	}
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.11 }
	a := picks[0]
	// 가격대 기록 없음 → 신호 25+30=55 · 배당 20×(0.6×0.8+0.4×0.9)=16.8 · 비중 10×(1−4/20)=8 · 살 돈 15 = 94.8
	if a.Rank != 1 || a.Parts.SignalMax != 55 || a.Parts.PriceMax != 0 || !near(a.Parts.Signal, 55) || !near(a.Parts.Dividend, 16.8) || !near(a.Parts.Weight, 8) || !near(a.Parts.Cash, 15) || !near(a.Score, 94.8) || a.Zone != nil {
		t.Fatalf("1위 = %+v", a)
	}
	if a.Account == nil || a.Account.Currency != "KRW" || a.Account.Short != 0 || a.Market != "KR" {
		t.Fatalf("1위 계좌 = %+v", a.Account)
	}
	if len(a.Reasons) == 0 || !strings.HasPrefix(a.Reasons[0], "매수 신호") || !strings.Contains(strings.Join(a.Reasons, "|"), "배당 점수 1위") {
		t.Fatalf("1위 이유 = %v", a.Reasons)
	}
	// JEPQ: 가격 매력 30×0.8=24 · 신호 25×2/4=12.5 · 배당 20×0.7=14 · 비중 10×(1−10/15)=3.3 · 살 돈 15 = 68.8
	j := picks[1]
	if !near(j.Parts.Price, 24) || j.Parts.PriceMax != 30 || j.Parts.SignalMax != 25 || !near(j.Parts.Signal, 12.5) || !near(j.Parts.Dividend, 14) || !near(j.Parts.Weight, 3.3) || !near(j.Score, 68.8) || j.Zone == nil {
		t.Fatalf("JEPQ = %+v (%v)", j.Parts, j.Score)
	}
	reasons := strings.Join(j.Reasons, "|")
	if !strings.Contains(reasons, "1년 중 하위 3% 가격 · 좋은 가격 $54.50 이하") || !strings.Contains(reasons, "이만큼 쌌을 때 1년 뒤 평균 +11.7% (평소 +7.8%)") {
		t.Fatalf("JEPQ 이유 = %v", j.Reasons)
	}
	if j.Warn != "아직 내려가는 중 · 20일선 $57.27 아래" {
		t.Fatalf("JEPQ 주의 = %q", j.Warn)
	}
	// 달러 계좌: 제안 20만 원 ÷ 1,400 = $142.86, 예수금 $230.40 → 충분
	if j.Account == nil || j.Account.Currency != "USD" || !near(j.Account.Need, 142.86) || j.Account.Short != 0 || j.Market != "US" {
		t.Fatalf("JEPQ 계좌 = %+v", j.Account)
	}
	// 배당 점수·가격대 없는 펀드: 신호 75×2/4=37.5 · 비중 10×0.95=9.5 · 예수금 기록 안 함 → 살 돈 만점 = 62
	f := picks[2]
	if f.Parts.SignalMax != 75 || !near(f.Parts.Signal, 37.5) || !near(f.Parts.Cash, 15) || !near(f.Score, 62) || f.Account == nil || !f.Account.NoCash {
		t.Fatalf("펀드 = %+v %+v", f.Parts, f.Account)
	}
	// 싸 보여도 과거에 안 통한 종목은 주의
	trap := &PriceZoneRow{PriceZone: models.PriceZone{Currency: "USD", Level: models.ZoneLevelGood, Pos1y: 2, Verdict: models.ZoneVerdictTrap, CheapAvg: -8.6, AllAvg: 0.4, Falling: true}}
	if w := zoneWarn(trap); w != "싸게 사도 과거엔 1년 뒤 평균 -8.6% (평소 +0.4%)" {
		t.Fatalf("함정 주의 = %q", w)
	}
	if w := zoneWarn(&PriceZoneRow{PriceZone: models.PriceZone{Level: models.ZoneLevelHigh, Pos1y: 90, Falling: true}}); w != "" {
		t.Fatalf("비싼 종목은 주의 없음: %q", w)
	}
	// 예수금이 모자라면 모자란 금액
	only3, _ := rankToday(items[2:3], nil, nil, nil, accounts, balances, 1400, today)
	if len(only3) != 1 || only3[0].Account == nil || !near(only3[0].Account.Short, 3820) {
		t.Fatalf("모자란 금액 = %+v", only3)
	}
}
