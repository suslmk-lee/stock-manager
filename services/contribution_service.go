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
	contribDepositNote        = "부담금 입금"
	contribBuyNote            = "부담금 배분"
	contribOpeningNote        = "부담금 배분 시작 잔고"
	contribOpeningDepositNote = "부담금 배분 시작 잔고 (그동안 들어온 부담금)"
	contribQtyStep            = 0.0001 // 펀드 좌수 단위
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
	// 시작 잔고 (선택): ETF·주식은 보유 수량·평균 단가, 펀드는 원금·평가금액 — 고칠 때는 Openings 가 true 일 때만 본다
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
	// 고칠 때: true 면 시작 잔고도 Items 의 값으로 맞춘다 (바뀐 상품만 매수 기록을 다시 만들고, 비우면 지운다)
	Openings bool `json:"openings"`
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
	created, err := s.getPlan(plan.ID)
	if err != nil {
		return nil, err
	}
	if err := s.syncOpenings(created, req, assets, req.StartedOn); err != nil {
		return nil, err
	}
	return s.getPlan(plan.ID)
}

// contribOpening: 상품 하나의 시작 잔고 (연결된 매수 기록)
type contribOpening struct {
	tx                    models.Transaction
	qty, avg, cost, value float64
}

// openingPaid: 시작 잔고로 들어간 돈 (ETF 수량 × 평균 단가, 펀드 원금)
func openingPaid(a models.Asset, it ContributionItemRequest) float64 {
	if IsFundTicker(a.Ticker) {
		if it.OpeningCost > 0 {
			return it.OpeningCost
		}
		return 0
	}
	if it.OpeningQty > 0 && it.OpeningAvg > 0 {
		return it.OpeningQty * it.OpeningAvg
	}
	return 0
}

// openings: 계획의 상품별 시작 잔고 — 연결된 매수 기록, 연결 전에 만든 계획은 메모·날짜로 찾는다
func (s *ContributionService) openings(p *models.ContributionPlan) map[uint]contribOpening {
	out := map[uint]contribOpening{}
	for _, it := range p.Items {
		var tx models.Transaction
		found := false
		if it.OpeningTxID != nil {
			found = s.db.First(&tx, *it.OpeningTxID).Error == nil
		} else {
			var cands []models.Transaction
			s.db.Where("account_id = ? AND asset_id = ? AND contrib_plan_id IS NULL AND notes LIKE ?", p.AccountID, it.AssetID, contribOpeningNote+"%").Order("id").Find(&cands)
			for _, c := range cands {
				if dayString(c.Date) == p.StartedOn {
					tx, found = c, true
					break
				}
			}
		}
		if !found {
			continue
		}
		o := contribOpening{tx: tx}
		if IsFundTicker(it.Asset.Ticker) {
			o.cost = tx.Quantity * tx.Price
			var fp models.FundPrice
			if s.db.Where("asset_id = ? AND date = ? AND source = ?", it.AssetID, p.StartedOn, "opening").Limit(1).Find(&fp).Error == nil && fp.ID != 0 {
				o.value = fp.Nav * tx.Quantity
			}
		} else {
			o.qty, o.avg = tx.Quantity, tx.Price
		}
		out[it.AssetID] = o
	}
	return out
}

// openingDeposit: 시작 잔고 입금 기록 (연결 전에 만든 계획은 메모·날짜로 찾는다)
func (s *ContributionService) openingDeposit(p *models.ContributionPlan) *models.CashEntry {
	if p.OpeningDepositID != nil {
		var e models.CashEntry
		if s.db.First(&e, *p.OpeningDepositID).Error == nil {
			return &e
		}
		return nil
	}
	var cands []models.CashEntry
	s.db.Where("account_id = ? AND kind = ? AND notes = ? AND contrib_plan_id IS NULL", p.AccountID, models.CashDeposit, contribOpeningDepositNote).Order("id").Find(&cands)
	for i := range cands {
		if dayString(cands[i].Date) == p.StartedOn {
			return &cands[i]
		}
	}
	return nil
}

// hasRounds: 자동 기록한 회차가 있는지 (있으면 시작 잔고 날짜는 옮기지 않는다)
func (s *ContributionService) hasRounds(planID uint) bool {
	var n, m int64
	s.db.Model(&models.CashEntry{}).Where("contrib_plan_id = ?", planID).Count(&n)
	s.db.Model(&models.Transaction{}).Where("contrib_plan_id = ?", planID).Count(&m)
	return n+m > 0
}

// syncOpenings: 시작 잔고를 req 의 값으로 맞춘다 — 바뀐 상품만 매수 기록을 다시 만들고(비우면 지운다), 입금 하나를 합계로.
// p.Items 에 계획에서 뺀 상품이 있으면 그 시작 잔고는 실제 보유라 그대로 두고 입금 합계에도 남긴다. day: 시작 잔고 날짜.
func (s *ContributionService) syncOpenings(p *models.ContributionPlan, req ContributionPlanRequest, assets map[uint]models.Asset, day string) error {
	t, ok := parseDay(day)
	if !ok {
		return planInputErr("시작 잔고 날짜가 올바르지 않습니다")
	}
	old := s.openings(p)
	moved := day != p.StartedOn
	links := map[uint]*uint{}
	total := 0.0
	inReq := map[uint]bool{}
	for _, it := range req.Items {
		inReq[it.AssetID] = true
		a := assets[it.AssetID]
		fund := IsFundTicker(a.Ticker)
		paid := openingPaid(a, it)
		total += paid
		o, had := old[it.AssetID]
		if had && !moved {
			if fund && paid > 0 && math.Abs(o.cost-paid) < 0.5 {
				// 원금이 같으면 매수는 그대로, 평가금액만 기준가로
				if math.Abs(o.value-it.OpeningValue) >= 0.5 {
					if err := s.setOpeningNav(a.ID, day, it.OpeningValue, o.tx.Quantity); err != nil {
						return err
					}
				}
				id := o.tx.ID
				links[it.AssetID] = &id
				continue
			}
			if !fund && paid > 0 && math.Abs(o.qty-it.OpeningQty) < 1e-9 && math.Abs(o.avg-it.OpeningAvg) < 1e-6 {
				id := o.tx.ID
				links[it.AssetID] = &id
				continue
			}
		}
		if had {
			if err := s.txs.DeleteTransaction(o.tx.ID); err != nil {
				return err
			}
			if fund {
				if err := s.db.Where("asset_id = ? AND date = ? AND source = ?", a.ID, p.StartedOn, "opening").Delete(&models.FundPrice{}).Error; err != nil {
					return err
				}
			}
		}
		if paid <= 0 {
			continue
		}
		var tx *models.Transaction
		var err error
		if fund {
			units := math.Floor(it.OpeningCost/fundStartNav/contribQtyStep) * contribQtyStep
			if units <= 0 {
				continue
			}
			tx, err = s.txs.CreateTransaction(CreateTransactionRequest{AccountID: p.AccountID, AssetID: a.ID, Type: models.TransactionTypeBuy,
				Date: t, Price: it.OpeningCost / units, Quantity: units, Notes: contribOpeningNote + " (원금)"})
			if err == nil {
				err = s.setOpeningNav(a.ID, day, it.OpeningValue, units)
			}
		} else {
			tx, err = s.txs.CreateTransaction(CreateTransactionRequest{AccountID: p.AccountID, AssetID: a.ID, Type: models.TransactionTypeBuy,
				Date: t, Price: it.OpeningAvg, Quantity: it.OpeningQty, Notes: contribOpeningNote})
		}
		if err != nil {
			return err
		}
		id := tx.ID
		links[it.AssetID] = &id
	}
	for assetID, o := range old {
		if !inReq[assetID] {
			total += o.tx.Quantity * o.tx.Price
		}
	}

	// 입금 하나를 합계로 (없던 시작 잔고가 생기면 만들고, 모두 비우면 지운다)
	var depID *uint
	dep := s.openingDeposit(p)
	switch {
	case total > 0 && dep != nil:
		if err := s.db.Model(&models.CashEntry{}).Where("id = ?", dep.ID).Updates(map[string]interface{}{"amount": total, "date": t}).Error; err != nil {
			return err
		}
		id := dep.ID
		depID = &id
	case total > 0:
		e := models.CashEntry{AccountID: p.AccountID, Currency: "KRW", Date: t, Kind: models.CashDeposit, Amount: total, Notes: contribOpeningDepositNote}
		if err := s.db.Create(&e).Error; err != nil {
			return err
		}
		depID = &e.ID
	case dep != nil:
		if err := s.db.Delete(&models.CashEntry{}, dep.ID).Error; err != nil {
			return err
		}
	}

	// 연결을 남긴다 (상품 줄과 계획)
	return s.db.Transaction(func(tx *gorm.DB) error {
		for _, it := range p.Items {
			if err := tx.Model(&models.ContributionItem{}).Where("id = ?", it.ID).Update("opening_tx_id", links[it.AssetID]).Error; err != nil {
				return err
			}
		}
		return tx.Model(&models.ContributionPlan{}).Where("id = ?", p.ID).Updates(map[string]interface{}{"opening_deposit_id": depID, "started_on": day}).Error
	})
}

// setOpeningNav: 시작 잔고 평가금액으로 그날 기준가 (평가금액이 없으면 지운다)
func (s *ContributionService) setOpeningNav(assetID uint, day string, value, units float64) error {
	if value > 0 && units > 0 {
		return s.funds.SetNav(assetID, day, value/units, "opening")
	}
	return s.db.Where("asset_id = ? AND date = ? AND source = ?", assetID, day, "opening").Delete(&models.FundPrice{}).Error
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
	assets, err := s.validate(&req)
	if err != nil {
		return nil, err
	}
	carry := map[uint]*uint{} // 상품 줄을 다시 만들어도 시작 잔고 연결은 이어 간다
	for _, it := range cur.Items {
		carry[it.AssetID] = it.OpeningTxID
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
			if err := tx.Create(&models.ContributionItem{PlanID: id, AssetID: it.AssetID, Weight: it.Weight, OpeningTxID: carry[it.AssetID]}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if req.Openings {
		// 시작 잔고 날짜는 자동 기록한 회차가 아직 없을 때만 옮긴다
		day := cur.StartedOn
		if req.StartedOn != "" && req.StartedOn != cur.StartedOn && !s.hasRounds(id) {
			day = req.StartedOn
		}
		p, err := s.getPlan(id)
		if err != nil {
			return nil, err
		}
		// 계획에서 뺀 상품의 예전 시작 잔고도 보이게 예전 상품 줄을 함께 넘긴다 (그대로 두고 입금 합계에 남긴다)
		for _, it := range cur.Items {
			if !containsAsset(p.Items, it.AssetID) {
				p.Items = append(p.Items, it)
			}
		}
		p.StartedOn = cur.StartedOn
		if err := s.syncOpenings(p, req, assets, day); err != nil {
			return nil, err
		}
	}
	return s.getPlan(id)
}

func containsAsset(items []models.ContributionItem, assetID uint) bool {
	for _, it := range items {
		if it.AssetID == assetID {
			return true
		}
	}
	return false
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
	// 시작 잔고 (고치기 화면에 채워 둔다): ETF 수량·평균 단가, 펀드 원금·평가금액
	OpeningQty   float64 `json:"opening_qty"`
	OpeningAvg   float64 `json:"opening_avg"`
	OpeningCost  float64 `json:"opening_cost"`
	OpeningValue float64 `json:"opening_value"`
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
		opening := s.openings(&p)
		for _, it := range p.Items {
			iv := ContributionItemView{ContributionItem: it, IsFund: IsFundTicker(it.Asset.Ticker)}
			if o, ok := opening[it.AssetID]; ok {
				iv.OpeningQty, iv.OpeningAvg, iv.OpeningCost, iv.OpeningValue = o.qty, o.avg, o.cost, o.value
			}
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
