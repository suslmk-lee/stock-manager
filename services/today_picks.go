package services

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

// 오늘 살 종목 Top 3 — 보유 종목마다 100점 만점 '오늘 점수'를 매겨 높은 순으로 3개.
//   가격 매력 30 : 사기 좋은 가격(price_zone.go)의 가격 매력 — 자기 과거 가격·배당률 대비 지금 얼마나 싼가
//   매수 신호 25 : 매매 신호의 매수 조건을 얼마나 채웠나 ('매수 검토'면 만점)
//   배당 점수 20 : 배당 점수(종합 60% · 지금 수익률 매력 40%)
//   비중 여유 10 : 매수 최대 비중(없으면 20%)보다 낮을수록
//   살 돈     15 : 그 종목을 살 계좌의 예수금이 제안 금액을 얼마나 채우나 (예수금 기록 안 하는 계좌는 만점)
//   배당 점수나 가격 매력이 없는 종목(배당 없음 · 이력 1년 미만)은 그 몫을 매수 신호에 더한다.
// 빼는 종목: 매도·충돌·시세 없음, 매매 신호가 매수를 막은 종목(쉬는 기간·최대 비중·반등 미확인), 오늘 이미 산 종목, 오늘 모으기로 사는 종목.

const (
	todayPickCount   = 3
	todayMinScore    = 35  // 이보다 낮으면 추천하지 않는다
	todayDefaultMaxW = 20.0 // 매수 최대 비중을 정하지 않았을 때 비중 여유의 기준 (%)
	todaySeriesLen   = 60  // 카드 미니 차트 점 수

	todayPriceMax  = 30.0
	todaySignalMax = 25.0
	todayDivMax    = 20.0
	todayWeightMax = 10.0
	todayCashMax   = 15.0
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
	Cash     float64 `json:"cash"`
	// 항목별 만점 (배당 점수·가격 매력이 없으면 그 몫이 신호로 간다)
	PriceMax    float64 `json:"price_max"`
	SignalMax   float64 `json:"signal_max"`
	DividendMax float64 `json:"dividend_max"`
	WeightMax   float64 `json:"weight_max"`
	CashMax     float64 `json:"cash_max"`
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
}

type TodayPick struct {
	Rank        int           `json:"rank"`
	AssetID     uint          `json:"asset_id"`
	Ticker      string        `json:"ticker"`
	Name        string        `json:"name"`
	Market      string        `json:"market"` // KR | US | JP …
	Currency    string        `json:"currency"`
	Score       float64       `json:"score"`
	Parts       TodayParts    `json:"parts"`
	Action      string        `json:"action"`
	MetBuy      int           `json:"met_buy"`
	TotalBuy    int           `json:"total_buy"`
	DivRank     int           `json:"div_rank,omitempty"`
	Price       float64       `json:"price"`
	FromHighPct float64       `json:"from_high_pct"`
	WeightPct   float64       `json:"weight_pct"`
	Series      []float64     `json:"series"` // 최근 1년 종가 (오래된 것부터, 줄임)
	Reasons     []string      `json:"reasons"`
	Warn        string        `json:"warn,omitempty"` // 주의 (아직 내려가는 중 · 싸게 사도 안 통했던 종목)
	Zone        *PriceZoneRow `json:"zone,omitempty"` // 사기 좋은 가격 (가장 최근 계산)
	SuggestQty  float64       `json:"suggest_qty"`
	SuggestKRW  float64       `json:"suggest_krw"`
	Account     *TodayAccount `json:"account,omitempty"`
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
	Picks      []TodayPick `json:"picks"`
	Considered int         `json:"considered"` // 점수를 매긴 종목 수
	Plans      []TodayPlan `json:"plans"`
	// 사기 좋은 가격: 마지막 계산 날짜·시각, 계산한 종목 수 / 보유 종목 수, 좋은 가격대에 있는 종목 (가격 매력 높은 순)
	ZoneDate      string         `json:"zone_date"`
	ZoneUpdatedAt *time.Time     `json:"zone_updated_at"`
	ZoneCount     int            `json:"zone_count"`
	ZoneHeld      int            `json:"zone_held"`
	InZone        []PriceZoneRow `json:"in_zone"`
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

// GetTodayPicks: 오늘 살 종목 Top 3
func (s *TodayService) GetTodayPicks() (*TodayPicks, error) {
	now := s.now()
	today := todayKST(now)
	report, err := s.signals.buildSignalReport()
	if err != nil {
		return nil, err
	}
	out := &TodayPicks{Date: today, Picks: []TodayPick{}, Plans: []TodayPlan{}, InZone: []PriceZoneRow{}}

	// 사기 좋은 가격 (백그라운드에서 계산해 둔 가장 최근 기록)
	zones := map[uint]PriceZoneRow{}
	if s.zones != nil {
		if list, err := s.zones.GetLatest(); err == nil {
			out.ZoneDate, out.ZoneUpdatedAt, out.ZoneCount, out.ZoneHeld = list.Date, list.UpdatedAt, len(list.Rows), list.Held
			for _, r := range list.Rows {
				zones[r.AssetID] = r
				if r.InZone() {
					out.InZone = append(out.InZone, r)
				}
			}
		}
	}

	// 배당 점수 (이번 달)
	divRows := map[uint]DivScoreRow{}
	if s.divScore != nil {
		if r, err := s.divScore.GetRanking(""); err == nil {
			for _, row := range r.Rows {
				divRows[row.AssetID] = row
			}
		}
	}
	// 오늘 모으기로 사는 종목 (계좌·종목)
	planned := map[uint]bool{}
	if s.accum != nil {
		if plans, err := s.accum.ListPlans(); err == nil {
			for _, p := range plans {
				if p.Status == models.PlanStatusActive && p.NextDate == today {
					planned[p.AssetID] = true
					out.Plans = append(out.Plans, TodayPlan{AssetID: p.AssetID, Name: p.Asset.Name, Account: accountLabelOf(p.Account), Amount: p.Amount, Currency: p.AmountCurrency})
				}
			}
		}
	}
	// 계좌·예수금
	accounts := map[uint]models.Account{}
	var accs []models.Account
	if err := s.db.Find(&accs).Error; err == nil {
		for _, a := range accs {
			accounts[a.ID] = a
		}
	}
	balances := map[uint]CashBalance{}
	fx := report.USDKRW
	if s.cash != nil {
		if bs, f, err := s.cash.GetBalances(); err == nil {
			for _, b := range bs {
				balances[b.AccountID] = b
			}
			if f > 0 {
				fx = f
			}
		}
	}

	picks, considered := rankToday(report.Items, divRows, zones, planned, accounts, balances, fx, today)
	out.Considered = considered
	for i := range picks {
		picks[i].Series = s.series(picks[i].Ticker)
	}
	out.Picks = picks
	return out, nil
}


// rankToday: 신호 항목·배당 점수·가격 매력·오늘 모으기·계좌·예수금으로 오늘 점수를 매겨 상위 3개 (미니 차트는 붙이지 않는다). considered: 점수를 넘긴 종목 수
func rankToday(items []SignalItem, divRows map[uint]DivScoreRow, zones map[uint]PriceZoneRow, planned map[uint]bool, accounts map[uint]models.Account, balances map[uint]CashBalance, fx float64, today string) ([]TodayPick, int) {
	var picks []TodayPick
	for _, it := range items {
		if it.Action == SignalSell || it.Action == SignalConflict || it.Action == SignalNoPrice || it.CurrentPrice <= 0 {
			continue
		}
		if it.BuyExcludedReason != "" || it.LastBuyDate == today || planned[it.AssetID] {
			continue
		}
		p := TodayPick{AssetID: it.AssetID, Ticker: it.Ticker, Name: it.Name, Market: marketOf(it.Ticker), Currency: it.Currency,
			Action: it.Action, Price: it.CurrentPrice, FromHighPct: it.FromHighPct, WeightPct: it.WeightPct,
			SuggestQty: it.SuggestedBuyQty, SuggestKRW: it.SuggestedBuyKRW}

		// 매수 신호
		var metLabels []string
		for _, c := range it.BuyChecks {
			p.TotalBuy++
			if c.Met {
				p.MetBuy++
				metLabels = append(metLabels, c.Label)
			}
		}
		sigFrac := 0.0
		if it.Action == SignalBuy {
			sigFrac = 1
		} else if p.TotalBuy > 0 {
			sigFrac = float64(p.MetBuy) / float64(p.TotalBuy)
		}
		// 만점: 배당 점수·가격 매력이 없으면 그 몫을 신호에
		row, hasDiv := divRows[it.AssetID]
		zone, hasZone := zones[it.AssetID]
		p.Parts.SignalMax, p.Parts.WeightMax, p.Parts.CashMax = todaySignalMax, todayWeightMax, todayCashMax
		if hasDiv {
			p.Parts.DividendMax = todayDivMax
		} else {
			p.Parts.SignalMax += todayDivMax
		}
		if hasZone {
			p.Parts.PriceMax = todayPriceMax
			z := zone
			p.Zone = &z
			p.Parts.Price = todayPriceMax * clamp01(zone.Score/100)
		} else {
			p.Parts.SignalMax += todayPriceMax
		}
		p.Parts.Signal = p.Parts.SignalMax * sigFrac
		if hasDiv {
			p.Parts.Dividend = todayDivMax * clamp01(0.6*row.Score/100+0.4*row.Parts.Yield)
			p.DivRank = row.Rank
		}
		// 비중 여유
		maxW := it.BuyMaxWeightPct
		if maxW <= 0 {
			maxW = todayDefaultMaxW
		}
		p.Parts.Weight = todayWeightMax * clamp01(1-it.WeightPct/maxW)
		// 살 돈: 이 종목을 가진 계좌 가운데 예수금이 가장 넉넉한 곳
		p.Account = pickAccount(it, accounts, balances, fx)
		if p.Account != nil {
			if p.Account.NoCash || p.Account.Need <= 0 {
				p.Parts.Cash = todayCashMax
			} else {
				p.Parts.Cash = todayCashMax * clamp01(p.Account.Cash/p.Account.Need)
			}
		}
		for _, v := range []*float64{&p.Parts.Price, &p.Parts.Signal, &p.Parts.Dividend, &p.Parts.Weight, &p.Parts.Cash} {
			*v = math.Round(*v*10) / 10
		}
		p.Score = math.Round((p.Parts.Price+p.Parts.Signal+p.Parts.Dividend+p.Parts.Weight+p.Parts.Cash)*10) / 10
		if p.Score < todayMinScore {
			continue
		}
		p.Reasons = todayReasons(it, p, metLabels, row, hasDiv, maxW)
		p.Warn = zoneWarn(p.Zone)
		picks = append(picks, p)
	}
	considered := len(picks)
	sort.SliceStable(picks, func(i, j int) bool {
		if picks[i].Score != picks[j].Score {
			return picks[i].Score > picks[j].Score
		}
		if picks[i].Parts.Price != picks[j].Parts.Price {
			return picks[i].Parts.Price > picks[j].Parts.Price
		}
		return picks[i].Parts.Signal > picks[j].Parts.Signal
	})
	if len(picks) > todayPickCount {
		picks = picks[:todayPickCount]
	}
	for i := range picks {
		picks[i].Rank = i + 1
	}
	return picks, considered
}

// pickAccount: 이 종목을 가진 계좌 가운데 그 종목을 살 예수금이 가장 넉넉한 곳 (예수금 기록 안 하는 계좌는 늘 충분)
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
	bestFrac := -1.0
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
			}
		}
		frac := 1.0
		if !acc.NoCash && t.Need > 0 {
			frac = t.Cash / t.Need
		}
		if acc.NoCash || t.Cash >= t.Need {
			t.Short = 0
		} else {
			t.Short = t.Need - math.Max(t.Cash, 0)
		}
		if frac > bestFrac {
			best, bestFrac = t, frac
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
	if z := p.Zone; z != nil && (z.InZone() || z.Pos1y <= 30) {
		zoneLine = true
		switch z.Level {
		case models.ZoneLevelGreat:
			out = append(out, fmt.Sprintf("1년 중 하위 %.0f%% 가격 · 아주 좋은 가격 %s 이하", z.Pos1y, holdingMoney(z.Great, z.Currency)))
		case models.ZoneLevelGood:
			out = append(out, fmt.Sprintf("1년 중 하위 %.0f%% 가격 · 좋은 가격 %s 이하", z.Pos1y, holdingMoney(z.Good, z.Currency)))
		default:
			out = append(out, fmt.Sprintf("1년 중 하위 %.0f%% 가격 · 좋은 가격은 %s 이하", z.Pos1y, holdingMoney(z.Good, z.Currency)))
		}
		if z.Verdict == models.ZoneVerdictWorks {
			out = append(out, fmt.Sprintf("이만큼 쌌을 때 1년 뒤 평균 %+.1f%% (평소 %+.1f%%)", z.CheapAvg, z.AllAvg))
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

// zoneWarn: 가격이 싸 보여도 조심할 점
func zoneWarn(z *PriceZoneRow) string {
	if z == nil || !(z.InZone() || z.Pos1y <= 30) {
		return ""
	}
	switch {
	case z.Verdict == models.ZoneVerdictTrap:
		return fmt.Sprintf("싸게 사도 과거엔 1년 뒤 평균 %+.1f%% (평소 %+.1f%%)", z.CheapAvg, z.AllAvg)
	case z.Falling:
		return fmt.Sprintf("아직 내려가는 중 · 20일선 %s 아래", holdingMoney(z.MA20, z.Currency))
	}
	return ""
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
