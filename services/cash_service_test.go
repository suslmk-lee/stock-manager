package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type cashFixture struct {
	svc *CashService
	db  *gorm.DB
}

func newCashFixture(t *testing.T) *cashFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.Transaction{}, &models.Dividend{}, &models.CashEntry{}); err != nil {
		t.Fatal(err)
	}
	svc := NewCashService(db, nil)
	svc.now = func() time.Time { return time.Date(2026, 11, 12, 3, 0, 0, 0, time.UTC) } // 11/12 12:00 KST
	svc.fxHistory = func() (*PriceHistory, error) {
		return &PriceHistory{Symbol: "KRW=X", Points: []PricePoint{
			{Time: cashDay("2026-11-01").Unix(), Close: 1400},
			{Time: cashDay("2026-11-10").Unix(), Close: 1450},
		}}, nil
	}
	svc.prices = func(ts []string) map[string]float64 {
		out := map[string]float64{}
		for _, t := range ts {
			out[t] = map[string]float64{"SCHD": 28, "NVDA": 170}[t]
		}
		return out
	}
	return &cashFixture{svc: svc, db: db}
}

func cashDay(s string) time.Time {
	d, _ := time.Parse(dateLayout, s)
	return d
}

func cashNear(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func (f *cashFixture) account(t *testing.T, name, settle string) models.Account {
	t.Helper()
	a := models.Account{Name: name, Broker: "테스트", MarketType: models.MarketTypeInternational, Currency: "USD", ForeignSettle: settle}
	if err := f.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	return a
}

func (f *cashFixture) asset(t *testing.T, ticker string) models.Asset {
	t.Helper()
	a := models.Asset{Ticker: ticker, Name: ticker + " Inc", Type: models.AssetTypeStock}
	if err := f.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	return a
}

func (f *cashFixture) tx(t *testing.T, acc, asset uint, typ models.TransactionType, day string, price, qty, fee float64) {
	t.Helper()
	if err := f.db.Create(&models.Transaction{AccountID: acc, AssetID: asset, Type: typ, Date: cashDay(day), Price: price, Quantity: qty, Fee: fee}).Error; err != nil {
		t.Fatal(err)
	}
}

// 달러 계좌: 입금 + 매수(수수료 포함) + 매도(수수료 뺌) + 받은 배당(세후). 예정 배당은 빼고, 흐름마다 잔액이 쌓인다.
func TestCashUSDAccountFlows(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "달러", "USD")
	schd := f.asset(t, "SCHD")
	if _, err := f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "USD", Date: "2026-11-01", Kind: "deposit", Amount: 1000}); err != nil {
		t.Fatal(err)
	}
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeBuy, "2026-11-02", 27, 10, 0.3)
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeSell, "2026-11-05", 28, 2, 0.5)
	f.db.Create(&models.Dividend{AccountID: acc.ID, AssetID: schd.ID, Date: cashDay("2026-11-07"), Amount: 3, Tax: 0.45, Currency: "USD", IsReceived: true})
	f.db.Create(&models.Dividend{AccountID: acc.ID, AssetID: schd.ID, Date: cashDay("2026-11-20"), Amount: 9, Currency: "USD", IsReceived: false})
	f.db.Create(&models.Holding{AccountID: acc.ID, AssetID: schd.ID, Quantity: 8, AveragePrice: 27}) // 거래를 직접 넣어 보유는 따로

	sum, err := f.svc.GetSummary(acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := 1000 - 270.3 + 55.5 + 2.55
	if !cashNear(sum.USD, math.Round(want*100)/100) || sum.KRW != 0 {
		t.Fatalf("balance = %+v, want USD %.2f", sum.CashBalance, want)
	}
	if len(sum.Flows) != 4 || sum.Flows[0].Kind != "dividend" || !cashNear(sum.Flows[0].Balance, want) || sum.Flows[3].Kind != models.CashDeposit {
		t.Fatalf("flows = %+v", sum.Flows)
	}
	// 계좌 총액 = 주식 평가금(8주 × $28 × 1450) + 예수금(× 1450)
	if sum.StockValueKRW == nil || *sum.StockValueKRW != math.Round(8*28*1450) || sum.TotalKRW == nil || math.Abs(*sum.TotalKRW-(8*28*1450+want*1450)) > 1 {
		t.Fatalf("totals = %v %v", sum.StockValueKRW, sum.TotalKRW)
	}
}

// 원화 결제 계좌: 미국 주식 매수·배당이 그날 환율로 원화 예수금에서 빠지고 들어온다
func TestCashKRWSettledAccount(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "카카오페이", "KRW")
	nvda := f.asset(t, "NVDA")
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "KRW", Date: "2026-11-01", Kind: "deposit", Amount: 100000})
	f.tx(t, acc.ID, nvda.ID, models.TransactionTypeBuy, "2026-11-10", 158, 0.004, 0)
	f.db.Create(&models.Dividend{AccountID: acc.ID, AssetID: nvda.ID, Date: cashDay("2026-11-11"), Amount: 0.01, Currency: "USD", IsReceived: true})

	sum, err := f.svc.GetSummary(acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := 100000 - 158*0.004*1450 + 0.01*1450
	if !cashNear(sum.KRW, math.Round(want*100)/100) || sum.USD != 0 {
		t.Fatalf("balance = %+v want KRW %.2f", sum.CashBalance, want)
	}
	buy := sum.Flows[1]
	if buy.Kind != "buy" || buy.Currency != "KRW" || buy.Fx != 1450 || !cashNear(buy.Amount, -916.4) {
		t.Fatalf("buy flow = %+v", buy)
	}
}

// 잔액 맞추기: 계산 잔액과의 차이만큼 조정 기록, 이미 맞으면 기록하지 않음
func TestCashReconcile(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "달러", "USD")
	schd := f.asset(t, "SCHD")
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeBuy, "2026-11-02", 27, 10, 0) // 입금 기록이 없어 −270

	e, err := f.svc.Reconcile(acc.ID, CashReconcileRequest{Currency: "USD", Balance: 512.34})
	if err != nil || e == nil || !cashNear(e.Amount, 782.34) || e.Kind != models.CashAdjust || dayString(e.Date) != "2026-11-12" {
		t.Fatalf("adjust = %+v err %v", e, err)
	}
	if again, err := f.svc.Reconcile(acc.ID, CashReconcileRequest{Currency: "USD", Balance: 512.34}); err != nil || again != nil {
		t.Fatalf("second reconcile = %+v err %v", again, err)
	}
	bals, _, err := f.svc.GetBalances()
	if err != nil || len(bals) != 1 || !cashNear(bals[0].USD, 512.34) || bals[0].LastAdjusted != "2026-11-12" {
		t.Fatalf("balances = %+v err %v", bals, err)
	}
}

// 환전: 원화 −, 달러 + 두 줄이 한 쌍. 하나를 지우면 둘 다 지워진다.
func TestCashExchangeAndDelete(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "달러", "USD")
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "KRW", Date: "2026-11-01", Kind: "deposit", Amount: 200000})
	pair, err := f.svc.CreateExchange(acc.ID, CashExchangeRequest{Date: "2026-11-02", FromCurrency: "KRW", FromAmount: 145000, ToAmount: 100})
	if err != nil || len(pair) != 2 || pair[0].PairID == nil || *pair[0].PairID != pair[1].ID {
		t.Fatalf("pair = %+v err %v", pair, err)
	}
	sum, _ := f.svc.GetSummary(acc.ID)
	if !cashNear(sum.KRW, 55000) || !cashNear(sum.USD, 100) {
		t.Fatalf("after exchange = %+v", sum.CashBalance)
	}
	if err := f.svc.DeleteEntry(pair[1].ID); err != nil {
		t.Fatal(err)
	}
	sum, _ = f.svc.GetSummary(acc.ID)
	if !cashNear(sum.KRW, 200000) || sum.USD != 0 {
		t.Fatalf("after delete = %+v", sum.CashBalance)
	}
}

func TestCashValidation(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "달러", "USD")
	bad := []CashEntryRequest{
		{Currency: "EUR", Kind: "deposit", Amount: 1},
		{Currency: "USD", Kind: "deposit", Amount: 0},
		{Currency: "USD", Kind: "adjust", Amount: 1},
		{Currency: "USD", Kind: "deposit", Amount: 1, Date: "2026/11/01"},
	}
	for i, r := range bad {
		if _, err := f.svc.CreateEntry(acc.ID, r); err == nil {
			t.Fatalf("case %d: want error", i)
		} else if _, ok := err.(*CashInputError); !ok {
			t.Fatalf("case %d: error type %T", i, err)
		}
	}
	if _, err := f.svc.CreateEntry(9999, CashEntryRequest{Currency: "USD", Kind: "deposit", Amount: 1}); err != ErrCashNotFound {
		t.Fatalf("missing account err = %v", err)
	}
	// 출금은 양수로 받아 음수로 저장
	e, err := f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "USD", Kind: "withdraw", Amount: 50})
	if err != nil || e.Amount != -50 {
		t.Fatalf("withdraw = %+v err %v", e, err)
	}
}

// 매도 대금 결제일: 국내 2영업일, 미국 1영업일 (주말 건너뜀)
func TestCashSettleDay(t *testing.T) {
	cases := []struct{ day, ticker, want string }{
		{"2026-11-13", "005930.KS", "2026-11-17"}, // 금 → 화
		{"2026-11-11", "005930.KS", "2026-11-13"}, // 수 → 금
		{"2026-11-13", "SCHD", "2026-11-16"},      // 금 → 월
		{"2026-11-10", "SCHD", "2026-11-11"},      // 화 → 수
	}
	for _, c := range cases {
		if got := settleDay(c.day, c.ticker); got != c.want {
			t.Errorf("settleDay(%s, %s) = %s, want %s", c.day, c.ticker, got, c.want)
		}
	}
}

// 출금 가능 금액 = 예수금 − 아직 결제되지 않은 매도 대금
func TestCashWithdrawable(t *testing.T) {
	f := newCashFixture(t) // 오늘 11/12 (목) KST
	acc := f.account(t, "달러", "USD")
	schd := f.asset(t, "SCHD")
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "USD", Date: "2026-11-01", Kind: "deposit", Amount: 100})
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeSell, "2026-11-10", 28, 1, 0) // 11/11 결제 — 끝남
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeSell, "2026-11-12", 30, 2, 0) // 11/13 결제 — 대기

	sum, err := f.svc.GetSummary(acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !cashNear(sum.USD, 188) || !cashNear(sum.WithdrawableUSD, 128) || sum.WithdrawableKRW != 0 {
		t.Fatalf("usd %.2f withdrawable %.2f / %.0f", sum.USD, sum.WithdrawableUSD, sum.WithdrawableKRW)
	}
	if len(sum.Pending) != 1 || sum.Pending[0].SettleDate != "2026-11-13" || !cashNear(sum.Pending[0].Amount, 60) {
		t.Fatalf("pending = %+v", sum.Pending)
	}
}

// 그래프용 날짜별 잔액: 잔액 맞추기가 있으면 그 날부터, 없으면 첫 현금 기록부터, 현금 기록이 없으면 빼기
func TestCashTimelines(t *testing.T) {
	f := newCashFixture(t)
	nvda := f.asset(t, "NVDA")

	recon := f.account(t, "맞춘 계좌", "USD")
	f.tx(t, recon.ID, nvda.ID, models.TransactionTypeBuy, "2026-11-02", 150, 1, 0) // 입금 기록 없이 산 것 → 그 전 계산은 믿을 수 없다
	if _, err := f.svc.Reconcile(recon.ID, CashReconcileRequest{Currency: "USD", Balance: 40, Date: "2026-11-05"}); err != nil {
		t.Fatal(err)
	}
	f.svc.CreateEntry(recon.ID, CashEntryRequest{Currency: "USD", Date: "2026-11-09", Kind: "deposit", Amount: 10})

	plain := f.account(t, "입금만", "USD")
	f.svc.CreateEntry(plain.ID, CashEntryRequest{Currency: "USD", Date: "2026-11-03", Kind: "deposit", Amount: 50})

	none := f.account(t, "기록 없음", "USD")
	f.tx(t, none.ID, nvda.ID, models.TransactionTypeBuy, "2026-11-02", 150, 1, 0)

	tls := f.svc.Timelines()
	if len(tls) != 2 {
		t.Fatalf("timelines = %d, want 2 (현금 기록 없는 계좌는 뺀다)", len(tls))
	}
	byID := map[uint]CashTimeline{}
	for _, tl := range tls {
		byID[tl.AccountID] = tl
	}
	r := byID[recon.ID]
	if r.Start != "2026-11-05" {
		t.Fatalf("start = %s", r.Start)
	}
	check := func(tl CashTimeline, day string, wantUSD float64, wantOK bool) {
		t.Helper()
		_, usd, ok := tl.At(day)
		if ok != wantOK || (ok && !cashNear(usd, wantUSD)) {
			t.Errorf("%d At(%s) = %.2f %v, want %.2f %v", tl.AccountID, day, usd, ok, wantUSD, wantOK)
		}
	}
	check(r, "2026-11-04", 0, false)
	check(r, "2026-11-05", 40, true)
	check(r, "2026-11-08", 40, true)
	check(r, "2026-11-09", 50, true)
	check(r, "2026-12-01", 50, true)
	p := byID[plain.ID]
	check(p, "2026-11-02", 0, false)
	check(p, "2026-11-03", 50, true)
}

// 자산 추이: 예수금을 총자산·인출 가능/제한에 더한다 (달러는 그날 환율)
func TestAddCashToSeries(t *testing.T) {
	liquid := CashTimeline{AccountID: 1, Start: "2026-11-02", days: []string{"2026-11-01", "2026-11-03"}, krw: []float64{1000, 3000}, usd: []float64{0, 10}}
	pension := CashTimeline{AccountID: 2, Restricted: true, Start: "2026-11-01", days: []string{"2026-11-01"}, krw: []float64{500}, usd: []float64{0}}
	pts := []DailyPoint{
		{Date: "2026-11-01", TotalKRW: 100, LiquidKRW: 100, UsdKrw: 1400},
		{Date: "2026-11-02", TotalKRW: 100, LiquidKRW: 100, UsdKrw: 1400},
		{Date: "2026-11-04", TotalKRW: 100, LiquidKRW: 100}, // 환율 없음 → 현재 환율
	}
	addCashToSeries(pts, []CashTimeline{liquid, pension}, func() float64 { return 1500 })
	want := []struct{ cash, total, liquid, restricted float64 }{
		{500, 600, 100, 500},       // 첫 계좌는 시작 전
		{1500, 1600, 1100, 500},    // 1000 + 500
		{18500, 18600, 18100, 500}, // 3000 + $10×1500 + 500
	}
	for i, w := range want {
		p := pts[i]
		if !cashNear(p.CashKRW, w.cash) || !cashNear(p.TotalKRW, w.total) || !cashNear(p.LiquidKRW, w.liquid) || !cashNear(p.RestrictedKRW, w.restricted) {
			t.Errorf("%s = %+v, want %+v", p.Date, p, w)
		}
	}
}

// 월별 요약: 월초 기준이라 전달 말일 잔액, 통화별 행
func TestCashMonthRows(t *testing.T) {
	tl := CashTimeline{AccountID: 7, Start: "2026-09-15", days: []string{"2026-09-15", "2026-10-31", "2026-11-05"}, krw: []float64{1000, 2000, 9000}, usd: []float64{0, 5, 5}}
	window := []monthKey{{2026, 9}, {2026, 10}, {2026, 11}}
	rows := cashMonthRows(window, []CashTimeline{tl}, map[monthKey]bool{{2026, 10}: true})
	// 9월: 8/31 은 시작 전 → 없음 · 10월: 9/30 잔액 ₩1000 · 11월: 10/31 잔액 ₩2000 + $5
	if len(rows) != 3 {
		t.Fatalf("rows = %+v", rows)
	}
	if r := rows[0]; r.Month != 10 || r.Currency != "KRW" || r.TotalValue != 1000 || r.Estimated || !r.Cash {
		t.Errorf("oct = %+v", r)
	}
	if r := rows[1]; r.Month != 11 || r.Currency != "KRW" || r.TotalValue != 2000 || !r.Estimated {
		t.Errorf("nov krw = %+v", r)
	}
	if r := rows[2]; r.Month != 11 || r.Currency != "USD" || r.TotalValue != 5 {
		t.Errorf("nov usd = %+v", r)
	}
}

// 자동 환전(통합증거금): 달러 먼저, 모자란 만큼 원화에서 그날 환율 + 수수료로 바꾼다. 같은 날 매도 대금은 먼저 쓴다.
func TestCashAutoFX(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "통합증거금", models.SettleAutoFX)
	f.db.Model(&acc).Update("fx_fee_pct", 0.25)
	schd := f.asset(t, "SCHD")
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "KRW", Date: "2026-11-01", Kind: "deposit", Amount: 100000})
	f.svc.CreateEntry(acc.ID, CashEntryRequest{Currency: "USD", Date: "2026-11-01", Kind: "deposit", Amount: 10})
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeBuy, "2026-11-10", 27, 0.5, 0)  // $13.50 → 달러 $10 + 원화로 $3.50
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeSell, "2026-11-11", 28, 0.1, 0) // +$2.80 (같은 날 매수보다 먼저)
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeBuy, "2026-11-11", 28, 0.2, 0)  // $5.60 → $2.80 쓰고 $2.80 원화로

	sum, err := f.svc.GetSummary(acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	k1 := math.Round(3.5 * 1450 * 1.0025) // 5088
	k2 := math.Round(2.8 * 1450 * 1.0025) // 4070
	if !cashNear(sum.USD, 0) || !cashNear(sum.KRW, 100000-k1-k2) {
		t.Fatalf("balance = %+v, want USD 0 KRW %.0f", sum.CashBalance, 100000-k1-k2)
	}
	auto := 0
	for _, fl := range sum.Flows {
		if fl.Kind == "autofx" {
			auto++
			if fl.Currency == "USD" && !(cashNear(fl.Amount, 3.5) || cashNear(fl.Amount, 2.8)) {
				t.Errorf("autofx usd = %+v", fl)
			}
			if !cashNear(fl.Fx, 1450*1.0025) {
				t.Errorf("autofx fx = %v", fl.Fx)
			}
		}
		if fl.Currency == "USD" && fl.Balance < -0.001 {
			t.Errorf("달러 잔액이 마이너스가 되면 안 된다: %+v", fl)
		}
	}
	if auto != 4 {
		t.Fatalf("autofx lines = %d, want 4 (두 번 × 원화·달러)", auto)
	}

	// 달러를 잔액 맞추기로 넉넉히 맞추면 그 뒤 매수는 원화를 쓰지 않는다
	f.svc.Reconcile(acc.ID, CashReconcileRequest{Currency: "USD", Balance: 100, Date: "2026-11-11"})
	f.tx(t, acc.ID, schd.ID, models.TransactionTypeBuy, "2026-11-12", 28, 1, 0)
	sum, _ = f.svc.GetSummary(acc.ID)
	if !cashNear(sum.USD, 72) || !cashNear(sum.KRW, 100000-k1-k2) {
		t.Fatalf("after reconcile = %+v", sum.CashBalance)
	}
}

// 원화로 바로(KRW) 계좌의 자동 환전 수수료: 살 때는 환율 +, 배당은 환율 −
func TestCashKRWFee(t *testing.T) {
	f := newCashFixture(t)
	acc := f.account(t, "원화 주문", models.SettleKRW)
	f.db.Model(&acc).Update("fx_fee_pct", 1)
	nvda := f.asset(t, "NVDA")
	f.tx(t, acc.ID, nvda.ID, models.TransactionTypeBuy, "2026-11-10", 100, 0.1, 0)
	f.db.Create(&models.Dividend{AccountID: acc.ID, AssetID: nvda.ID, Date: cashDay("2026-11-10"), Amount: 1, Currency: "USD", IsReceived: true})
	sum, err := f.svc.GetSummary(acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := -10*1450*1.01 + 1*1450*0.99
	if !cashNear(sum.KRW, math.Round(want*100)/100) || sum.USD != 0 {
		t.Fatalf("balance = %+v, want KRW %.2f", sum.CashBalance, want)
	}
}

// 예수금 구성 값 검사
func TestValidSettle(t *testing.T) {
	for _, v := range []string{models.SettleUSD, models.SettleKRW, models.SettleAutoFX} {
		if !validSettle(v) {
			t.Errorf("%s 는 받아야 한다", v)
		}
	}
	if validSettle("JPY") || validSettle("") {
		t.Error("모르는 값은 거절해야 한다")
	}
	if validFxFee(-0.1) || validFxFee(5.1) || !validFxFee(0) || !validFxFee(0.25) {
		t.Error("수수료는 0~5%")
	}
}
