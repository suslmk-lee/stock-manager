package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 오늘 살 종목 — 보유 종목 전체에 100점 만점 '오늘 점수'를 매겨 순위를 내고(아래 목록), 살 수 있는 앞의 7개가 추천 카드.
//   가격 매력 70 : 과거에 싸게 산 날이 평소보다 1년 뒤 더 번 정도(±30%p) × 지금 싼 정도 (price_zone.go)
//                  — 보유 156종목 백테스트(2018년 말~2025년 매달, 1년 뒤 총수익)에서 종목을 고르는 힘이 가장 일관됐다. 펀드는 거래소 가격이 없어 0 (다른 항목으로 넘기지 않는다).
//                  싸게 산 사례가 적은 종목(1년 하위 20%였던 날이 40일 미만 — 꾸준히 오른 종목·짧은 이력)과 가격대가 없는 주식(상장 1년 미만)은 0 대신 그날 다른 보유 종목의
//                  가격 매력 중간값 — 같은 백테스트에서 0보다 순위가 잘 맞았고, 적은 사례로 따로 추정하면 오히려 틀렸다.
//   매수 신호 15 : 매매 신호의 매수 조건을 얼마나 채웠나 ('매수 검토'면 만점)
//   배당 점수 10 : 배당 점수(종합 60% · 지금 수익률 매력 40%)
//   비중 여유  5 : 매수 최대 비중(없으면 20%)보다 낮을수록
//   예수금은 점수에 넣지 않는다 (살 계좌와 모자란 금액은 카드에 보여만 준다).
// 추천에서 빼는 종목 (목록에는 이유와 함께 남는다): 매도·충돌·시세 없음, 매매 신호가 매수를 막은 종목(최대 비중·반등 미확인),
// 오늘 이미 산 종목, 오늘 모으기로 사는 종목, 점수가 너무 낮은 종목. 최근에 사서 매수 신호가 쉬는 중(쉬는 기간)인 종목은 빼지 않는다.

const (
	todayPickCount   = 7    // 추천 카드 수 (넓은 화면의 커버플로우: 가운데 하나 + 양옆 셋씩)
	todayMinScore    = 20   // 이보다 낮으면 추천에 넣지 않는다
	todayDefaultMaxW = 20.0 // 매수 최대 비중을 정하지 않았을 때 비중 여유의 기준 (%)
	todaySeriesLen   = 60   // 카드 미니 차트 점 수

	todayPriceMax  = 70.0
	todaySignalMax = 15.0
	todayDivMax    = 10.0
	todayWeightMax = 5.0
)

// 추천에서 뺀 이유
const (
	TodayExSell        = "sell"
	TodayExConflict    = "conflict"
	TodayExNoPrice     = "no_price"
	TodayExBoughtToday = "bought_today"
	TodayExPlanned     = "planned"
	TodayExLowScore    = "low_score"
	// 그 밖에는 매매 신호의 BuyExcludedReason (max_weight | no_rebound — cooldown 은 빼지 않는다)
)

type TodayService struct {
	db       *gorm.DB
	signals  *SignalService
	divScore *DividendScoreService
	cash     *CashService
	accum    *AccumulationService
	ticker   *TickerService
	zones    *PriceZoneService
	now      func() time.Time

	// 마지막으로 계산한 결과 — 오늘 탭을 다시 열면 이것부터 보여 주고 새로 계산한다
	lastMu sync.Mutex
	last   *TodayPicks
}

// SetZones: 가격 매력(사기 좋은 가격)을 오늘 점수에 쓴다
func (s *TodayService) SetZones(z *PriceZoneService) { s.zones = z }

func NewTodayService(db *gorm.DB, signals *SignalService, divScore *DividendScoreService, cash *CashService, accum *AccumulationService, ticker *TickerService) *TodayService {
	return &TodayService{db: db, signals: signals, divScore: divScore, cash: cash, accum: accum, ticker: ticker, now: time.Now}
}

type TodayParts struct {
	Price    float64 `json:"price"`
	Signal   float64 `json:"signal"`
	Dividend float64 `json:"dividend"`
	Weight   float64 `json:"weight"`
	// 항목별 만점
	PriceMax    float64 `json:"price_max"`
	SignalMax   float64 `json:"signal_max"`
	DividendMax float64 `json:"dividend_max"`
	WeightMax   float64 `json:"weight_max"`
}

// TodayRow: 보유 종목 전체 순위 한 줄 (추천 카드와 같은 점수)
type TodayRow struct {
	Rank     int        `json:"rank"` // 오늘 점수 순위 (1부터)
	AssetID  uint       `json:"asset_id"`
	Ticker   string     `json:"ticker"`
	Name     string     `json:"name"`
	Currency string     `json:"currency"`
	Price    float64    `json:"price"`
	Score    float64    `json:"score"`
	Parts    TodayParts `json:"parts"`
	HasZone  bool       `json:"has_zone"`
	Expect   float64    `json:"expect"` // 과거 기준 평소보다 1년 뒤 더 기대되는 수익 (%p)
	Level    string     `json:"level,omitempty"`
	Pos1y    float64    `json:"pos_1y"`
	Good     float64    `json:"good"`
	Verdict  string     `json:"verdict,omitempty"`
	Falling  bool       `json:"falling"`
	Excluded string     `json:"excluded,omitempty"` // 추천에서 뺀 이유
	Pick     int        `json:"pick,omitempty"`     // 추천 순위 (1~todayPickCount)
	// 싸게 산 사례가 적어 가격 매력을 보유 종목 중간값으로 매김
	PriceNeutral bool        `json:"price_neutral,omitempty"`
	Held         []TodayHeld `json:"held,omitempty"` // 이 종목을 가진 계좌 (계좌별 순위용)
}

// TodayHeld: 한 계좌에 담긴 수량과 평가금액 (원화)
type TodayHeld struct {
	AccountID uint    `json:"account_id"`
	Qty       float64 `json:"qty"`
	ValueKRW  float64 `json:"value_krw"`
}

// TodayAccountCash: 계좌별 순위에 쓰는 계좌와 예수금 (보유 종목이 있는 계좌만)
type TodayAccountCash struct {
	ID          uint    `json:"id"`
	Name        string  `json:"name"`
	Broker      string  `json:"broker"`
	AccountType string  `json:"account_type"`
	NoCash      bool    `json:"no_cash"`
	KRW         float64 `json:"krw"`
	USD         float64 `json:"usd"`
	Count       int     `json:"count"` // 순위에 든 이 계좌의 종목 수
}

// TodayAccount: 이 종목을 살 계좌와 그 예수금 (종목 통화 기준)
type TodayAccount struct {
	ID       uint    `json:"id"`
	Name     string  `json:"name"`
	Broker   string  `json:"broker"`
	Currency string  `json:"currency"` // 예수금 통화
	Cash     float64 `json:"cash"`
	Need     float64 `json:"need"`  // 제안 금액 (예수금 통화)
	Short    float64 `json:"short"` // 모자란 금액 (0 이면 충분)
	NoCash   bool    `json:"no_cash"`
	// 원화·외화 따로 계좌에서 달러 종목을 살 때: 원화예수금(환전하면 쓸 수 있음)·계산 때 환율·직접 환전 수수료.
	// 지금 환전하면 원화가 얼마 드는지는 화면이 보는 시각(정규 시간 여부)으로 계산한다
	KRW          float64 `json:"krw,omitempty"`
	Fx           float64 `json:"fx,omitempty"`
	FxSpreadPct  float64 `json:"fx_spread_pct,omitempty"`
	FxDayDiscPct float64 `json:"fx_day_disc_pct,omitempty"`
	FxOffDiscPct float64 `json:"fx_off_disc_pct,omitempty"`
}

type TodayPick struct {
	Rank        int        `json:"rank"`
	AssetID     uint       `json:"asset_id"`
	Ticker      string     `json:"ticker"`
	Name        string     `json:"name"`
	Market      string     `json:"market"` // KR | US | JP …
	Currency    string     `json:"currency"`
	Score       float64    `json:"score"`
	Parts       TodayParts `json:"parts"`
	Action      string     `json:"action"`
	MetBuy      int        `json:"met_buy"`
	TotalBuy    int        `json:"total_buy"`
	DivRank     int        `json:"div_rank,omitempty"`
	Price       float64    `json:"price"`
	FromHighPct float64    `json:"from_high_pct"`
	WeightPct   float64    `json:"weight_pct"`
	Series      []float64  `json:"series"` // 최근 1년 종가 (오래된 것부터, 줄임)
	Reasons     []string   `json:"reasons"`
	Warn        string     `json:"warn,omitempty"` // 주의 (싸게 사도 안 통했던 종목)
	Note        string     `json:"note,omitempty"` // 참고 (아직 내려가는 중 — 기다려도 더 싸게 산 경우가 적었다는 것과 함께)
	// 참고 사실 — 점수에는 넣지 않음 (최근 3개월 지수보다 크게 빠진 하루 · PER/PBR/추정 EPS), today_facts.go
	Facts      []string      `json:"facts,omitempty"`
	Zone       *PriceZoneRow `json:"zone,omitempty"` // 사기 좋은 가격 (가장 최근 계산)
	SuggestQty float64       `json:"suggest_qty"`
	SuggestKRW float64       `json:"suggest_krw"`
	Account    *TodayAccount `json:"account,omitempty"`
}

// TodayPlan: 오늘 모으기로 사는 종목 (추천에서 뺀 이유를 보여 준다)
type TodayPlan struct {
	AssetID  uint    `json:"asset_id"`
	Name     string  `json:"name"`
	Account  string  `json:"account"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

type TodayPicks struct {
	Date       string      `json:"date"` // KST 오늘
	ComputedAt time.Time   `json:"computed_at"`
	Picks      []TodayPick `json:"picks"`
	Considered int         `json:"considered"` // 점수를 매긴 보유 종목 수
	Plans      []TodayPlan `json:"plans"`
	Ranking    []TodayRow  `json:"ranking"` // 보유 종목 전체 순위 (오늘 점수 높은 순)
	// 계좌별 순위: 종목을 담고 있는 계좌 (담은 종목 많은 순) — 화면이 Ranking 을 그 계좌 종목만 걸러 다시 순위를 매긴다
	Accounts []TodayAccountCash `json:"accounts,omitempty"`
	// 사기 좋은 가격: 마지막 계산 날짜·시각, 계산한 종목 수 / 보유 종목 수
	ZoneDate      string     `json:"zone_date"`
	ZoneUpdatedAt *time.Time `json:"zone_updated_at"`
	ZoneCount     int        `json:"zone_count"`
	ZoneHeld      int        `json:"zone_held"`
}

func marketOf(ticker string) string {
	switch c := tickerCurrency(ticker); {
	case IsFundTicker(ticker) || c == "KRW":
		return "KR"
	case c == "USD":
		return "US"
	case c == "JPY":
		return "JP"
	default:
		return c
	}
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// GetTodayPicks: 오늘 살 종목 (추천 카드 최대 todayPickCount 개)
// 신호 리포트·배당 점수·모으기·계좌·예수금·가격대는 서로 기다릴 필요가 없어 동시에 읽는다 (처음 열 때 시세를 받느라 각각 몇 초씩 걸린다).
func (s *TodayService) GetTodayPicks() (*TodayPicks, error) {
	now := s.now()
	today := todayKST(now)
	out := &TodayPicks{Date: today, ComputedAt: now, Picks: []TodayPick{}, Plans: []TodayPlan{}, Ranking: []TodayRow{}}

	var (
		wg       sync.WaitGroup
		report   *SignalReport
		repErr   error
		zoneList *PriceZoneList
		ranking  *DivScoreRanking
		plans    []AccumulationPlanView
		accs     []models.Account
		bals     []CashBalance
		cashFx   float64
	)
	run := func(f func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f()
		}()
	}
	run(func() { report, repErr = s.signals.buildSignalReport() })
	if s.zones != nil {
		run(func() { zoneList, _ = s.zones.GetLatest() }) // 백그라운드에서 계산해 둔 가장 최근 기록
	}
	if s.divScore != nil {
		run(func() { ranking, _ = s.divScore.GetRanking("") }) // 이번 달
	}
	if s.accum != nil {
		run(func() { plans, _ = s.accum.ListPlans() })
	}
	run(func() { _ = s.db.Find(&accs).Error })
	if s.cash != nil {
		run(func() { bals, cashFx, _ = s.cash.GetBalances() })
	}
	wg.Wait()
	if repErr != nil {
		return nil, repErr
	}

	// 사기 좋은 가격
	zones := map[uint]PriceZoneRow{}
	if zoneList != nil {
		out.ZoneDate, out.ZoneUpdatedAt, out.ZoneCount, out.ZoneHeld = zoneList.Date, zoneList.UpdatedAt, len(zoneList.Rows), zoneList.Held
		for _, r := range zoneList.Rows {
			zones[r.AssetID] = r
		}
	}
	// 배당 점수
	divRows := map[uint]DivScoreRow{}
	if ranking != nil {
		for _, row := range ranking.Rows {
			divRows[row.AssetID] = row
		}
	}
	// 오늘 모으기로 사는 종목 (계좌·종목)
	planned := map[uint]bool{}
	for _, p := range plans {
		if p.Status == models.PlanStatusActive && p.NextDate == today {
			planned[p.AssetID] = true
			out.Plans = append(out.Plans, TodayPlan{AssetID: p.AssetID, Name: p.Asset.Name, Account: accountLabelOf(p.Account), Amount: p.Amount, Currency: p.AmountCurrency})
		}
	}
	// 계좌·예수금
	accounts := map[uint]models.Account{}
	for _, a := range accs {
		accounts[a.ID] = a
	}
	balances := map[uint]CashBalance{}
	for _, b := range bals {
		balances[b.AccountID] = b
	}
	fx := report.USDKRW
	if cashFx > 0 {
		fx = cashFx
	}

	picks, rows := rankToday(report.Items, divRows, zones, planned, accounts, balances, fx, today)
	out.Considered = len(rows)
	out.Ranking = rows
	out.Accounts = todayAccounts(rows, accounts, balances)
	var sw sync.WaitGroup
	for i := range picks {
		sw.Add(1)
		go func(i int) {
			defer sw.Done()
			picks[i].Series = s.series(picks[i].Ticker)
		}(i)
	}
	sw.Wait()
	facts := s.pickFacts(picks) // 차트를 받으며 캐시된 일봉을 다시 쓴다
	for i := range picks {
		picks[i].Facts = facts[picks[i].AssetID]
	}
	out.Picks = picks

	s.lastMu.Lock()
	s.last = out
	s.lastMu.Unlock()
	s.saveSnapshot(out)
	return out, nil
}

const (
	todayCacheMaxAge  = 72 * time.Hour // 이보다 오래된 결과는 먼저 보여 주지 않는다
	todaySnapshotKeep = 7              // DB 에 남기는 날 수
)

// saveSnapshot: 그날 결과를 DB 에 남긴다 (앱을 새로 켜면 이것부터 보여 준다). 실패해도 화면에는 영향 없다.
func (s *TodayService) saveSnapshot(p *TodayPicks) {
	if s.db == nil {
		return
	}
	data, err := json.Marshal(p)
	if err != nil {
		return
	}
	row := models.TodaySnapshot{Date: p.Date, Data: string(data), ComputedAt: p.ComputedAt}
	err = s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "date"}},
		DoUpdates: clause.AssignmentColumns([]string{"data", "computed_at", "updated_at"}),
	}).Create(&row).Error
	if err != nil {
		log.Printf("[Today] 결과 저장 실패: %v", err)
		return
	}
	cutoff := s.now().In(kst).AddDate(0, 0, -todaySnapshotKeep).Format(dateLayout)
	s.db.Where("date < ?", cutoff).Delete(&models.TodaySnapshot{})
}

// GetTodayPicksCached: 마지막으로 계산한 결과 (이번 실행에서 계산한 것, 없으면 DB 에 남긴 것 — 3일 안, 없으면 nil).
// 날짜가 지난 결과일 수 있다 — 화면은 계산 시각을 함께 보여 주고 바로 새로 계산한다.
func (s *TodayService) GetTodayPicksCached() *TodayPicks {
	now := s.now()
	s.lastMu.Lock()
	last := s.last
	s.lastMu.Unlock()
	if last != nil && now.Sub(last.ComputedAt) <= todayCacheMaxAge {
		return last
	}
	if s.db == nil {
		return nil
	}
	var rows []models.TodaySnapshot
	if err := s.db.Order("computed_at DESC").Limit(1).Find(&rows).Error; err != nil || len(rows) == 0 {
		return nil
	}
	if now.Sub(rows[0].ComputedAt) > todayCacheMaxAge {
		return nil
	}
	var p TodayPicks
	if err := json.Unmarshal([]byte(rows[0].Data), &p); err != nil {
		return nil
	}
	return &p
}

// WarmAfter: 앱을 켜고 delay 뒤 한 번 계산해 둔다 (처음 오늘 탭을 열 때 기다리지 않게). 그사이 화면이 계산했으면 건너뛴다.
func (s *TodayService) WarmAfter(ctx context.Context, delay time.Duration) {
	select {
	case <-ctx.Done():
		return
	case <-time.After(delay):
	}
	s.lastMu.Lock()
	recent := s.last != nil && s.now().Sub(s.last.ComputedAt) < 5*time.Minute
	s.lastMu.Unlock()
	if recent {
		return
	}
	if _, err := s.GetTodayPicks(); err != nil {
		log.Printf("[Today] 미리 계산 오류: %v", err)
	}
}

// rankToday: 보유 종목 전체에 오늘 점수를 매겨 순위(rows)를 내고, 추천에서 뺄 종목을 표시한 뒤 앞의 todayPickCount 개를 카드(picks)로 만든다 (미니 차트는 붙이지 않는다).
func rankToday(items []SignalItem, divRows map[uint]DivScoreRow, zones map[uint]PriceZoneRow, planned map[uint]bool, accounts map[uint]models.Account, balances map[uint]CashBalance, fx float64, today string) ([]TodayPick, []TodayRow) {
	type scored struct {
		it        SignalItem
		row       TodayRow
		metLabels []string
		met, tot  int
		div       DivScoreRow
		hasDiv    bool
		zone      *PriceZoneRow
		maxW      float64
	}
	neutral := todayNeutralPrice(zones)
	var all []scored
	for _, it := range items {
		x := scored{it: it}
		r := TodayRow{AssetID: it.AssetID, Ticker: it.Ticker, Name: it.Name, Currency: it.Currency, Price: it.CurrentPrice}
		for _, ab := range it.Accounts {
			if ab.Quantity > 0 {
				r.Held = append(r.Held, TodayHeld{AccountID: ab.AccountID, Qty: ab.Quantity, ValueKRW: math.Round(ab.MarketValueKRW)})
			}
		}
		r.Parts = TodayParts{PriceMax: todayPriceMax, SignalMax: todaySignalMax, DividendMax: todayDivMax, WeightMax: todayWeightMax}
		// 가격 매력
		if z, ok := zones[it.AssetID]; ok {
			zz := z
			x.zone = &zz
			r.HasZone, r.Expect, r.Level, r.Pos1y, r.Good, r.Verdict, r.Falling = true, z.Expect, z.Level, z.Pos1y, z.Good, z.Verdict, z.Falling
			r.Parts.Price = todayPriceMax * clamp01(z.Score/100)
			if z.CheapDays < zoneMinCheapDays {
				r.Parts.Price, r.PriceNeutral = todayPriceMax*clamp01(neutral/100), true
			}
		} else if !IsFundTicker(it.Ticker) && it.CurrentPrice > 0 {
			// 가격대가 없는 주식(상장 1년 미만 등)도 사례가 적은 것과 같게 보유 종목 중간값 — 펀드는 거래소 가격이 없어 0
			r.Parts.Price, r.PriceNeutral = todayPriceMax*clamp01(neutral/100), true
		}
		// 매수 신호
		for _, c := range it.BuyChecks {
			x.tot++
			if c.Met {
				x.met++
				x.metLabels = append(x.metLabels, c.Label)
			}
		}
		sigFrac := 0.0
		if it.Action == SignalBuy {
			sigFrac = 1
		} else if x.tot > 0 {
			sigFrac = float64(x.met) / float64(x.tot)
		}
		r.Parts.Signal = todaySignalMax * sigFrac
		// 배당 점수
		x.div, x.hasDiv = divRows[it.AssetID]
		if x.hasDiv {
			r.Parts.Dividend = todayDivMax * clamp01(0.6*x.div.Score/100+0.4*x.div.Parts.Yield)
		}
		// 비중 여유
		x.maxW = it.BuyMaxWeightPct
		if x.maxW <= 0 {
			x.maxW = todayDefaultMaxW
		}
		r.Parts.Weight = todayWeightMax * clamp01(1-it.WeightPct/x.maxW)
		for _, v := range []*float64{&r.Parts.Price, &r.Parts.Signal, &r.Parts.Dividend, &r.Parts.Weight} {
			*v = math.Round(*v*10) / 10
		}
		r.Score = math.Round((r.Parts.Price+r.Parts.Signal+r.Parts.Dividend+r.Parts.Weight)*10) / 10
		// 추천에서 뺄 이유
		switch {
		case it.Action == SignalSell:
			r.Excluded = TodayExSell
		case it.Action == SignalConflict:
			r.Excluded = TodayExConflict
		case it.Action == SignalNoPrice || it.CurrentPrice <= 0:
			r.Excluded = TodayExNoPrice
		case it.BuyExcludedReason != "" && it.BuyExcludedReason != "cooldown":
			r.Excluded = it.BuyExcludedReason
		case it.LastBuyDate == today:
			r.Excluded = TodayExBoughtToday
		case planned[it.AssetID]:
			r.Excluded = TodayExPlanned
		case r.Score < todayMinScore:
			r.Excluded = TodayExLowScore
		}
		x.row = r
		all = append(all, x)
	}
	sort.SliceStable(all, func(i, j int) bool {
		a, b := all[i].row, all[j].row
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if a.Expect != b.Expect {
			return a.Expect > b.Expect
		}
		return a.Parts.Signal > b.Parts.Signal
	})
	rows := make([]TodayRow, 0, len(all))
	var picks []TodayPick
	for i := range all {
		x := &all[i]
		x.row.Rank = i + 1
		if x.row.Excluded == "" && len(picks) < todayPickCount {
			it := x.it
			p := TodayPick{Rank: len(picks) + 1, AssetID: it.AssetID, Ticker: it.Ticker, Name: it.Name, Market: marketOf(it.Ticker), Currency: it.Currency,
				Score: x.row.Score, Parts: x.row.Parts, Action: it.Action, MetBuy: x.met, TotalBuy: x.tot, Price: it.CurrentPrice,
				FromHighPct: it.FromHighPct, WeightPct: it.WeightPct, SuggestQty: it.SuggestedBuyQty, SuggestKRW: it.SuggestedBuyKRW, Zone: x.zone}
			if x.hasDiv {
				p.DivRank = x.div.Rank
			}
			p.Account = pickAccount(it, accounts, balances, fx) // 예수금은 점수에 넣지 않고 보여만 준다
			p.Reasons = todayReasons(it, p, x.metLabels, x.div, x.hasDiv, x.maxW)
			p.Warn = zoneWarn(p.Zone)
			p.Note = zoneNote(p.Zone)
			picks = append(picks, p)
			x.row.Pick = p.Rank
		}
		rows = append(rows, x.row)
	}
	return picks, rows
}

// todayNeutralPrice: 싸게 산 사례가 충분한 보유 종목들의 가격 매력(0~100) 중간값 — 사례가 적은 종목에 준다
func todayNeutralPrice(zones map[uint]PriceZoneRow) float64 {
	var v []float64
	for _, z := range zones {
		if z.CheapDays >= zoneMinCheapDays {
			v = append(v, z.Score)
		}
	}
	if len(v) == 0 {
		return 0
	}
	sort.Float64s(v)
	if len(v)%2 == 1 {
		return v[len(v)/2]
	}
	return (v[len(v)/2-1] + v[len(v)/2]) / 2
}

// todayAccounts: 순위에 든 종목을 담고 있는 계좌와 예수금 — 담은 종목이 많은 순 (같으면 계좌 번호 순)
func todayAccounts(rows []TodayRow, accounts map[uint]models.Account, balances map[uint]CashBalance) []TodayAccountCash {
	count := map[uint]int{}
	for _, r := range rows {
		for _, h := range r.Held {
			count[h.AccountID]++
		}
	}
	var out []TodayAccountCash
	for id, n := range count {
		acc, ok := accounts[id]
		if !ok {
			continue
		}
		b := balances[id]
		out = append(out, TodayAccountCash{ID: id, Name: acc.Name, Broker: acc.Broker, AccountType: string(acc.AccountType), NoCash: acc.NoCash, KRW: math.Round(b.KRW), USD: math.Round(b.USD*100) / 100, Count: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// pickAccount: 이 종목을 가진 계좌 가운데 그 종목을 살 예수금이 가장 넉넉한 곳 (예수금 기록 안 하는 계좌는 늘 충분).
// 고르는 순서: 예수금으로 바로 살 수 있는 계좌 → 원화를 환전하면 살 수 있는 계좌(원화·외화 따로) → 가장 많이 채우는 계좌
func pickAccount(it SignalItem, accounts map[uint]models.Account, balances map[uint]CashBalance, fx float64) *TodayAccount {
	assetCcy := tickerCurrency(it.Ticker)
	needKRW := it.SuggestedBuyKRW
	if needKRW <= 0 {
		needKRW = it.CurrentPrice // 제안이 없으면 1주
		if assetCcy == "USD" && fx > 0 {
			needKRW *= fx
		}
	}
	var best *TodayAccount
	bestLevel, bestFrac := -1, -1.0
	for _, ab := range it.Accounts {
		acc, ok := accounts[ab.AccountID]
		if !ok {
			continue
		}
		b := balances[ab.AccountID]
		t := &TodayAccount{ID: acc.ID, Name: acc.Name, Broker: acc.Broker, NoCash: acc.NoCash}
		// 예수금 통화: 국내 종목은 원화, 미국 종목은 달러 (원화로 바로 결제하는 계좌는 원화, 자동 환전은 달러 + 원화)
		switch {
		case assetCcy != "USD" || acc.ForeignSettle == models.SettleKRW:
			t.Currency, t.Cash, t.Need = "KRW", b.KRW, needKRW
		case acc.ForeignSettle == models.SettleAutoFX && fx > 0:
			t.Currency, t.Cash, t.Need = "USD", b.USD+b.KRW/fx, needKRW/fx
		default:
			t.Currency, t.Cash = "USD", b.USD
			if fx > 0 {
				t.Need = needKRW / fx
				// 원화·외화 따로: 원화예수금은 직접 환전하면 쓸 수 있다
				if !acc.NoCash && b.KRW > 0 {
					t.KRW, t.Fx = math.Round(b.KRW), fx
					if acc.HasFxFee() {
						t.FxSpreadPct, t.FxDayDiscPct, t.FxOffDiscPct = acc.FxSpreadPct, acc.FxDayDiscPct, acc.FxOffDiscPct
					}
				}
			}
		}
		level, frac := 2, 1.0
		if !acc.NoCash && t.Need > 0 {
			frac = t.Cash / t.Need
			if t.Cash < t.Need {
				level = 0
				if t.KRW > 0 {
					// 환전하면: 그 외 시간 수수료(더 비싼 쪽)로 넉넉히 본다
					fee := 0.0
					if acc.HasFxFee() {
						fee = math.Max(acc.FxFeePctDay(), acc.FxFeePctOff())
					}
					frac = (math.Max(t.Cash, 0) + t.KRW/(t.Fx*(1+fee/100))) / t.Need
					if frac >= 1 {
						level = 1
					}
				}
			}
		}
		if acc.NoCash || t.Cash >= t.Need {
			t.Short = 0
		} else {
			t.Short = t.Need - math.Max(t.Cash, 0)
		}
		if level > bestLevel || (level == bestLevel && frac > bestFrac) {
			best, bestLevel, bestFrac = t, level, frac
		}
	}
	if best != nil {
		round := func(v float64) float64 {
			if best.Currency == "KRW" {
				return math.Round(v)
			}
			return math.Round(v*100) / 100
		}
		best.Cash, best.Need, best.Short = round(best.Cash), round(best.Need), round(best.Short)
	}
	return best
}

// todayReasons: 카드에 보일 고른 이유 (많아야 3줄)
func todayReasons(it SignalItem, p TodayPick, metLabels []string, row DivScoreRow, hasDiv bool, maxW float64) []string {
	var out []string
	switch {
	case it.Action == SignalBuy && len(metLabels) > 0:
		out = append(out, "매수 신호 · "+strings.Join(firstN(metLabels, 2), " · "))
	case it.Action == SignalBuy:
		out = append(out, "매수 신호")
	}
	zoneLine := false
	if z := p.Zone; z != nil {
		zoneLine = true
		if z.Expect > 0 {
			out = append(out, fmt.Sprintf("과거 기준 1년 뒤 평소보다 %+.1f%%p (싸게 산 날 %+.1f%% · 평소 %+.1f%%)", z.Expect, z.CheapAvg, z.AllAvg))
		}
		switch z.Level {
		case models.ZoneLevelGreat:
			out = append(out, fmt.Sprintf("1년 중 하위 %.0f%% 가격 · 아주 좋은 가격 %s 이하", z.Pos1y, holdingMoney(z.Great, z.Currency)))
		case models.ZoneLevelGood:
			out = append(out, fmt.Sprintf("1년 중 하위 %.0f%% 가격 · 좋은 가격 %s 이하", z.Pos1y, holdingMoney(z.Good, z.Currency)))
		default:
			out = append(out, fmt.Sprintf("1년 중 하위 %.0f%% 가격 · 좋은 가격은 %s 이하", z.Pos1y, holdingMoney(z.Good, z.Currency)))
		}
	}
	if it.Action != SignalBuy && p.MetBuy > 0 {
		out = append(out, fmt.Sprintf("매수 조건 %d/%d 충족 · %s", p.MetBuy, p.TotalBuy, metLabels[0]))
	}
	if hasDiv {
		out = append(out, fmt.Sprintf("배당 점수 %d위 · %.0f점", row.Rank, row.Score))
	}
	if p.WeightPct < maxW*0.6 {
		if it.BuyMaxWeightPct > 0 {
			out = append(out, fmt.Sprintf("비중 %.1f%% (최대 %.0f%%)", p.WeightPct, it.BuyMaxWeightPct))
		} else {
			out = append(out, fmt.Sprintf("비중 %.1f%%", p.WeightPct))
		}
	}
	if len(out) < 3 && it.FromHighPct <= -5 && !zoneLine {
		out = append(out, fmt.Sprintf("52주 고점 대비 %.1f%%", it.FromHighPct))
	}
	if len(out) < 3 && it.DaysSinceLastBuy > 0 {
		out = append(out, fmt.Sprintf("마지막 매수 %d일 전", it.DaysSinceLastBuy))
	}
	return firstN(out, 3)
}

// zoneWarn: 가격이 싸 보여도 조심할 점 (싸게 사도 과거에 안 통했던 종목)
func zoneWarn(z *PriceZoneRow) string {
	if z == nil || !(z.InZone() || z.Pos1y <= 30) || z.Verdict != models.ZoneVerdictTrap {
		return ""
	}
	return fmt.Sprintf("싸게 사도 과거엔 1년 뒤 평균 %+.1f%% (평소 %+.1f%%)", z.CheapAvg, z.AllAvg)
}

// zoneNote: 참고할 흐름 — 아직 내려가는 중. 기다리라는 뜻이 아니다: 보유 종목 백테스트(2018년 말~2025년)에서
// 가격 매력 상위 종목이 내려가는 중일 때 멈출 때까지 기다렸다 사면 보통 3거래일 뒤, 평균 0.4% 더 비쌌고 더 싸게 산 경우는 30%였다
// (1년 뒤 수익도 내려가는 중이던 때와 아닐 때가 같았다).
func zoneNote(z *PriceZoneRow) string {
	if z == nil || !z.Falling || !(z.InZone() || z.Pos1y <= 30) {
		return ""
	}
	return fmt.Sprintf("아직 내려가는 중 (20일선 %s 아래) · 과거엔 멈출 때까지 기다려도 더 싸게 산 경우가 30%%뿐", holdingMoney(z.MA20, z.Currency))
}

func firstN(xs []string, n int) []string {
	if len(xs) > n {
		return xs[:n]
	}
	return xs
}

func accountLabelOf(a models.Account) string {
	return holdingAccountLabel(a.Name, a.Broker)
}

// series: 최근 1년 종가를 카드 미니 차트용으로 줄인다 (가격 위치가 1년 기준이라)
func (s *TodayService) series(ticker string) []float64 {
	if s.ticker == nil {
		return []float64{}
	}
	var h *PriceHistory
	var err error
	if IsFundTicker(ticker) {
		h, err = s.ticker.GetPriceHistory(ticker, "1y", "1d")
	} else {
		h, err = s.ticker.GetDailyHistoryCached(ticker)
	}
	if err != nil || h == nil || len(h.Points) == 0 {
		return []float64{}
	}
	var closes []float64
	for _, p := range h.Points {
		if p.Close > 0 {
			closes = append(closes, p.Close)
		}
	}
	if len(closes) <= todaySeriesLen {
		return closes
	}
	out := make([]float64, 0, todaySeriesLen)
	for i := 0; i < todaySeriesLen; i++ {
		out = append(out, closes[i*(len(closes)-1)/(todaySeriesLen-1)])
	}
	return out
}
