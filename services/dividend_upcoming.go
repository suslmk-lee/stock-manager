package services

import (
	"math"
	"sort"
	"strings"
	"time"

	"stock-manager/models"
)

// 예정 배당 — 대시보드용 (HTTP 전용, GET /api/dividends/upcoming). 세 출처를 하나의 목록으로 합친다.
//
//   - pending  배당락은 지났고 내 배당 기록은 없으며 입금 기한(pay_by) 전 — 기록 누락(missingRecords)의 upcoming.
//     배당락 전날 들고 있었으면 그 뒤 팔았어도 들어오므로, 입금 기한 안에 판 종목도 본다.
//   - manual   미리 넣어 둔 예정 기록 (is_received=false, 날짜가 오늘 ~ 오늘+days)
//   - forecast 앞으로 올 배당락 추정 — 최근 주기로 본 [오늘, 오늘+days] 안의 회차마다
//     최근 정기 회차 주당 배당 × 계좌별 지금 보유 수량 × (1 − 세율). 시장 배당 이력이 없는 종목은 내 배당 기록(입금일)으로 추정한다.
//
// 같은 (계좌, 종목)의 manual 이 pending·forecast 회차의 날짜 창(배당락 −divRecordLeadDays ~ +입금 기한) 안에 있으면 manual 만 남긴다
// (최근 회차부터, 회차마다 창 안의 가장 늦은 manual 하나 — 기록 누락과 같은 짝짓기).

const (
	UpcomingDaysDefault = 45
	UpcomingDaysMax     = 120

	UpcomingPending  = "pending"
	UpcomingManual   = "manual"
	UpcomingForecast = "forecast"
)

// UpcomingDividend 는 들어올 배당 한 건 (금액은 Currency 기준)
type UpcomingDividend struct {
	Kind           string   `json:"kind"`
	AssetID        uint     `json:"asset_id"`
	Ticker         string   `json:"ticker"`
	AssetName      string   `json:"asset_name"`
	AccountID      uint     `json:"account_id"`
	AccountName    string   `json:"account_name"`
	AccountBroker  string   `json:"account_broker"`
	ExDate         string   `json:"ex_date,omitempty"` // pending·forecast: 배당락일 (forecast 는 추정)
	PayBy          string   `json:"pay_by,omitempty"`  // pending: 이 날까지는 들어와야 함
	Date           string   `json:"date,omitempty"`    // manual: 기록한 날짜
	PerShare       float64  `json:"per_share"`
	Quantity       float64  `json:"quantity"`
	Currency       string   `json:"currency"`
	ExpectedNet    float64  `json:"expected_net"`     // 세후 (manual 은 금액 − 세금)
	ExpectedNetKRW *float64 `json:"expected_net_krw"` // 그 통화 환율을 모르면 null
	Estimated      bool     `json:"estimated"`        // forecast
	DividendID     *uint    `json:"dividend_id"`      // manual
}

// sortDate: pending 은 입금 기한, manual 은 기록 날짜, forecast 는 배당락 추정일
func (u UpcomingDividend) sortDate() string {
	switch u.Kind {
	case UpcomingPending:
		return u.PayBy
	case UpcomingManual:
		return u.Date
	}
	return u.ExDate
}

var upcomingKindOrder = map[string]int{UpcomingPending: 0, UpcomingManual: 1, UpcomingForecast: 2}

type UpcomingDividends struct {
	AsOf             string             `json:"as_of"`
	Days             int                `json:"days"`
	Items            []UpcomingDividend `json:"items"`
	TotalExpectedKRW float64            `json:"total_expected_krw"`
	Warnings         []string           `json:"warnings"`
}

// ClampUpcomingDays: 기본 45, 최대 120
func ClampUpcomingDays(days int) int {
	if days <= 0 {
		return UpcomingDaysDefault
	}
	return min(days, UpcomingDaysMax)
}

// GetUpcoming: 오늘(KST)부터 days 일 안에 들어올 배당. fxNow 는 통화 1단위의 원화 값(원화 1, 모르면 0) — nil 이면 지금 시세 환율.
func (s *DividendScoreService) GetUpcoming(days int, fxNow func(ccy string) float64) (*UpcomingDividends, error) {
	days = ClampUpcomingDays(days)
	now := s.clock()
	today := todayKST(now)
	day0, _ := parseKSTDate(today)
	until := day0.AddDate(0, 0, days).Format(dateLayout)

	assets, err := s.loadAssets(now.AddDate(0, 0, -(divRecordWindowKR+1)), false)
	if err != nil {
		return nil, err
	}
	accByID, err := s.accountsByID()
	if err != nil {
		return nil, err
	}
	var recs []models.Dividend
	if err := s.db.Where("is_received = ?", false).Order("date ASC").Find(&recs).Error; err != nil {
		return nil, err
	}
	out := &UpcomingDividends{AsOf: today, Days: days, Items: []UpcomingDividend{}, Warnings: []string{}}

	// 시장 배당 이력을 받지 못한 종목 (외부 조회 실패) — 기록 누락은 못 보고, 추정은 내 기록으로만
	var failed []string
	for _, a := range assets {
		if tk := strings.ToUpper(strings.TrimSpace(a.asset.Ticker)); len(a.market) == 0 && !s.eventsKnown(tk) {
			failed = append(failed, tk)
		}
	}
	if len(failed) > 0 {
		sort.Strings(failed)
		out.Warnings = append(out.Warnings, "시장 배당 이력을 받지 못한 종목 (입금 전 회차·배당락 추정이 빠질 수 있음): "+strings.Join(failed, ", "))
	}

	type key struct{ acc, asset uint }
	type round struct {
		idx int // out.Items 안의 위치
		ex  time.Time
	}
	rounds := map[key][]round{}
	add := func(u UpcomingDividend, ex time.Time) {
		out.Items = append(out.Items, u)
		k := key{u.AccountID, u.AssetID}
		rounds[k] = append(rounds[k], round{len(out.Items) - 1, ex})
	}
	acctName := func(id uint) (string, string) { a := accByID[id]; return a.Name, a.Broker }

	for _, a := range assets {
		for _, m := range missingRecords(a, accByID, now) {
			if m.Status != "upcoming" {
				continue
			}
			ex, err := parseKSTDate(m.ExDate)
			if err != nil {
				continue
			}
			add(UpcomingDividend{
				Kind: UpcomingPending, AssetID: m.AssetID, Ticker: m.Ticker, AssetName: m.AssetName,
				AccountID: m.AccountID, AccountName: m.AccountName, AccountBroker: m.AccountBroker,
				ExDate: m.ExDate, PayBy: m.PayBy, PerShare: m.PerShare, Quantity: m.Quantity, Currency: m.Currency,
				ExpectedNet: m.ExpectedNet,
			}, ex)
		}
	}
	pendingEx := map[key]map[string]bool{}
	for k, rs := range rounds {
		pendingEx[k] = map[string]bool{}
		for _, r := range rs {
			pendingEx[k][out.Items[r.idx].ExDate] = true
		}
	}
	for _, a := range assets {
		_, tax, ccy := divRecordRule(a.asset.Ticker)
		for _, f := range forecastRounds(a.events, now, until) {
			exDay := f.Date.In(kst).Format(dateLayout)
			if exDay < today {
				continue
			}
			for _, acc := range a.acctIDs {
				qty := a.qtyAt(acc, now)
				if qty <= 1e-9 || pendingEx[key{acc, a.asset.ID}][exDay] {
					continue
				}
				name, broker := acctName(acc)
				add(UpcomingDividend{
					Kind: UpcomingForecast, AssetID: a.asset.ID, Ticker: a.asset.Ticker, AssetName: a.asset.Name,
					AccountID: acc, AccountName: name, AccountBroker: broker,
					ExDate: exDay, PerShare: f.Amount, Quantity: qty, Currency: ccy,
					ExpectedNet: math.Round(f.Amount*qty*(1-tax)*100) / 100, Estimated: true,
				}, f.Date)
			}
		}
	}

	// manual — 종목 정보는 보유·최근 거래가 없을 수도 있어 따로 읽는다
	var manual []models.Dividend
	for _, r := range recs {
		if d := r.Date.In(kst).Format(dateLayout); d >= today && d <= until {
			manual = append(manual, r)
		}
	}
	assetInfo := map[uint]models.Asset{}
	for id, a := range assets {
		assetInfo[id] = a.asset
	}
	var need []uint
	for _, r := range manual {
		if _, ok := assetInfo[r.AssetID]; !ok {
			need = append(need, r.AssetID)
		}
	}
	if len(need) > 0 {
		var more []models.Asset
		if err := s.db.Unscoped().Where("id IN ?", need).Find(&more).Error; err != nil {
			return nil, err
		}
		for _, a := range more {
			assetInfo[a.ID] = a
		}
	}
	drop := map[int]bool{}
	manualByKey := map[key][]models.Dividend{}
	for _, r := range manual {
		k := key{r.AccountID, r.AssetID}
		manualByKey[k] = append(manualByKey[k], r)
	}
	for k, ms := range manualByKey {
		rs := rounds[k]
		if len(rs) == 0 {
			continue
		}
		window, _, _ := divRecordRule(assetInfo[k.asset].Ticker)
		sort.Slice(rs, func(i, j int) bool { return rs[i].ex.After(rs[j].ex) })
		used := make([]bool, len(ms))
		for _, r := range rs { // 최근 회차부터, 창 안의 가장 늦은 manual 과 짝
			lo, hi := r.ex.AddDate(0, 0, -divRecordLeadDays), r.ex.AddDate(0, 0, window)
			for i := len(ms) - 1; i >= 0; i-- {
				if d := ms[i].Date; !used[i] && !d.Before(lo) && !d.After(hi) {
					used[i], drop[r.idx] = true, true
					break
				}
			}
		}
	}
	for _, r := range manual {
		a := assetInfo[r.AssetID]
		name, broker := acctName(r.AccountID)
		u := UpcomingDividend{
			Kind: UpcomingManual, AssetID: r.AssetID, Ticker: a.Ticker, AssetName: a.Name,
			AccountID: r.AccountID, AccountName: name, AccountBroker: broker,
			Date: r.Date.In(kst).Format(dateLayout), Currency: r.Currency,
			ExpectedNet: math.Round((r.Amount-r.Tax)*100) / 100,
		}
		if u.Currency == "" {
			u.Currency = "USD" // 열 기본값과 같다
		}
		if d := assets[r.AssetID]; d != nil {
			if q := d.qtyAt(r.AccountID, now); q > 1e-9 {
				u.Quantity, u.PerShare = q, r.Amount/q
			}
		}
		id := r.ID
		u.DividendID = &id
		out.Items = append(out.Items, u)
	}
	if len(drop) > 0 {
		kept := out.Items[:0]
		for i, u := range out.Items {
			if !drop[i] {
				kept = append(kept, u)
			}
		}
		out.Items = kept
	}

	// 원화 환산
	if fxNow == nil {
		fxNow = s.fxNowDefault
	}
	rates := map[string]float64{}
	var unknown []string
	for i := range out.Items {
		u := &out.Items[i]
		c := strings.TrimSpace(u.Currency)
		rate, ok := rates[c]
		if !ok {
			rate = 1
			if !isKRW(c) {
				rate = fxNow(c)
			}
			if !finite(rate) || rate <= 0 {
				rate = 0
				unknown = append(unknown, c)
			}
			rates[c] = rate
		}
		if rate > 0 {
			v := math.Round(u.ExpectedNet * rate)
			u.ExpectedNetKRW = &v
			out.TotalExpectedKRW += v
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		out.Warnings = append(out.Warnings, "환율을 몰라 원화 합계에서 뺀 통화: "+strings.Join(unknown, ", "))
	}

	sort.SliceStable(out.Items, func(i, j int) bool {
		a, b := out.Items[i], out.Items[j]
		if da, db := a.sortDate(), b.sortDate(); da != db {
			return da < db
		}
		if a.Kind != b.Kind {
			return upcomingKindOrder[a.Kind] < upcomingKindOrder[b.Kind]
		}
		if a.Ticker != b.Ticker {
			return a.Ticker < b.Ticker
		}
		return a.AccountID < b.AccountID
	})
	return out, nil
}

// forecastRounds: 주당 배당 이력(날짜 오름차순)으로 본, now 뒤 untilDay(KST, 포함)까지의 회차 추정 — 주당 배당은 최근 정기 회차.
// 다음 회차 계산은 배당 점수의 '다음 배당 예상'(NextExpected)과 같다. 최근 12개월 회차가 없거나 불규칙하거나 지금 회차가 늦었으면 없다.
func forecastRounds(events []DivPerShare, now time.Time, untilDay string) []DivPerShare {
	var evs []DivPerShare
	for _, e := range events {
		if !e.Date.After(now) && e.Amount > 0 && finite(e.Amount) {
			evs = append(evs, e)
		}
	}
	if len(evs) == 0 {
		return nil
	}
	special := markSpecials(evs)
	var reg []DivPerShare
	for i, e := range evs {
		if !special[i] {
			reg = append(reg, e)
		}
	}
	if len(reg) == 0 {
		return nil
	}
	n, yearAgo := 0, now.AddDate(-1, 0, 0)
	for _, e := range reg {
		if e.Date.After(yearAgo) {
			n++
		}
	}
	if n == 0 || divCycleOf(n) == "불규칙" {
		return nil
	}
	last := reg[len(reg)-1]
	next, step, missed := divNextRound(last.Date, n, now)
	if missed {
		return nil
	}
	var out []DivPerShare
	for d := next; d.In(kst).Format(dateLayout) <= untilDay; d = d.AddDate(0, 0, step) {
		out = append(out, DivPerShare{Date: d, Amount: last.Amount})
	}
	return out
}

// eventsKnown: 그 종목의 시장 배당 이력을 받아 두었는지 (배당이 없는 종목도 받았으면 true). 시험용 주입이나 시세 서비스가 없으면 true.
func (s *DividendScoreService) eventsKnown(ticker string) bool {
	if s.fetchEvents != nil || s.ticker == nil {
		return true
	}
	return s.ticker.dividendEventsKnown(ticker)
}

func (s *DividendScoreService) fxNowDefault(ccy string) float64 {
	if s.ticker == nil {
		return 0
	}
	return s.ticker.FxRateNow(ccy)
}
