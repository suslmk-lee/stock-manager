package services

import (
	"errors"
	"sync"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newProfileSvc(t *testing.T) (*SignalService, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.SignalRule{}, &models.SignalProfile{}, &models.AssetSignalProfile{},
		&models.ProfileSuggestion{}, &models.Asset{}, &models.Holding{}, &models.SignalState{},
		&models.SignalEvent{}, &models.NotificationSetting{}); err != nil {
		t.Fatal(err)
	}
	return NewSignalService(db, nil, nil), db
}

func mkAssets(t *testing.T, db *gorm.DB, n int) []uint {
	t.Helper()
	var ids []uint
	for i := 0; i < n; i++ {
		a := models.Asset{Ticker: "T" + string(rune('A'+i)), Name: "Asset" + string(rune('A'+i)), Type: models.AssetTypeStock}
		if err := db.Create(&a).Error; err != nil {
			t.Fatal(err)
		}
		ids = append(ids, a.ID)
	}
	return ids
}

func isInvalid(err error) bool {
	var inv *ErrInvalidSignalRule
	return errors.As(err, &inv)
}

func profileByKeyT(t *testing.T, svc *SignalService, key string) models.SignalProfile {
	t.Helper()
	p, err := svc.profileByKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSeedingIdempotentAndConcurrent(t *testing.T) {
	svc, db := newProfileSvc(t)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := svc.ensureSeeded(); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	// 새 서비스 인스턴스(재시작 모사)도 중복을 만들지 않는다.
	svc2 := NewSignalService(db, nil, nil)
	if err := svc2.ensureSeeded(); err != nil {
		t.Fatal(err)
	}
	var n int64
	db.Model(&models.SignalProfile{}).Count(&n)
	if n != 2 {
		t.Fatalf("profiles=%d", n)
	}
	d := profileByKeyT(t, svc, "default")
	v := profileByKeyT(t, svc, "dividend")
	if !d.BuiltIn || d.Kind != "standard" || d.Name != "기본" || !v.BuiltIn || v.Kind != "dividend" || v.Name != "배당 장기보유" {
		t.Fatalf("%+v %+v", d, v)
	}
	if d.Rule != models.DefaultSignalRuleConfig() {
		t.Errorf("default rule %+v", d.Rule)
	}
	r := v.Rule
	if r.StopLossEnabled || r.TakeProfitEnabled || !r.CrashEnabled || r.CrashPct != -40 || !r.DividendCutEnabled ||
		!r.BuyDipEnabled || !r.HighYieldEnabled || r.HighYieldPct != 4 || !r.FromHighEnabled || r.FromHighPct != -20 ||
		!r.TaxHarvestEnabled || !r.FxHistorical || r.WeightEnabled || r.AboveMAEnabled || r.BelowMAEnabled {
		t.Errorf("dividend rule %+v", r)
	}
}

func TestDefaultProfileCopiesLegacyRuleAndKeepsRow(t *testing.T) {
	svc, db := newProfileSvc(t)
	// v2 단계의 레거시 기본 규칙 (crash 필드 없음)
	cfg := models.DefaultSignalRuleConfig()
	cfg.TakeProfitPct = 77
	cfg.CrashPct = 0
	legacy := models.SignalRule{AssetID: 0, SignalRuleConfig: cfg, RuleVersion: 2}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureSeeded(); err != nil {
		t.Fatal(err)
	}
	d := profileByKeyT(t, svc, "default")
	if d.Rule.TakeProfitPct != 77 || d.Rule.CrashPct != -40 || d.Rule.CrashEnabled {
		t.Errorf("default profile %+v", d.Rule)
	}
	var stored models.SignalRule
	if err := db.Where("asset_id = 0").First(&stored).Error; err != nil || stored.TakeProfitPct != 77 || stored.RuleVersion != models.SignalRuleVersion {
		t.Fatalf("legacy row must be kept (migrated): %+v %v", stored, err)
	}
}

func TestMigrateV2ToV3(t *testing.T) {
	r := models.SignalRule{SignalRuleConfig: models.DefaultSignalRuleConfig(), RuleVersion: 2}
	r.CrashPct, r.CrashEnabled = 0, true
	if !migrateSignalRule(&r) || r.CrashPct != -40 || r.CrashEnabled || r.RuleVersion != models.SignalRuleVersion || !r.MinSellQtyEnabled || r.MinSellQty != 1 {
		t.Errorf("%+v", r)
	}
	r2 := models.SignalRule{SignalRuleConfig: models.DefaultSignalRuleConfig(), RuleVersion: 2}
	r2.CrashPct = -25
	migrateSignalRule(&r2)
	if r2.CrashPct != -25 {
		t.Errorf("existing crash_pct must be kept: %v", r2.CrashPct)
	}
	if migrateSignalRule(&r2) {
		t.Error("must not migrate twice")
	}
}

func TestRuleResolutionPrecedence(t *testing.T) {
	def := models.SignalProfile{ID: 1, Key: "default", Name: "기본", Kind: "standard", Rule: models.DefaultSignalRuleConfig()}
	divCfg := models.DividendSignalRuleConfig()
	div := models.SignalProfile{ID: 2, Key: "dividend", Name: "배당 장기보유", Kind: "dividend", Rule: divCfg}
	profs := map[uint]models.SignalProfile{1: def, 2: div}
	ov := models.SignalRule{AssetID: 30, SignalRuleConfig: models.SignalRuleConfig{TakeProfitEnabled: true, TakeProfitPct: 5}}
	overrides := map[uint]models.SignalRule{30: ov}
	assign := map[uint]uint{20: 2, 30: 2}

	a := &SignalAssetInput{AssetID: 10}
	applyResolvedRule(a, def, profs, assign, overrides)
	if a.RuleSource != "default" || a.ProfileKey != "default" || a.Rule != def.Rule {
		t.Errorf("default: %+v", a)
	}
	b := &SignalAssetInput{AssetID: 20}
	applyResolvedRule(b, def, profs, assign, overrides)
	if b.RuleSource != "profile" || b.ProfileKey != "dividend" || b.Rule != divCfg {
		t.Errorf("profile: %+v", b)
	}
	c := &SignalAssetInput{AssetID: 30}
	applyResolvedRule(c, def, profs, assign, overrides)
	if c.RuleSource != "asset" || c.Rule != ov.SignalRuleConfig || c.ProfileKey != "dividend" {
		t.Errorf("override: %+v", c)
	}
	// 삭제된 프로필 배정은 기본으로 폴백
	d := &SignalAssetInput{AssetID: 40}
	applyResolvedRule(d, def, profs, map[uint]uint{40: 99}, nil)
	if d.RuleSource != "default" {
		t.Errorf("dangling: %+v", d)
	}
}

func TestCrashCheckAndSellDisabled(t *testing.T) {
	rule := models.SignalRuleConfig{CrashEnabled: true, CrashPct: -40, SellMode: "any", BuyMode: "any"}
	// avg 100, price 60 -> -40%: 경계 충족
	it := evalOne(t, krwAsset(1, 60, 1, 100, rule))
	if it.Action != SignalSell || len(it.SellChecks) != 1 || it.SellChecks[0].Code != "crash" || !it.SellChecks[0].Met ||
		it.SellChecks[0].Threshold != -40 || it.SellChecks[0].Label != "큰 폭락 경고" {
		t.Errorf("%+v", it)
	}
	if it.SellDisabled {
		t.Error("sell enabled")
	}
	it = evalOne(t, krwAsset(1, 60.01, 1, 100, rule))
	if it.Action != SignalHold || it.SellChecks[0].Met {
		t.Errorf("%+v", it)
	}
	off := models.SignalRuleConfig{BuyDipEnabled: true, BuyDipPct: -10, SellMode: "any", BuyMode: "any"}
	it = evalOne(t, krwAsset(1, 50, 1, 100, off))
	if !it.SellDisabled || it.Action != SignalBuy {
		t.Errorf("%+v", it)
	}
	// 배당 프로필: 손절 없이 -30% 에서도 매도 신호 없음
	it = evalOne(t, krwAsset(1, 70, 1, 100, models.DividendSignalRuleConfig()))
	if it.Action == SignalSell {
		t.Errorf("dividend profile must not sell at -30%%: %+v", it)
	}
}

func TestProfileCRUDRules(t *testing.T) {
	svc, db := newProfileSvc(t)
	ids := mkAssets(t, db, 2)
	list, err := svc.GetSignalProfiles()
	if err != nil || len(list.Profiles) != 2 || list.Profiles[0].Key != "default" || list.Profiles[1].Key != "dividend" {
		t.Fatalf("%+v %v", list, err)
	}
	def, div := list.Profiles[0], list.Profiles[1]

	// 생성: 기본 프로필 규칙 복사 / 지정 원본 복사
	p, err := svc.CreateSignalProfile(CreateSignalProfileRequest{Name: " 내 전략 ", Kind: "standard"})
	if err != nil || p.BuiltIn || p.Name != "내 전략" || p.Rule != def.Rule || p.Key == "" || p.Key == "default" {
		t.Fatalf("%+v %v", p, err)
	}
	q, err := svc.CreateSignalProfile(CreateSignalProfileRequest{Name: "배당 복사", Kind: "dividend", CopyFromProfileID: div.ID})
	if err != nil || q.Rule != div.Rule || q.Key == p.Key || q.SortOrder <= p.SortOrder {
		t.Fatalf("%+v %v", q, err)
	}
	if _, err := svc.CreateSignalProfile(CreateSignalProfileRequest{Name: "", Kind: "standard"}); !isInvalid(err) {
		t.Errorf("empty name: %v", err)
	}
	if _, err := svc.CreateSignalProfile(CreateSignalProfileRequest{Name: "x", Kind: "weird"}); !isInvalid(err) {
		t.Errorf("bad kind: %v", err)
	}
	var nf *ErrSignalNotFound
	if _, err := svc.CreateSignalProfile(CreateSignalProfileRequest{Name: "x", Kind: "standard", CopyFromProfileID: 999}); !errors.As(err, &nf) {
		t.Errorf("copy from missing: %v", err)
	}

	// 수정: 커스텀은 이름/종류/규칙 변경 가능, 검증 적용
	name, kind := "새 이름", "dividend"
	cfg := p.Rule
	cfg.CrashEnabled, cfg.CrashPct = true, -33
	up, err := svc.UpdateSignalProfile(p.ID, UpdateSignalProfileRequest{Name: &name, Kind: &kind, Rule: &cfg})
	if err != nil || up.Name != "새 이름" || up.Kind != "dividend" || up.Rule.CrashPct != -33 {
		t.Fatalf("%+v %v", up, err)
	}
	bad := cfg
	bad.CrashPct = 5
	if _, err := svc.UpdateSignalProfile(p.ID, UpdateSignalProfileRequest{Rule: &bad}); !isInvalid(err) {
		t.Errorf("crash_pct>0: %v", err)
	}
	bad = cfg
	bad.SellMode = "zzz"
	if _, err := svc.UpdateSignalProfile(p.ID, UpdateSignalProfileRequest{Rule: &bad}); !isInvalid(err) {
		t.Errorf("sell mode: %v", err)
	}

	// 내장: 이름/종류 변경 400, 규칙 변경 가능, 동일 값은 허용
	other := "다른 이름"
	if _, err := svc.UpdateSignalProfile(def.ID, UpdateSignalProfileRequest{Name: &other}); !isInvalid(err) {
		t.Errorf("builtin rename: %v", err)
	}
	dk := "dividend"
	if _, err := svc.UpdateSignalProfile(def.ID, UpdateSignalProfileRequest{Kind: &dk}); !isInvalid(err) {
		t.Errorf("builtin kind: %v", err)
	}
	same := def.Name
	rc := def.Rule
	rc.TakeProfitPct = 55
	ud, err := svc.UpdateSignalProfile(def.ID, UpdateSignalProfileRequest{Name: &same, Rule: &rc})
	if err != nil || ud.Rule.TakeProfitPct != 55 || ud.Key != "default" {
		t.Fatalf("%+v %v", ud, err)
	}
	if _, err := svc.UpdateSignalProfile(9999, UpdateSignalProfileRequest{}); !errors.As(err, &nf) {
		t.Errorf("missing: %v", err)
	}

	// 초기화: 내장만
	rd, err := svc.ResetSignalProfile(def.ID)
	if err != nil || rd.Rule != models.DefaultSignalRuleConfig() {
		t.Fatalf("%+v %v", rd, err)
	}
	if _, err := svc.ResetSignalProfile(p.ID); !isInvalid(err) {
		t.Errorf("custom reset: %v", err)
	}
	dv := div.Rule
	dv.CrashPct = -10
	if _, err := svc.UpdateSignalProfile(div.ID, UpdateSignalProfileRequest{Rule: &dv}); err != nil {
		t.Fatal(err)
	}
	if rv, err := svc.ResetSignalProfile(div.ID); err != nil || rv.Rule != models.DividendSignalRuleConfig() {
		t.Fatalf("%+v %v", rv, err)
	}

	// 삭제: 내장 불가, 커스텀은 배정 삭제 후 기본 폴백
	if err := svc.DeleteSignalProfile(def.ID); !isInvalid(err) {
		t.Errorf("delete builtin: %v", err)
	}
	if _, err := svc.AssignSignalProfile(p.ID, ids); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteSignalProfile(p.ID); err != nil {
		t.Fatal(err)
	}
	var n int64
	db.Model(&models.AssetSignalProfile{}).Count(&n)
	if n != 0 {
		t.Errorf("assignments left: %d", n)
	}
	if err := svc.DeleteSignalProfile(p.ID); !errors.As(err, &nf) {
		t.Errorf("double delete: %v", err)
	}
}

func TestAssignmentMovesAndDefaultClears(t *testing.T) {
	svc, db := newProfileSvc(t)
	ids := mkAssets(t, db, 3)
	list, _ := svc.GetSignalProfiles()
	def, div := list.Profiles[0], list.Profiles[1]
	cust, err := svc.CreateSignalProfile(CreateSignalProfileRequest{Name: "c", Kind: "standard"})
	if err != nil {
		t.Fatal(err)
	}
	as, err := svc.AssignSignalProfile(div.ID, ids[:2])
	if err != nil || len(as) != 2 {
		t.Fatalf("%v %v", as, err)
	}
	// 이동
	as, err = svc.AssignSignalProfile(cust.ID, ids[1:2])
	if err != nil || len(as) != 2 {
		t.Fatalf("%v %v", as, err)
	}
	for _, a := range as {
		if a.AssetID == ids[1] && a.ProfileID != cust.ID {
			t.Errorf("not moved: %+v", as)
		}
		if a.AssetID == ids[0] && a.ProfileID != div.ID {
			t.Errorf("unexpected: %+v", as)
		}
	}
	// 기본으로 옮기면 배정 삭제
	as, err = svc.AssignSignalProfile(def.ID, ids[:2])
	if err != nil || len(as) != 0 {
		t.Fatalf("%v %v", as, err)
	}
	if _, err := svc.AssignSignalProfile(div.ID, []uint{9999}); !isInvalid(err) {
		t.Errorf("unknown asset: %v", err)
	}
	var nf *ErrSignalNotFound
	if _, err := svc.AssignSignalProfile(9999, ids); !errors.As(err, &nf) {
		t.Errorf("unknown profile: %v", err)
	}
}

func TestLegacyDefaultRuleRoundTrip(t *testing.T) {
	svc, db := newProfileSvc(t)
	rules, err := svc.GetSignalRules()
	if err != nil || rules.Default.AssetID != 0 || rules.Default.RuleVersion != models.SignalRuleVersion || rules.Default.CrashPct != -40 {
		t.Fatalf("%+v %v", rules, err)
	}
	in := rules.Default
	in.TakeProfitPct = 88
	in.CrashEnabled = true
	saved, err := svc.SaveDefaultRule(in)
	if err != nil || saved.TakeProfitPct != 88 || !saved.CrashEnabled {
		t.Fatalf("%+v %v", saved, err)
	}
	if d := profileByKeyT(t, svc, "default"); d.Rule.TakeProfitPct != 88 || !d.Rule.CrashEnabled {
		t.Errorf("profile not updated: %+v", d.Rule)
	}
	rules, _ = svc.GetSignalRules()
	if rules.Default.TakeProfitPct != 88 {
		t.Errorf("%+v", rules.Default)
	}
	// 구버전 클라이언트(crash 필드 없음): crash_pct 0 -> -40 으로 정규화
	old := models.SignalRule{SignalRuleConfig: models.SignalRuleConfig{TakeProfitPct: 10}}
	if s2, err := svc.SaveDefaultRule(old); err != nil || s2.CrashPct != -40 {
		t.Errorf("%+v %v", s2, err)
	}
	// 레거시 행은 만들거나 갱신하지 않는다
	var n int64
	db.Model(&models.SignalRule{}).Where("asset_id = 0").Count(&n)
	if n != 0 {
		t.Errorf("legacy row touched: %d", n)
	}
}

// ---- 후보 점수 ----

var candNow = time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)

func candInput() DividendCandidateInput {
	return DividendCandidateInput{AssetID: 1, Ticker: "ZZZ", Name: "Plain Corp", Now: candNow}
}

func reasonOf(c DividendCandidate, code string) CandidateReason {
	for _, r := range c.Reasons {
		if r.Code == code {
			return r
		}
	}
	return CandidateReason{}
}

func TestCandidateScoreCriteria(t *testing.T) {
	c := ScoreDividendCandidate(candInput())
	if c.Score != 0 || c.MaxScore != 6 || c.IsCandidate || len(c.Reasons) != 6 {
		t.Fatalf("%+v", c)
	}

	in := candInput()
	in.CurrentYieldPct = 4.1
	c = ScoreDividendCandidate(in)
	if r := reasonOf(c, "yield"); !r.Met || r.Detail != "4.1%" || r.Label != "배당수익률 3% 이상" {
		t.Errorf("yield %+v", r)
	}
	in.CurrentYieldPct = 2.99
	if reasonOf(ScoreDividendCandidate(in), "yield").Met {
		t.Error("yield below 3")
	}

	in = candInput()
	for m := 1; m <= 3; m++ {
		in.DividendDates = append(in.DividendDates, candNow.AddDate(0, -m, 0))
	}
	if reasonOf(ScoreDividendCandidate(in), "frequency").Met {
		t.Error("3 payments is not enough")
	}
	in.DividendDates = append(in.DividendDates, candNow.AddDate(0, -4, 0), candNow.AddDate(0, -4, 0)) // 같은 날 중복은 1회
	r := reasonOf(ScoreDividendCandidate(in), "frequency")
	if !r.Met || r.Detail != "분기 4회" {
		t.Errorf("frequency %+v", r)
	}
	in.DividendDates = nil
	for m := 0; m < 12; m++ {
		in.DividendDates = append(in.DividendDates, candNow.AddDate(0, 0, -30*m-1))
	}
	if r := reasonOf(ScoreDividendCandidate(in), "frequency"); !r.Met || r.Detail != "월 12회" {
		t.Errorf("monthly %+v", r)
	}
	in.DividendDates = []time.Time{candNow.AddDate(-2, 0, 0), candNow.AddDate(-2, 0, 1), candNow.AddDate(-2, 0, 2), candNow.AddDate(-2, 0, 3)}
	if reasonOf(ScoreDividendCandidate(in), "frequency").Met {
		t.Error("old payments ignored")
	}

	in = candInput()
	in.TrendOK, in.TrendChangePct = true, 5
	if !reasonOf(ScoreDividendCandidate(in), "growth").Met {
		t.Error("growth")
	}
	in.TrendChangePct = 0
	if reasonOf(ScoreDividendCandidate(in), "growth").Met {
		t.Error("flat is not growth")
	}
	in.TrendOK, in.TrendChangePct = false, 9
	if reasonOf(ScoreDividendCandidate(in), "growth").Met {
		t.Error("untrusted trend")
	}

	for _, kw := range []struct{ name, ticker string }{
		{"KODEX 고배당", "279530.KS"}, {"Global X DIVIDEND ETF", "ZZZ"}, {"Realty Income", "ZZZ"},
		{"Foo Covered Call", "ZZZ"}, {"맥쿼리 리츠", "ZZZ"}, {"Whatever", "schd"}, {"Whatever", "O"},
		{"TIGER 미국배당다우존스", "458730.KS"}, {"Some Income Fund", "ZZZ"},
	} {
		in = candInput()
		in.Name, in.Ticker = kw.name, kw.ticker
		if !reasonOf(ScoreDividendCandidate(in), "keyword").Met {
			t.Errorf("keyword %+v", kw)
		}
	}
	in = candInput()
	in.Name, in.Ticker = "Tesla", "TSLA"
	if reasonOf(ScoreDividendCandidate(in), "keyword").Met {
		t.Error("keyword false positive")
	}

	for _, sec := range []string{"Real Estate", "부동산", "Utilities", "유틸리티", "REIT - Retail"} {
		in = candInput()
		in.Sector = sec
		if !reasonOf(ScoreDividendCandidate(in), "sector").Met {
			t.Errorf("sector %s", sec)
		}
	}
	in = candInput()
	in.Sector = "Technology"
	if reasonOf(ScoreDividendCandidate(in), "sector").Met {
		t.Error("tech sector")
	}

	buy := func(q float64) SignalTxnInput { return SignalTxnInput{Type: models.TransactionTypeBuy, Quantity: q} }
	sell := func(q float64) SignalTxnInput { return SignalTxnInput{Type: models.TransactionTypeSell, Quantity: q} }
	in = candInput()
	in.Txns = []SignalTxnInput{buy(10), buy(10), buy(10)}
	if r := reasonOf(ScoreDividendCandidate(in), "pattern"); !r.Met {
		t.Errorf("pattern %+v", r)
	}
	in.Txns = []SignalTxnInput{buy(10), buy(10)}
	if reasonOf(ScoreDividendCandidate(in), "pattern").Met {
		t.Error("2 buys")
	}
	in.Txns = []SignalTxnInput{buy(10), buy(10), buy(10), sell(3)} // 10% 경계
	if !reasonOf(ScoreDividendCandidate(in), "pattern").Met {
		t.Error("sold 10% boundary")
	}
	in.Txns = []SignalTxnInput{buy(10), buy(10), buy(10), sell(3.1)}
	if reasonOf(ScoreDividendCandidate(in), "pattern").Met {
		t.Error("sold >10%")
	}
}

func TestCandidateIsCandidate(t *testing.T) {
	// 점수 3 이상이어도 12개월 배당이 없고 키워드도 없으면 후보가 아니다.
	in := candInput()
	in.Sector = "Utilities"
	in.CurrentYieldPct = 5
	in.TrendOK, in.TrendChangePct = true, 3
	c := ScoreDividendCandidate(in)
	if c.Score != 3 || c.IsCandidate {
		t.Errorf("no dividends: %+v", c)
	}
	in.Dividends12mKRW = 1000
	if c = ScoreDividendCandidate(in); !c.IsCandidate {
		t.Errorf("with dividends: %+v", c)
	}
	// 키워드 충족이면 배당 이력이 없어도 후보
	in = candInput()
	in.Name = "TIGER 리츠"
	in.Sector = "Real Estate"
	in.TrendOK, in.TrendChangePct = true, 1
	if c = ScoreDividendCandidate(in); c.Score != 3 || !c.IsCandidate {
		t.Errorf("keyword: %+v", c)
	}
	// 점수 2 는 후보 아님
	in = candInput()
	in.Name = "TIGER 리츠"
	in.Dividends12mKRW = 5
	if c = ScoreDividendCandidate(in); c.IsCandidate {
		t.Errorf("score 1: %+v", c)
	}
}

// ---- 추천 ----

func candidateReport(assetID uint, cand bool, unassigned, priced bool) *SignalReport {
	it := SignalItem{AssetID: assetID, Ticker: "SCHD", Name: "Schwab Div", Action: SignalHold, CurrentPrice: 10, Currency: "USD"}
	c := DividendCandidate{AssetID: assetID, Ticker: "SCHD", Name: "Schwab Div", IsCandidate: cand, MaxScore: 6,
		Reasons: []CandidateReason{{Code: "yield", Label: "배당수익률 3% 이상", Met: true}, {Code: "keyword", Label: "배당형 종목명", Met: true}, {Code: "sector", Label: "배당 섹터"}}}
	c.priced, c.unassigned = priced, unassigned
	return &SignalReport{Items: []SignalItem{it}, Candidates: []DividendCandidate{c}}
}

func suggestionEvents(t *testing.T, db *gorm.DB) []models.SignalEvent {
	t.Helper()
	var ev []models.SignalEvent
	if err := db.Where("kind = ?", "suggestion").Order("id").Find(&ev).Error; err != nil {
		t.Fatal(err)
	}
	return ev
}

func TestSuggestionBaselineThenNewEventOnce(t *testing.T) {
	svc, db := newProfileSvc(t)
	ids := mkAssets(t, db, 3)

	// 최초 실행: baseline, 이벤트 없음
	ev, err := svc.recordReport(candidateReport(ids[0], true, true, true))
	if err != nil || len(ev) != 0 {
		t.Fatalf("%v %v", ev, err)
	}
	var s models.ProfileSuggestion
	if err := db.Where("asset_id = ?", ids[0]).First(&s).Error; err != nil || s.Status != "baseline" {
		t.Fatalf("%+v %v", s, err)
	}
	// 이후 같은 종목은 다시 제안하지 않음
	if ev, _ = svc.recordReport(candidateReport(ids[0], true, true, true)); len(ev) != 0 {
		t.Fatalf("baseline re-suggested: %v", ev)
	}

	// 새 후보 -> 이벤트 1회
	div := profileByKeyT(t, svc, "dividend")
	ev, err = svc.recordReport(candidateReport(ids[1], true, true, true))
	if err != nil || len(ev) != 1 {
		t.Fatalf("%v %v", ev, err)
	}
	e := ev[0]
	if e.Kind != "suggestion" || e.ToAction != "SUGGEST" || e.FromAction != SignalHold || e.SuggestedProfileID != div.ID ||
		e.Message != "배당 장기보유 프로필 후보 · 배당수익률 3% 이상, 배당형 종목명" || e.MetCodes != "yield,keyword" || e.ReadAt != nil {
		t.Errorf("%+v", e)
	}
	if ev, _ = svc.recordReport(candidateReport(ids[1], true, true, true)); len(ev) != 0 {
		t.Fatalf("re-suggested: %v", ev)
	}
	if n := len(suggestionEvents(t, db)); n != 1 {
		t.Errorf("events=%d", n)
	}
	if c, _ := svc.GetUnreadSignalCount(); c != 1 {
		t.Errorf("unread=%d", c)
	}

	// 거절: 알림 읽음 처리, 이후 재제안 없음
	if err := svc.DismissProfileSuggestion(ids[1]); err != nil {
		t.Fatal(err)
	}
	if c, _ := svc.GetUnreadSignalCount(); c != 0 {
		t.Errorf("unread after dismiss=%d", c)
	}
	var s2 models.ProfileSuggestion
	db.Where("asset_id = ?", ids[1]).First(&s2)
	if s2.Status != "dismissed" {
		t.Errorf("%+v", s2)
	}
	if ev, _ = svc.recordReport(candidateReport(ids[1], true, true, true)); len(ev) != 0 {
		t.Fatalf("dismissed re-suggested: %v", ev)
	}

	// 배정됨/오버라이드/시세 없음/비후보는 건너뜀
	for name, rep := range map[string]*SignalReport{
		"assigned":    candidateReport(ids[2], true, false, true),
		"not priced":  candidateReport(ids[2], true, true, false),
		"not a cand.": candidateReport(ids[2], false, true, true),
	} {
		if ev, err = svc.recordReport(rep); err != nil || len(ev) != 0 {
			t.Errorf("%s: %v %v", name, ev, err)
		}
	}
	var cnt int64
	db.Model(&models.ProfileSuggestion{}).Where("asset_id = ?", ids[2]).Count(&cnt)
	if cnt != 0 {
		t.Error("skipped asset got a row")
	}
}

func TestSuggestionAcceptedOnAssignAndNotificationsDisabled(t *testing.T) {
	svc, db := newProfileSvc(t)
	ids := mkAssets(t, db, 3)
	svc.recordReport(candidateReport(ids[0], true, true, true)) // baseline

	div := profileByKeyT(t, svc, "dividend")
	if _, err := svc.AssignSignalProfile(div.ID, []uint{ids[1]}); err != nil {
		t.Fatal(err)
	}
	var s models.ProfileSuggestion
	if err := db.Where("asset_id = ?", ids[1]).First(&s).Error; err != nil || s.Status != "accepted" {
		t.Fatalf("%+v %v", s, err)
	}
	// 수락된 종목은 (배정이 풀려도) 다시 제안하지 않는다.
	if ev, _ := svc.recordReport(candidateReport(ids[1], true, true, true)); len(ev) != 0 {
		t.Fatalf("accepted re-suggested: %v", ev)
	}

	// 알림이 꺼져 있으면 읽음 상태로 기록
	if _, err := svc.SaveNotificationSettings(models.NotificationSetting{Enabled: false, IntervalMinutes: 60}); err != nil {
		t.Fatal(err)
	}
	ev, err := svc.recordReport(candidateReport(ids[2], true, true, true))
	if err != nil || len(ev) != 1 || ev[0].ReadAt == nil {
		t.Fatalf("%v %v", ev, err)
	}
}

func TestSuggestionIgnoresTypeFilters(t *testing.T) {
	svc, db := newProfileSvc(t)
	ids := mkAssets(t, db, 2)
	svc.recordReport(candidateReport(ids[0], true, true, true))
	if _, err := svc.SaveNotificationSettings(models.NotificationSetting{Enabled: true, IntervalMinutes: 60}); err != nil {
		t.Fatal(err) // notify_sell/buy/conflict 모두 false
	}
	ev, err := svc.recordReport(candidateReport(ids[1], true, true, true))
	if err != nil || len(ev) != 1 || ev[0].ReadAt != nil {
		t.Fatalf("%v %v", ev, err)
	}
}

// 기존 테이블(새 컬럼 없음)에 AutoMigrate 로 컬럼이 추가돼도 기존 행(NULL)을 읽고 v3 로 보정할 수 있다.
func TestAutoMigrateAddsColumnsToExistingRows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE signal_rules (id integer primary key autoincrement, asset_id integer not null, take_profit_enabled numeric, take_profit_pct real, rule_version integer, sell_mode text, buy_mode text, created_at datetime, updated_at datetime)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO signal_rules (asset_id, take_profit_enabled, take_profit_pct, rule_version, sell_mode, buy_mode) VALUES (0, 1, 33, 2, 'any', 'any')").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.SignalRule{}, &models.SignalProfile{}, &models.AssetSignalProfile{}, &models.ProfileSuggestion{}); err != nil {
		t.Fatal(err)
	}
	svc := NewSignalService(db, nil, nil)
	rules, err := svc.GetSignalRules()
	if err != nil || rules.Default.TakeProfitPct != 33 || rules.Default.CrashPct != -40 || rules.Default.CrashEnabled {
		t.Fatalf("%+v %v", rules.Default, err)
	}
}

func TestSignalEventKindDefaultsForOldRows(t *testing.T) {
	svc, db := newProfileSvc(t)
	if err := db.Exec("INSERT INTO signal_events (asset_id, ticker, name, from_action, to_action, created_at) VALUES (1,'A','A','HOLD','SELL', ?)", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	ev, _, err := svc.GetSignalEvents(10, false)
	if err != nil || len(ev) != 1 || ev[0].Kind != "signal" || ev[0].SuggestedProfileID != 0 {
		t.Fatalf("%+v %v", ev, err)
	}
}

// 첫 기록 전에 사용자가 한 종목을 무시해도, 다음 첫 기록은 기준점으로 처리되어
// 나머지 기존 후보에 제안 알림이 한꺼번에 생기지 않아야 한다.
func TestSuggestionBaselineSurvivesEarlyDismiss(t *testing.T) {
	svc, db := newProfileSvc(t)
	ids := mkAssets(t, db, 3)

	if err := svc.DismissProfileSuggestion(ids[0]); err != nil {
		t.Fatal(err)
	}
	rep := candidateReport(ids[1], true, true, true)
	rep2 := candidateReport(ids[2], true, true, true)
	rep.Items = append(rep.Items, rep2.Items...)
	rep.Candidates = append(rep.Candidates, rep2.Candidates...)
	ev, err := svc.recordReport(rep)
	if err != nil || len(ev) != 0 {
		t.Fatalf("early dismiss must not skip baseline: %v %v", ev, err)
	}
	// 기준점 이후 새로 생긴 후보는 정상적으로 제안된다
	if err := db.Create(&models.Asset{Ticker: "JEPI", Name: "JEPI", Type: "ETF"}).Error; err != nil {
		t.Fatal(err)
	}
	var jepi models.Asset
	db.Where("ticker = ?", "JEPI").First(&jepi)
	ev, err = svc.recordReport(candidateReport(jepi.ID, true, true, true))
	if err != nil || len(ev) != 1 {
		t.Fatalf("new candidate after baseline should be suggested once: %v %v", ev, err)
	}
}

// 첫 기록 때 후보가 하나도 없어도 기준점 표시가 남아, 이후 생긴 후보는 제안된다.
func TestSuggestionBaselineMarkerWithNoCandidates(t *testing.T) {
	svc, db := newProfileSvc(t)
	ids := mkAssets(t, db, 1)
	if _, err := svc.recordReport(candidateReport(ids[0], false, true, true)); err != nil {
		t.Fatal(err)
	}
	ev, err := svc.recordReport(candidateReport(ids[0], true, true, true))
	if err != nil || len(ev) != 1 {
		t.Fatalf("expected suggestion after empty baseline: %v %v", ev, err)
	}
}
