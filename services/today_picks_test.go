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

// 오늘 살 종목: 보유 종목 전체 순위 = 가격 매력 70 · 신호 15 · 배당 10 · 비중 5 (예수금은 점수에 안 넣음, 없는 항목은 0),
// Top 3 는 그 순위에서 매도·충돌·막힌·오늘 산·오늘 모으기·점수 낮은 종목을 건너뛴 앞의 3개
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
		{AssetID: 5, Ticker: "QQQI", Action: SignalBuy, CurrentPrice: 50, BuyChecks: checks(4, 4), BuyExcludedReason: "cooldown", Accounts: acc(2)}, // 쉬는 기간 — 빼지 않음
		{AssetID: 6, Ticker: "GPIQ", Action: SignalBuy, CurrentPrice: 50, BuyChecks: checks(4, 4), LastBuyDate: today, Accounts: acc(2)},         // 오늘 이미 삼
		{AssetID: 7, Ticker: "SCHD", Action: SignalBuy, CurrentPrice: 27, BuyChecks: checks(4, 4), Accounts: acc(2)},                             // 오늘 모으기
		{AssetID: 8, Ticker: "005930.KS", Name: "삼성전자", Currency: "KRW", Action: SignalHold, CurrentPrice: 60000, WeightPct: 30,
			BuyChecks: checks(0, 4), Accounts: acc(1)}, // 신호·비중은 0 이지만 가격 매력이 높다
		{AssetID: 9, Ticker: "FUND:XZU9SMKB", Name: "한국벨류10년투자배당", Currency: "KRW", Action: SignalHold, CurrentPrice: 1007, WeightPct: 1,
			BuyChecks: checks(2, 4), SuggestedBuyKRW: 1000, Accounts: acc(4)}, // 예수금 기록 안 하는 토스뱅크
	}
	divRows := map[uint]DivScoreRow{
		1: {AssetID: 1, Score: 80, Rank: 1, Parts: DivScoreParts{Yield: 0.9}},
		2: {AssetID: 2, Score: 70, Rank: 3, Parts: DivScoreParts{Yield: 0.7}},
	}
	// 가격대 기록: JEPQ (좋은 가격 · 과거에 통함 · 아직 내려가는 중), 삼성전자 (가격 매력 50)
	zones := map[uint]PriceZoneRow{
		2: {PriceZone: models.PriceZone{AssetID: 2, Currency: "USD", Score: 80, Expect: 24, Level: models.ZoneLevelGood, Pos1y: 3, Good: 54.5,
			Verdict: models.ZoneVerdictWorks, CheapAvg: 35, AllAvg: 10, Falling: true, MA20: 57.27, CheapDays: 120}},
		8: {PriceZone: models.PriceZone{AssetID: 8, Currency: "KRW", Score: 50, Expect: 15, Level: models.ZoneLevelFair, Pos1y: 40, Good: 55000, Verdict: models.ZoneVerdictWorks, CheapAvg: 40, AllAvg: 20, CheapDays: 90}},
	}
	planned := map[uint]bool{7: true}
	accounts := map[uint]models.Account{
		1: {ID: 1, Name: "토스증권", Broker: "토스증권"},
		2: {ID: 2, Name: "Super365", Broker: "메리츠증권", ForeignSettle: models.SettleUSD},
		3: {ID: 3, Name: "종합", Broker: "카카오증권"},
		4: {ID: 4, Name: "토스뱅크", Broker: "토스뱅크", NoCash: true},
	}
	balances := map[uint]CashBalance{1: {KRW: 412300}, 2: {USD: 230.4}, 3: {KRW: 96120}}

	picks, rows := rankToday(items, divRows, zones, planned, accounts, balances, 1400, today)
	near := func(a, b float64) bool { return math.Abs(a-b) < 0.11 }
	// 전체 순위: JEPQ 72.2 · 삼성전자 35 · ACE 27.4 · (20점: 매도·쉬는 기간(빼지 않음)·오늘 산·오늘 모으기) · 펀드 12.3 · RISE 8.3
	var order, excluded []string
	for _, r := range rows {
		order = append(order, r.Ticker)
		excluded = append(excluded, r.Excluded)
	}
	if strings.Join(order, ",") != "JEPQ,005930.KS,402970.KS,SPYI,QQQI,GPIQ,SCHD,FUND:XZU9SMKB,475720.KS" {
		t.Fatalf("순위 = %v", order)
	}
	if strings.Join(excluded, ",") != ",,,sell,,bought_today,planned,low_score,low_score" {
		t.Fatalf("뺀 이유 = %v", excluded)
	}
	for i, r := range rows {
		if r.Rank != i+1 || (i < 3) != (r.Pick == i+1) {
			t.Fatalf("%d번째 줄 = 순위 %d, Top 3 %d", i, r.Rank, r.Pick)
		}
	}
	// Top 3 = 순위에서 뺄 이유가 없는 앞의 3개 (위·아래가 같은 점수)
	if len(picks) != 3 || picks[0].AssetID != 2 || picks[1].AssetID != 8 || picks[2].AssetID != 1 || picks[0].Score != rows[0].Score {
		t.Fatalf("Top 3 = %+v", picks)
	}
	// JEPQ: 가격 매력 70×0.8=56 · 신호 15×2/4=7.5 · 배당 10×0.7=7 · 비중 5×(1−10/15)=1.7 = 72.2
	j := picks[0]
	if !near(j.Parts.Price, 56) || j.Parts.PriceMax != 70 || j.Parts.SignalMax != 15 || !near(j.Parts.Signal, 7.5) || !near(j.Parts.Dividend, 7) || !near(j.Parts.Weight, 1.7) || !near(j.Score, 72.2) || j.Zone == nil || j.Rank != 1 {
		t.Fatalf("JEPQ = %+v (%v)", j.Parts, j.Score)
	}
	if r := rows[0]; !r.HasZone || r.Expect != 24 || r.Level != models.ZoneLevelGood || !r.Falling {
		t.Fatalf("JEPQ 줄 = %+v", r)
	}
	reasons := strings.Join(j.Reasons, "|")
	if !strings.Contains(reasons, "과거 기준 1년 뒤 평소보다 +24.0%p (싸게 산 날 +35.0% · 평소 +10.0%)") || !strings.Contains(reasons, "1년 중 하위 3% 가격 · 좋은 가격 $54.50 이하") {
		t.Fatalf("JEPQ 이유 = %v", j.Reasons)
	}
	if j.Warn != "아직 내려가는 중 · 20일선 $57.27 아래" {
		t.Fatalf("JEPQ 주의 = %q", j.Warn)
	}
	// 달러 계좌: 제안 20만 원 ÷ 1,400 = $142.86, 예수금 $230.40 → 충분 (예수금은 점수에 안 들어감)
	if j.Account == nil || j.Account.Currency != "USD" || !near(j.Account.Need, 142.86) || j.Account.Short != 0 || j.Market != "US" {
		t.Fatalf("JEPQ 계좌 = %+v", j.Account)
	}
	// 삼성전자: 가격 매력만 70×0.5=35 (신호 0 · 배당 없음 0 · 비중 30% 라 0)
	if sm := picks[1]; !near(sm.Score, 35) || !near(sm.Parts.Price, 35) || sm.Parts.Dividend != 0 || sm.Parts.DividendMax != 10 {
		t.Fatalf("삼성전자 = %+v (%v)", sm.Parts, sm.Score)
	}
	// ACE: 가격대 기록 없음 → 가격 매력 0 (다른 항목으로 넘기지 않는다) · 신호 15 · 배당 10×0.84=8.4 · 비중 5×0.8=4 = 27.4
	a := picks[2]
	if a.Parts.PriceMax != 70 || a.Parts.Price != 0 || !near(a.Parts.Signal, 15) || !near(a.Parts.Dividend, 8.4) || !near(a.Parts.Weight, 4) || !near(a.Score, 27.4) || a.Zone != nil {
		t.Fatalf("ACE = %+v (%v)", a.Parts, a.Score)
	}
	if a.Account == nil || a.Account.Currency != "KRW" || a.Account.Short != 0 || a.Market != "KR" {
		t.Fatalf("ACE 계좌 = %+v", a.Account)
	}
	if len(a.Reasons) == 0 || !strings.HasPrefix(a.Reasons[0], "매수 신호") || !strings.Contains(strings.Join(a.Reasons, "|"), "배당 점수 1위") {
		t.Fatalf("ACE 이유 = %v", a.Reasons)
	}
	// 가격대·배당 없는 펀드: 신호 15×2/4=7.5 · 비중 5×0.95=4.8 = 12.3 → 점수가 낮아 Top 3 에서 뺌
	if f := rows[7]; !near(f.Score, 12.3) || f.Parts.SignalMax != 15 {
		t.Fatalf("펀드 = %+v (%v)", f.Parts, f.Score)
	}
	// 싸 보여도 과거에 안 통한 종목은 주의
	trap := &PriceZoneRow{PriceZone: models.PriceZone{Currency: "USD", Level: models.ZoneLevelGood, Pos1y: 2, Verdict: models.ZoneVerdictTrap, CheapAvg: -8.6, AllAvg: 0.4, Falling: true}}
	if w := zoneWarn(trap); w != "싸게 사도 과거엔 1년 뒤 평균 -8.6% (평소 +0.4%)" {
		t.Fatalf("함정 주의 = %q", w)
	}
	if w := zoneWarn(&PriceZoneRow{PriceZone: models.PriceZone{Level: models.ZoneLevelHigh, Pos1y: 90, Falling: true}}); w != "" {
		t.Fatalf("비싼 종목은 주의 없음: %q", w)
	}
	// 예수금이 모자라면 모자란 금액 (가격 매력 50 → 35 + 신호 3.8 + 비중 4.5)
	only3, _ := rankToday(items[2:3], nil, map[uint]PriceZoneRow{3: {PriceZone: models.PriceZone{AssetID: 3, Currency: "KRW", Score: 50, CheapDays: 60}}}, nil, accounts, balances, 1400, today)
	if len(only3) != 1 || only3[0].Account == nil || !near(only3[0].Account.Short, 3820) {
		t.Fatalf("모자란 금액 = %+v", only3)
	}
}

// 싸게 산 사례가 적은 종목(1년 하위 20% 날 40일 미만)은 가격 매력을 0 대신 사례가 충분한 종목들의 중간값으로, 가격대 기록이 없으면 0
func TestRankTodayNeutralPrice(t *testing.T) {
	item := func(id uint, tk string) SignalItem {
		return SignalItem{AssetID: id, Ticker: tk, Action: SignalHold, CurrentPrice: 10, WeightPct: 20}
	}
	items := []SignalItem{item(1, "A"), item(2, "B"), item(3, "C"), item(4, "FEW"), item(5, "NOZONE"), item(6, "TRAPFEW")}
	zone := func(id uint, score float64, days int) PriceZoneRow {
		return PriceZoneRow{PriceZone: models.PriceZone{AssetID: id, Score: score, CheapDays: days}}
	}
	zones := map[uint]PriceZoneRow{1: zone(1, 80, 120), 2: zone(2, 20, 45), 3: zone(3, 50, 300), 4: zone(4, 0, 26), 6: zone(6, 0, 0)}
	_, rows := rankToday(items, nil, zones, nil, nil, nil, 1400, "2026-11-20")
	got := map[string]TodayRow{}
	for _, r := range rows {
		got[r.Ticker] = r
	}
	// 중간값 50 → 70 × 0.5 = 35
	for _, tk := range []string{"FEW", "TRAPFEW"} {
		if r := got[tk]; r.Parts.Price != 35 || !r.PriceNeutral {
			t.Fatalf("%s = %+v", tk, r)
		}
	}
	if r := got["A"]; r.Parts.Price != 56 || r.PriceNeutral {
		t.Fatalf("A = %+v", r)
	}
	if r := got["NOZONE"]; r.Parts.Price != 0 || r.PriceNeutral {
		t.Fatalf("가격대 기록 없음 = %+v", r)
	}
	// 사례가 충분한 종목이 하나도 없으면 0
	_, rows = rankToday(items[3:4], nil, map[uint]PriceZoneRow{4: zone(4, 0, 26)}, nil, nil, nil, 1400, "2026-11-20")
	if rows[0].Parts.Price != 0 {
		t.Fatalf("기준 없음 = %+v", rows[0])
	}
}

// 살 계좌: 달러로 바로 살 수 있는 계좌 → 원화를 환전하면 살 수 있는 계좌(토스 — 원화·환율·환전 수수료를 넘김) → 가장 많이 채우는 계좌
func TestPickAccountExchange(t *testing.T) {
	item := func(ids ...uint) SignalItem {
		it := SignalItem{Ticker: "JEPI", CurrentPrice: 57, SuggestedBuyKRW: 70000}
		for _, id := range ids {
			it.Accounts = append(it.Accounts, SignalAccountBreakdown{AccountID: id})
		}
		return it
	}
	accounts := map[uint]models.Account{
		1: {ID: 1, Name: "Super365", Broker: "메리츠증권", ForeignSettle: models.SettleUSD},
		2: {ID: 2, Name: "토스증권", Broker: "토스증권", ForeignSettle: models.SettleUSD, FxSpreadPct: 1, FxDayDiscPct: 95, FxOffDiscPct: 50},
		3: {ID: 3, Name: "위탁", Broker: "한국투자증권", ForeignSettle: models.SettleUSD},
	}
	// 필요 $50 (70,000원 ÷ 1,400): 메리츠 $30 (원화 없음), 토스 $0 + 원화 100,000 → 토스 (환전하면 충분)
	balances := map[uint]CashBalance{1: {USD: 30}, 2: {KRW: 100000, USD: 0}, 3: {USD: 60}}
	a := pickAccount(item(1, 2), accounts, balances, 1400)
	if a == nil || a.ID != 2 || a.Short != 50 || a.KRW != 100000 || a.Fx != 1400 || a.FxSpreadPct != 1 || a.FxDayDiscPct != 95 || a.FxOffDiscPct != 50 {
		t.Fatalf("환전하면 되는 토스를 골라야 함: %+v", a)
	}
	// 달러로 바로 살 수 있는 계좌가 있으면 그쪽
	if a := pickAccount(item(1, 2, 3), accounts, balances, 1400); a == nil || a.ID != 3 || a.Short != 0 {
		t.Fatalf("달러가 충분한 계좌를 골라야 함: %+v", a)
	}
	// 환전해도 모자라면 더 많이 채우는 쪽: 토스 원화 20,000(≈$14) < 메리츠 $30
	balances[2] = CashBalance{KRW: 20000}
	if a := pickAccount(item(1, 2), accounts, balances, 1400); a == nil || a.ID != 1 || a.Short != 20 || a.KRW != 0 {
		t.Fatalf("더 많이 채우는 메리츠를 골라야 함: %+v", a)
	}
	// 수수료를 모르는 계좌도 원화·환율은 넘긴다 (수수료 없이 계산)
	balances[3] = CashBalance{KRW: 50000, USD: 10}
	if a := pickAccount(item(3), accounts, balances, 1400); a == nil || a.KRW != 50000 || a.FxSpreadPct != 0 || a.Short != 40 {
		t.Fatalf("수수료 모르는 계좌 = %+v", a)
	}
}

// 계좌별 순위: 줄마다 그 종목을 담은 계좌(수량·평가금액), 계좌 목록은 담은 종목 많은 순 + 예수금
func TestTodayAccounts(t *testing.T) {
	items := []SignalItem{
		{AssetID: 1, Ticker: "JEPQ", CurrentPrice: 53, Accounts: []SignalAccountBreakdown{{AccountID: 2, Quantity: 3, MarketValueKRW: 214500.4}, {AccountID: 1, Quantity: 1, MarketValueKRW: 71500}}},
		{AssetID: 2, Ticker: "SCHD", CurrentPrice: 27, Accounts: []SignalAccountBreakdown{{AccountID: 2, Quantity: 10}, {AccountID: 3, Quantity: 0}}},
		{AssetID: 3, Ticker: "005930.KS", CurrentPrice: 70000, Accounts: []SignalAccountBreakdown{{AccountID: 3, Quantity: 2}}},
	}
	accounts := map[uint]models.Account{
		1: {ID: 1, Name: "Super365", Broker: "메리츠증권"},
		2: {ID: 2, Name: "토스증권", Broker: "토스증권", AccountType: models.AccountTypeGeneral},
		3: {ID: 3, Name: "종합", Broker: "카카오증권"},
	}
	balances := map[uint]CashBalance{2: {KRW: 49636.4, USD: -2.456}}
	_, rows := rankToday(items, nil, nil, nil, accounts, balances, 1400, "2026-11-20")
	held := map[string][]TodayHeld{}
	for _, r := range rows {
		held[r.Ticker] = r.Held
	}
	if h := held["JEPQ"]; len(h) != 2 || h[0].AccountID != 2 || h[0].Qty != 3 || h[0].ValueKRW != 214500 {
		t.Fatalf("JEPQ 계좌 = %+v", h)
	}
	if h := held["SCHD"]; len(h) != 1 || h[0].AccountID != 2 {
		t.Fatalf("수량 0 인 계좌는 빼야 함: %+v", h)
	}
	accs := todayAccounts(rows, accounts, balances)
	if len(accs) != 3 || accs[0].ID != 2 || accs[0].Count != 2 || accs[0].KRW != 49636 || accs[0].USD != -2.46 || accs[0].AccountType != "General" {
		t.Fatalf("계좌 목록 = %+v", accs)
	}
	if accs[1].ID != 1 || accs[2].ID != 3 || accs[1].Count != 1 || accs[2].Count != 1 {
		t.Fatalf("같은 수면 계좌 번호 순: %+v", accs)
	}
}

// 직접 환전 수수료: 평일 09:00~15:30(KST)은 정규 시간 우대, 그 외(밤·주말)는 그 외 우대
func TestFxFeeWindow(t *testing.T) {
	kst := time.FixedZone("KST", 9*3600)
	acc := models.Account{ForeignSettle: models.SettleUSD, FxSpreadPct: 1, FxDayDiscPct: 95, FxOffDiscPct: 50}
	cases := []struct {
		at  time.Time
		fee float64
	}{
		{time.Date(2026, 11, 20, 8, 59, 0, 0, kst), 0.5},      // 금요일 9시 전
		{time.Date(2026, 11, 20, 9, 0, 0, 0, kst), 0.05},      // 9시
		{time.Date(2026, 11, 20, 15, 29, 0, 0, kst), 0.05},    // 15:29
		{time.Date(2026, 11, 20, 15, 30, 0, 0, kst), 0.5},     // 15:30 부터는 그 외
		{time.Date(2026, 11, 21, 11, 0, 0, 0, kst), 0.5},      // 토요일 낮
		{time.Date(2026, 11, 20, 1, 0, 0, 0, time.UTC), 0.05}, // UTC 01:00 = KST 10:00
	}
	for _, c := range cases {
		if got := acc.FxFeePctAt(c.at); math.Abs(got-c.fee) > 1e-9 {
			t.Fatalf("%s 수수료 = %v, want %v", c.at, got, c.fee)
		}
	}
	if !acc.HasFxFee() || (models.Account{ForeignSettle: models.SettleAutoFX, FxSpreadPct: 1}).HasFxFee() {
		t.Fatal("HasFxFee")
	}
}
