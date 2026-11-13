package services

import (
	"context"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

// 부담금 배분 — 퇴직연금(DC 등): 매달 정해진 날 부담금이 계좌에 들어오고, 정해 둔 비율대로 상품(ETF·펀드)을 산다.
// 매 회차(그달 납입일)마다:
//  1. 예수금에 부담금 입금을 기록한다.
//  2. 상품마다 부담금 × 비율만큼 매수를 기록한다.
//     ETF·주식: 납입일(휴장이면 다음 거래일) 종가로 1주 단위 — 남는 돈은 예수금에 남는다.
//     펀드: 그날까지의 마지막 기준가로 좌수 (소수점). 기준가는 평가금액 맞추기로 바로잡힌다.
// 서버와 앱이 함께 돌아도 같은 회차는 한 번만 기록된다 (입금·매수의 고유 인덱스).

const (
	contribDepositNote = "부담금 입금"
	contribBuyNote     = "부담금 배분"
	contribQtyStep     = 0.0001 // 펀드 좌수 단위
)

type ContributionService struct {
	db     *gorm.DB
	ticker *TickerService
	txs    *TransactionService
	funds  *FundService

	now        func() time.Time
	getHistory func(ticker, rangeStr string) (*PriceHistory, error)
	getPrices  func(tickers []string) map[string]*CurrentPrice
	runMu      sync.Mutex
}

func NewContributionService(db *gorm.DB, ticker *TickerService, funds *FundService) *ContributionService {
	s := &ContributionService{db: db, ticker: ticker, txs: NewTransactionServiceWithDB(db), funds: funds, now: time.Now}
	if ticker != nil {
		s.getHistory = func(t, r string) (*PriceHistory, error) { return ticker.GetPriceHistory(t, r, "1d") }
		s.getPrices = ticker.GetCurrentPrices
	}
	return s
}

func (s *ContributionService) today() string { return todayKST(s.now()) }

type ContributionItemRequest struct {
	AssetID uint    `json:"asset_id"`
	Weight  float64 `json:"weight"` // %
	// 시작 잔고 (선택, 새로 만들 때만): ETF·주식은 보유 수량·평균 단가, 펀드는 원금·평가금액
	OpeningQty   float64 `json:"opening_qty"`
	OpeningAvg   float64 `json:"opening_avg"`
	OpeningCost  float64 `json:"opening_cost"`
	OpeningValue float64 `json:"opening_value"`
}

type ContributionPlanRequest struct {
	AccountID uint                      `json:"account_id"`
	Amount    float64                   `json:"amount"`
	MonthDay  int                       `json:"month_day"`
	Status    string                    `json:"status"`     // active | paused (수정 때)
	StartedOn string                    `json:"started_on"` // 시작 잔고 날짜 (기본 오늘)
	AutoFrom  string                    `json:"auto_from"`  // 이 날부터의 회차를 자동 기록 (기본 내일 — 다음 회차부터)
	Notes     string                    `json:"notes"`
	Items     []ContributionItemRequest `json:"items"`
}

func (s *ContributionService) validate(req *ContributionPlanRequest) (map[uint]models.Asset, error) {
	var acc models.Account
	if err := s.db.First(&acc, req.AccountID).Error; err != nil {
		return nil, planInputErr("계좌를 골라 주세요")
	}
	if !(req.Amount > 0) || !finite(req.Amount) {
		return nil, planInputErr("부담금을 0보다 크게 넣어 주세요")
	}
	if req.MonthDay < 1 || req.MonthDay > 31 {
		return nil, planInputErr("납입일은 1~31일 중에서 골라 주세요")
	}
	if len(req.Items) == 0 {
		return nil, planInputErr("상품을 하나 이상 넣어 주세요")
	}
	assets := map[uint]models.Asset{}
	sum := 0.0
	for _, it := range req.Items {
		if _, dup := assets[it.AssetID]; dup {
			return nil, planInputErr("같은 상품이 두 번 들어 있습니다")
		}
		var a models.Asset
		if err := s.db.First(&a, it.AssetID).Error; err != nil {
			return nil, planInputErr("상품을 찾을 수 없습니다 (id %d)", it.AssetID)
		}
		if !(it.Weight > 0) || it.Weight > 100 {
			return nil, planInputErr("%s 비율은 0보다 크고 100 이하여야 합니다", a.Name)
		}
		if !IsFundTicker(a.Ticker) && !isKRW(tickerCurrency(a.Ticker)) {
			return nil, planInputErr("%s: 원화 상품(국내 ETF·펀드)만 넣을 수 있습니다", a.Name)
		}
		assets[it.AssetID] = a
		sum += it.Weight
	}
	if math.Abs(sum-100) > 0.01 {
		return nil, planInputErr("비율 합이 100%%가 되어야 합니다 (지금 %.2f%%)", sum)
	}
	for _, d := range []*string{&req.StartedOn, &req.AutoFrom} {
		*d = strings.TrimSpace(*d)
		if *d != "" {
			if _, ok := parseDay(*d); !ok {
				return nil, planInputErr("날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)")
			}
		}
	}
	if req.Status != "" && req.Status != models.PlanStatusActive && req.Status != models.PlanStatusPaused {
		return nil, planInputErr("상태가 올바르지 않습니다")
	}
	return assets, nil
}

// CreatePlan: 부담금 배분을 만든다. 시작 잔고가 있으면 상품별로 매수 기록(펀드는 원금으로 좌수, 평가금액으로 기준가)을 함께 남긴다.
func (s *ContributionService) CreatePlan(req ContributionPlanRequest) (*models.ContributionPlan, error) {
	assets, err := s.validate(&req)
	if err != nil {
		return nil, err
	}
	today := s.today()
	if req.StartedOn == "" {
		req.StartedOn = today
	}
	if req.AutoFrom == "" {
		t, _ := parseDay(today)
		req.AutoFrom = dayString(t.AddDate(0, 0, 1))
	}
	plan := models.ContributionPlan{
		AccountID: req.AccountID, Amount: req.Amount, MonthDay: req.MonthDay, Status: models.PlanStatusActive,
		StartedOn: req.StartedOn, AutoFrom: req.AutoFrom, Notes: strings.TrimSpace(req.Notes),
	}
	for _, it := range req.Items {
		plan.Items = append(plan.Items, models.ContributionItem{AssetID: it.AssetID, Weight: it.Weight})
	}
	if err := s.db.Create(&plan).Error; err != nil {
		return nil, err
	}
	// 시작 잔고 — 매수로 남기고, 그 돈만큼 그동안 들어온 부담금 입금도 함께 (안 그러면 예수금이 그만큼 마이너스가 된다)
	day, _ := parseDay(req.StartedOn)
	openingPaid := 0.0
	for _, it := range req.Items {
		if IsFundTicker(assets[it.AssetID].Ticker) {
			if it.OpeningCost > 0 {
				openingPaid += it.OpeningCost
			}
		} else if it.OpeningQty > 0 && it.OpeningAvg > 0 {
			openingPaid += it.OpeningQty * it.OpeningAvg
		}
	}
	if openingPaid > 0 {
		dep := models.CashEntry{AccountID: req.AccountID, Currency: "KRW", Date: day, Kind: models.CashDeposit, Amount: openingPaid, Notes: "부담금 배분 시작 잔고 (그동안 들어온 부담금)"}
		if err := s.db.Create(&dep).Error; err != nil {
			return nil, err
		}
	}
	for _, it := range req.Items {
		a := assets[it.AssetID]
		if IsFundTicker(a.Ticker) {
			if it.OpeningCost > 0 {
				units := math.Floor(it.OpeningCost/fundStartNav/contribQtyStep) * contribQtyStep
				if units > 0 {
					if _, err := s.txs.CreateTransaction(CreateTransactionRequest{AccountID: req.AccountID, AssetID: a.ID, Type: models.TransactionTypeBuy,
						Date: day, Price: it.OpeningCost / units, Quantity: units, Notes: "부담금 배분 시작 잔고 (원금)"}); err != nil {
						return nil, err
					}
					if it.OpeningValue > 0 {
						if err := s.funds.SetNav(a.ID, req.StartedOn, it.OpeningValue/units, "opening"); err != nil {
							return nil, err
						}
					}
				}
			}
		} else if it.OpeningQty > 0 && it.OpeningAvg > 0 {
			if _, err := s.txs.CreateTransaction(CreateTransactionRequest{AccountID: req.AccountID, AssetID: a.ID, Type: models.TransactionTypeBuy,
				Date: day, Price: it.OpeningAvg, Quantity: it.OpeningQty, Notes: "부담금 배분 시작 잔고"}); err != nil {
				return nil, err
			}
		}
	}
	return s.getPlan(plan.ID)
}

func (s *ContributionService) getPlan(id uint) (*models.ContributionPlan, error) {
	var p models.ContributionPlan
	if err := s.db.Preload("Items.Asset").Preload("Account").First(&p, id).Error; err != nil {
		return nil, planInputErr("부담금 배분을 찾을 수 없습니다")
	}
	return &p, nil
}

// UpdatePlan: 부담금·납입일·비율·상태를 바꾼다 (지난 회차 기록은 그대로, 다음 회차부터 적용)
func (s *ContributionService) UpdatePlan(id uint, req ContributionPlanRequest) (*models.ContributionPlan, error) {
	cur, err := s.getPlan(id)
	if err != nil {
		return nil, err
	}
	req.AccountID = cur.AccountID // 계좌는 바꾸지 않는다
	if _, err := s.validate(&req); err != nil {
		return nil, err
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		upd := map[string]interface{}{"amount": req.Amount, "month_day": req.MonthDay, "notes": strings.TrimSpace(req.Notes)}
		if req.Status != "" {
			upd["status"] = req.Status
		}
		if req.AutoFrom != "" {
			upd["auto_from"] = req.AutoFrom
		}
		if err := tx.Model(&models.ContributionPlan{}).Where("id = ?", id).Updates(upd).Error; err != nil {
			return err
		}
		if err := tx.Where("plan_id = ?", id).Delete(&models.ContributionItem{}).Error; err != nil {
			return err
		}
		for _, it := range req.Items {
			if err := tx.Create(&models.ContributionItem{PlanID: id, AssetID: it.AssetID, Weight: it.Weight}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.getPlan(id)
}

// DeletePlan: 부담금 배분을 지운다. 이미 기록된 입금·매수는 실제 내역이라 그대로 둔다.
func (s *ContributionService) DeletePlan(id uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("plan_id = ?", id).Delete(&models.ContributionItem{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.ContributionPlan{}, id).Error
	})
}

// ── 조회 ──

type ContributionItemView struct {
	models.ContributionItem
	IsFund    bool    `json:"is_fund"`
	Quantity  float64 `json:"quantity"`   // 이 계좌 보유 수량(펀드는 앱 좌수)
	Cost      float64 `json:"cost"`       // 원금 (수량 × 평균 단가)
	Price     float64 `json:"price"`      // 현재가 · 펀드는 마지막 기준가
	PriceDate string  `json:"price_date"` // 펀드: 마지막으로 평가금액을 맞춘 날
	Value     float64 `json:"value"`
}

// ContributionPlanView: 목록용 (계획을 내장하지 않고 필드를 풀어 둔다 — 내장하면 Wails 타입 생성에서 items 가 겹친다)
type ContributionPlanView struct {
	ID               uint                   `json:"id"`
	AccountID        uint                   `json:"account_id"`
	Amount           float64                `json:"amount"`
	MonthDay         int                    `json:"month_day"`
	Status           string                 `json:"status"`
	StartedOn        string                 `json:"started_on"`
	AutoFrom         string                 `json:"auto_from"`
	ProcessedThrough string                 `json:"processed_through"`
	Notes            string                 `json:"notes"`
	Account          models.Account         `json:"account"`
	Items            []ContributionItemView `json:"items"`
	NextDate         string                 `json:"next_date"` // 다음 납입일
	Rounds           int                    `json:"rounds"`    // 자동 기록한 회차 수
	Paid             float64                `json:"paid"`      // 자동 기록한 부담금 합계
}

// payDay: 그달 납입일 (말일보다 크면 말일)
func payDay(year int, month time.Month, monthDay int) string {
	first := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
	d := monthDay
	if n := daysInMonth(first); d > n {
		d = n
	}
	return dayString(time.Date(year, month, d, 0, 0, 0, 0, time.UTC))
}

// dueDates: from(포함)~to(포함) 사이의 납입일
func dueDates(monthDay int, from, to string) []string {
	f, ok1 := parseDay(from)
	t, ok2 := parseDay(to)
	if !ok1 || !ok2 || f.After(t) {
		return nil
	}
	var out []string
	for m := time.Date(f.Year(), f.Month(), 1, 0, 0, 0, 0, time.UTC); !m.After(t); m = m.AddDate(0, 1, 0) {
		d := payDay(m.Year(), m.Month(), monthDay)
		if d >= from && d <= to {
			out = append(out, d)
		}
	}
	return out
}

// pendingFrom: 아직 처리하지 않은 첫날
func pendingFrom(p *models.ContributionPlan) string {
	from := p.AutoFrom
	if p.ProcessedThrough != "" {
		if t, ok := parseDay(p.ProcessedThrough); ok {
			if next := dayString(t.AddDate(0, 0, 1)); next > from {
				from = next
			}
		}
	}
	return from
}

func (s *ContributionService) nextDate(p *models.ContributionPlan) string {
	from := pendingFrom(p)
	if t := s.today(); t > from {
		from = t
	}
	f, _ := parseDay(from)
	ds := dueDates(p.MonthDay, from, dayString(f.AddDate(0, 2, 0)))
	if len(ds) > 0 {
		return ds[0]
	}
	return ""
}

func (s *ContributionService) ListPlans() ([]ContributionPlanView, error) {
	var plans []models.ContributionPlan
	if err := s.db.Preload("Items.Asset").Preload("Account").Order("id").Find(&plans).Error; err != nil {
		return nil, err
	}
	out := make([]ContributionPlanView, 0, len(plans))
	var listed []string
	for _, p := range plans {
		for _, it := range p.Items {
			if !IsFundTicker(it.Asset.Ticker) {
				listed = append(listed, it.Asset.Ticker)
			}
		}
	}
	prices := map[string]*CurrentPrice{}
	if len(listed) > 0 && s.getPrices != nil {
		prices = s.getPrices(listed)
	}
	for _, p := range plans {
		v := ContributionPlanView{ID: p.ID, AccountID: p.AccountID, Amount: p.Amount, MonthDay: p.MonthDay, Status: p.Status, StartedOn: p.StartedOn,
			AutoFrom: p.AutoFrom, ProcessedThrough: p.ProcessedThrough, Notes: p.Notes, Account: p.Account, Items: []ContributionItemView{}}
		if p.Status == models.PlanStatusActive {
			v.NextDate = s.nextDate(&p)
		}
		var deps []models.CashEntry
		s.db.Where("contrib_plan_id = ?", p.ID).Find(&deps)
		v.Rounds = len(deps)
		for _, d := range deps {
			v.Paid += d.Amount
		}
		for _, it := range p.Items {
			iv := ContributionItemView{ContributionItem: it, IsFund: IsFundTicker(it.Asset.Ticker)}
			var h models.Holding
			if err := s.db.Where("account_id = ? AND asset_id = ?", p.AccountID, it.AssetID).First(&h).Error; err == nil {
				iv.Quantity, iv.Cost = h.Quantity, h.Quantity*h.AveragePrice
			}
			if iv.IsFund {
				var fp models.FundPrice
				if err := s.db.Where("asset_id = ?", it.AssetID).Order("date DESC").Limit(1).Find(&fp).Error; err == nil && fp.ID != 0 {
					iv.PriceDate = fp.Date
				}
				iv.Price = s.funds.BuyNav(it.AssetID, s.today())
			} else if cp := prices[strings.ToUpper(it.Asset.Ticker)]; cp != nil {
				iv.Price = cp.Price
			}
			iv.Value = iv.Quantity * iv.Price
			v.Items = append(v.Items, iv)
		}
		out = append(out, v)
	}
	return out, nil
}

// ContributionRound: 한 회차 (그날 입금과 상품별 매수)
type ContributionRound struct {
	Date    string               `json:"date"`
	Deposit float64              `json:"deposit"`
	Buys    []models.Transaction `json:"buys"`
}

// GetRounds: 자동 기록한 회차 (최근 것부터)
func (s *ContributionService) GetRounds(planID uint) ([]ContributionRound, error) {
	var deps []models.CashEntry
	if err := s.db.Where("contrib_plan_id = ?", planID).Find(&deps).Error; err != nil {
		return nil, err
	}
	var txs []models.Transaction
	if err := s.db.Preload("Asset").Where("contrib_plan_id = ?", planID).Order("date, id").Find(&txs).Error; err != nil {
		return nil, err
	}
	byDay := map[string]*ContributionRound{}
	get := func(d string) *ContributionRound {
		r := byDay[d]
		if r == nil {
			r = &ContributionRound{Date: d, Buys: []models.Transaction{}}
			byDay[d] = r
		}
		return r
	}
	for _, d := range deps {
		get(dayString(d.Date)).Deposit += d.Amount
	}
	// 매수는 그달 회차(납입일)에 붙인다 — ETF 는 휴장이면 다음 거래일에 샀으므로 그 앞의 입금일로
	depDays := make([]string, 0, len(byDay))
	for d := range byDay {
		depDays = append(depDays, d)
	}
	sort.Strings(depDays)
	for _, t := range txs {
		day := dayString(t.Date)
		key := day
		for i := len(depDays) - 1; i >= 0; i-- {
			if depDays[i] <= day {
				key = depDays[i]
				break
			}
		}
		r := get(key)
		r.Buys = append(r.Buys, t)
	}
	out := make([]ContributionRound, 0, len(byDay))
	for _, r := range byDay {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date > out[j].Date })
	return out, nil
}

// DeleteRound: 한 회차의 입금·매수 기록을 지운다 (그달 부담금이 없었거나 금액이 달랐을 때 — 다시 자동으로 채우지 않는다)
func (s *ContributionService) DeleteRound(planID uint, date string) error {
	rounds, err := s.GetRounds(planID)
	if err != nil {
		return err
	}
	for _, r := range rounds {
		if r.Date != date {
			continue
		}
		for _, t := range r.Buys {
			if err := s.txs.DeleteTransaction(t.ID); err != nil {
				return err
			}
		}
		d, _ := parseDay(date)
		return s.db.Where("contrib_plan_id = ? AND date = ?", planID, d).Delete(&models.CashEntry{}).Error
	}
	return planInputErr("%s 회차를 찾을 수 없습니다", date)
}

// ── 자동 기록 ──

type ContributionRunResult struct {
	Rounds  int      `json:"rounds"`
	Buys    int      `json:"buys"`
	Pending int      `json:"pending"` // 시세가 아직 없어 다음에 마저 처리할 회차
	Errors  []string `json:"errors"`
}

// RunDue: 진행 중인 계획마다 지난 납입일 회차를 채운다 (앱을 며칠 안 켰어도 다음에 한꺼번에).
func (s *ContributionService) RunDue() (*ContributionRunResult, error) {
	res := &ContributionRunResult{Errors: []string{}}
	if !s.runMu.TryLock() {
		return res, nil
	}
	defer s.runMu.Unlock()
	now := s.now()
	today := todayKST(now)
	var plans []models.ContributionPlan
	if err := s.db.Preload("Items.Asset").Where("status = ?", models.PlanStatusActive).Order("id").Find(&plans).Error; err != nil {
		return nil, err
	}
	hist := map[string][]sessionBar{}
	for i := range plans {
		p := &plans[i]
		for _, due := range dueDates(p.MonthDay, pendingFrom(p), today) {
			done, err := s.processRound(p, due, now, hist, res)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("부담금 배분 %d %s: %v", p.ID, due, err))
				break
			}
			if !done {
				res.Pending++
				break
			}
			res.Rounds++
			if err := s.db.Model(&models.ContributionPlan{}).Where("id = ?", p.ID).Update("processed_through", due).Error; err != nil {
				res.Errors = append(res.Errors, err.Error())
				break
			}
			p.ProcessedThrough = due
		}
	}
	return res, nil
}

// processRound: 한 회차를 기록한다. ETF 시세(그 거래일 종가)가 아직 없으면 false — 다음에 다시 (이미 남긴 기록은 고유 인덱스로 건너뜀).
func (s *ContributionService) processRound(p *models.ContributionPlan, due string, now time.Time, hist map[string][]sessionBar, res *ContributionRunResult) (bool, error) {
	day, _ := parseDay(due)
	dep := models.CashEntry{AccountID: p.AccountID, Currency: "KRW", Date: day, Kind: models.CashDeposit, Amount: p.Amount, Notes: contribDepositNote, ContribPlanID: &p.ID}
	if err := s.db.Create(&dep).Error; err != nil && !isUniqueViolation(err) {
		return false, err
	}
	ready := true
	for _, it := range p.Items {
		alloc := p.Amount * it.Weight / 100
		var price, qty float64
		buyDay := day
		if IsFundTicker(it.Asset.Ticker) {
			price = s.funds.BuyNav(it.AssetID, due)
			qty = math.Floor(alloc/price/contribQtyStep) * contribQtyStep
		} else {
			bars, err := s.bars(it.Asset.Ticker, due, now, hist)
			if err != nil {
				return false, err
			}
			var bar *sessionBar
			for i := range bars {
				if bars[i].day >= due {
					bar = &bars[i]
					break
				}
			}
			if bar == nil || !sessionClosed(it.Asset.Ticker, bar.day, now) {
				ready = false // 그 거래일 종가가 아직 없다
				continue
			}
			price = bar.close
			qty = math.Floor(alloc / price) // 1주 단위
			buyDay, _ = parseDay(bar.day)
		}
		if qty <= 0 || price <= 0 {
			continue // 한 주 값보다 적으면 사지 않고 예수금으로 남는다
		}
		_, err := s.txs.CreateTransaction(CreateTransactionRequest{
			AccountID: p.AccountID, AssetID: it.AssetID, Type: models.TransactionTypeBuy,
			Date: buyDay, Price: price, Quantity: qty, Notes: contribBuyNote, ContribPlanID: &p.ID,
		})
		if err != nil {
			if !isUniqueViolation(err) {
				return false, err
			}
			continue
		}
		res.Buys++
	}
	return ready, nil
}

func (s *ContributionService) bars(ticker, due string, now time.Time, hist map[string][]sessionBar) ([]sessionBar, error) {
	key := strings.ToUpper(ticker)
	if b, ok := hist[key]; ok {
		return b, nil
	}
	if s.getHistory == nil {
		return nil, fmt.Errorf("시세 조회기가 없습니다")
	}
	rng := "3mo"
	if d, ok := parseDay(due); ok && now.Sub(d) > 80*24*time.Hour {
		rng = "2y"
	}
	h, err := s.getHistory(ticker, rng)
	if err != nil {
		return nil, fmt.Errorf("%s 시세: %w", ticker, err)
	}
	if h.Symbol == "" {
		h.Symbol = ticker
	}
	b := sessionBars(h)
	hist[key] = b
	return b, nil
}

// RunEvery: 지금 한 번, 이후 every 마다 RunDue (ctx 가 끝나면 멈춤)
func (s *ContributionService) RunEvery(ctx context.Context, every time.Duration) {
	run := func() {
		res, err := s.RunDue()
		if err != nil {
			log.Printf("[Contribution] 자동 기록 오류: %v", err)
			return
		}
		if res.Rounds > 0 || len(res.Errors) > 0 {
			log.Printf("[Contribution] %d회차 · 매수 %d건, 대기 %d, 오류 %v", res.Rounds, res.Buys, res.Pending, res.Errors)
		}
	}
	run()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
