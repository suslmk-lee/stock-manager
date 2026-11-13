package services

import (
	"crypto/rand"
	"errors"
	"math/big"
	"sort"
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 펀드: 거래소 시세가 없는 자산 (퇴직연금 DC 의 펀드 등). 티커는 FUND:<펀드코드> (코드가 없으면 앱이 만든 값), 원화.
// 기준가는 평가금액 맞추기로 쌓이고(FundPrice), 시세 조회(TickerService)가 펀드 티커를 물으면 이 값으로 답한다 — 그래서
// 자산 추이·통계·스냅샷이 다른 종목과 똑같이 펀드를 평가한다.
//
// 좌수: 앱이 센다. 처음 기준가 1,000원으로 시작해, 납입(매수)할 때마다 그때 마지막 기준가로 좌수가 늘고,
// 은행 앱의 평가금액을 넣으면 기준가 = 평가금액 ÷ 좌수로 다시 맞춘다 (펀드가 실제로 하는 방식과 같다).
// 원금은 납입한 금액 그대로라 원금·평가손익·수익률이 은행 앱과 맞는다.

const (
	fundTickerPrefix = "FUND:"
	fundStartNav     = 1000.0 // 처음 기준가 (1좌 = 1,000원으로 시작)
)

// IsFundTicker: 펀드 티커인지 (FUND:…)
func IsFundTicker(t string) bool {
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(t)), fundTickerPrefix)
}

type FundService struct {
	db  *gorm.DB
	now func() time.Time
}

func NewFundService(db *gorm.DB) *FundService { return &FundService{db: db, now: time.Now} }

func (s *FundService) today() string { return todayKST(s.now()) }

// randomCode: 펀드코드가 없을 때 쓰는 8자리 (영문 대문자·숫자)
func randomCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			b[i] = chars[i]
			continue
		}
		b[i] = chars[n.Int64()]
	}
	return "X" + string(b[:7])
}

// CreateFund: 펀드 자산을 만든다. 같은 펀드코드가 이미 있으면 그것을 돌려준다 (지웠던 것이면 되살린다).
func (s *FundService) CreateFund(name, code string) (*models.Asset, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, planInputErr("펀드 이름을 넣어 주세요")
	}
	code = strings.ToUpper(strings.Join(strings.Fields(code), ""))
	if len(code) > 15 {
		return nil, planInputErr("펀드코드는 15자 이하로 넣어 주세요 (예: K55229EH6561)")
	}
	if code == "" {
		code = randomCode()
	}
	ticker := fundTickerPrefix + code
	var existing models.Asset
	err := s.db.Unscoped().Where("ticker = ?", ticker).First(&existing).Error
	if err == nil {
		if existing.DeletedAt.Valid {
			if err := s.db.Unscoped().Model(&existing).Update("deleted_at", nil).Error; err != nil {
				return nil, err
			}
			existing.DeletedAt = gorm.DeletedAt{}
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	asset := models.Asset{Ticker: ticker, Name: name, Type: models.AssetTypeFund, Sector: "펀드"}
	if err := s.db.Create(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func (s *FundService) fundAsset(assetID uint) (*models.Asset, error) {
	var a models.Asset
	if err := s.db.First(&a, assetID).Error; err != nil {
		return nil, planInputErr("펀드를 찾을 수 없습니다")
	}
	if !IsFundTicker(a.Ticker) {
		return nil, planInputErr("%s 은(는) 펀드가 아닙니다 — 상장 종목은 시세로 평가합니다", a.Name)
	}
	return &a, nil
}

// NavOn: 그날(포함)까지의 마지막 기준가 (맞춘 값 → 없으면 마지막 매수 기준가). 아무것도 없으면 0.
func (s *FundService) NavOn(assetID uint, day string) float64 {
	var p models.FundPrice
	if err := s.db.Where("asset_id = ? AND date <= ?", assetID, day).Order("date DESC").Limit(1).Find(&p).Error; err == nil && p.Nav > 0 {
		// 맞춘 날 뒤에 산 기록은 그 기준가를 그대로 썼으므로 맞춘 값이 최신이다
		return p.Nav
	}
	var tx models.Transaction
	end, _ := parseDay(day)
	if err := s.db.Where("asset_id = ? AND date < ? AND price > 0", assetID, end.AddDate(0, 0, 1)).Order("date DESC, id DESC").Limit(1).Find(&tx).Error; err == nil && tx.Price > 0 {
		return tx.Price
	}
	return 0
}

// BuyNav: 납입(매수) 때 쓸 기준가 — 그날까지의 마지막 기준가, 처음이면 1,000원
func (s *FundService) BuyNav(assetID uint, day string) float64 {
	if v := s.NavOn(assetID, day); v > 0 {
		return v
	}
	return fundStartNav
}

// unitsOn: 그날(포함)까지의 매수·매도로 센 이 계좌의 좌수
func (s *FundService) unitsOn(accountID, assetID uint, day string) (float64, error) {
	end, ok := parseDay(day)
	if !ok {
		return 0, planInputErr("날짜 형식이 올바르지 않습니다")
	}
	var txs []models.Transaction
	if err := s.db.Where("account_id = ? AND asset_id = ? AND date < ?", accountID, assetID, end.AddDate(0, 0, 1)).Find(&txs).Error; err != nil {
		return 0, err
	}
	q := 0.0
	for _, t := range txs {
		if t.Type == models.TransactionTypeBuy {
			q += t.Quantity
		} else {
			q -= t.Quantity
		}
	}
	return q, nil
}

// Reconcile: 은행 앱의 평가금액으로 그날 기준가를 맞춘다 (기준가 = 평가금액 ÷ 그날 이 계좌 좌수). 같은 날 다시 넣으면 바꾼다.
func (s *FundService) Reconcile(accountID, assetID uint, value float64, day string) (*models.FundPrice, error) {
	if _, err := s.fundAsset(assetID); err != nil {
		return nil, err
	}
	if !(value > 0) || !finite(value) {
		return nil, planInputErr("평가금액을 0보다 크게 넣어 주세요")
	}
	day = strings.TrimSpace(day)
	if day == "" {
		day = s.today()
	}
	if _, ok := parseDay(day); !ok {
		return nil, planInputErr("날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)")
	}
	if day > s.today() {
		return nil, planInputErr("앞날의 평가금액은 넣을 수 없습니다")
	}
	units, err := s.unitsOn(accountID, assetID, day)
	if err != nil {
		return nil, err
	}
	if units <= 1e-9 {
		return nil, planInputErr("%s 에 이 계좌는 이 펀드를 보유하지 않았습니다", day)
	}
	p := models.FundPrice{AssetID: assetID, Date: day, Nav: value / units, Source: "reconcile"}
	if err := s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "asset_id"}, {Name: "date"}},
		DoUpdates: clause.AssignmentColumns([]string{"nav", "source"}),
	}).Create(&p).Error; err != nil {
		return nil, err
	}
	var saved models.FundPrice
	s.db.Where("asset_id = ? AND date = ?", assetID, day).First(&saved)
	return &saved, nil
}

// SetNav: 기준가를 직접 넣는다 (시작 잔고처럼 좌수를 앱이 정할 때)
func (s *FundService) SetNav(assetID uint, day string, nav float64, source string) error {
	if !(nav > 0) {
		return planInputErr("기준가가 올바르지 않습니다")
	}
	p := models.FundPrice{AssetID: assetID, Date: day, Nav: nav, Source: source}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "asset_id"}, {Name: "date"}},
		DoUpdates: clause.AssignmentColumns([]string{"nav", "source"}),
	}).Create(&p).Error
}

// Prices: 펀드 기준가 기록 (최근 것부터)
func (s *FundService) Prices(assetID uint) ([]models.FundPrice, error) {
	var out []models.FundPrice
	err := s.db.Where("asset_id = ?", assetID).Order("date DESC").Find(&out).Error
	return out, err
}

// DeletePrice: 맞춘 기준가 하나를 지운다
func (s *FundService) DeletePrice(id uint) error {
	return s.db.Delete(&models.FundPrice{}, id).Error
}

// ── TickerService 의 펀드 시세 ──

func (s *FundService) assetByTicker(ticker string) (*models.Asset, bool) {
	var a models.Asset
	if err := s.db.Unscoped().Where("ticker = ?", strings.ToUpper(strings.TrimSpace(ticker))).First(&a).Error; err != nil {
		return nil, false
	}
	return &a, true
}

// Current: 펀드의 지금 기준가 (마지막 맞춘 값 → 없으면 마지막 매수 기준가 → 없으면 1,000원)
func (s *FundService) Current(ticker string) *CurrentPrice {
	a, ok := s.assetByTicker(ticker)
	if !ok {
		return nil
	}
	nav := s.BuyNav(a.ID, s.today())
	prev := nav
	var ps []models.FundPrice
	if err := s.db.Where("asset_id = ?", a.ID).Order("date DESC").Limit(2).Find(&ps).Error; err == nil && len(ps) == 2 {
		prev = ps[1].Nav
	}
	cp := &CurrentPrice{Symbol: strings.ToUpper(ticker), Price: nav, Currency: "KRW", PreviousClose: prev}
	if prev > 0 {
		cp.Change = nav - prev
		cp.ChangePercent = (nav/prev - 1) * 100
	}
	return cp
}

// History: 펀드 기준가 이력 — 매수 기준가와 맞춘 기준가를 날짜순으로 (같은 날이면 맞춘 값)
func (s *FundService) History(ticker string) *PriceHistory {
	a, ok := s.assetByTicker(ticker)
	if !ok {
		return nil
	}
	byDay := map[string]float64{}
	var txs []models.Transaction
	s.db.Where("asset_id = ? AND price > 0", a.ID).Order("date ASC, id ASC").Find(&txs)
	for _, t := range txs {
		byDay[t.Date.In(kst).Format(dateLayout)] = t.Price
	}
	var ps []models.FundPrice
	s.db.Where("asset_id = ?", a.ID).Find(&ps)
	for _, p := range ps {
		byDay[p.Date] = p.Nav
	}
	days := make([]string, 0, len(byDay))
	for d := range byDay {
		days = append(days, d)
	}
	sort.Strings(days)
	h := &PriceHistory{Symbol: strings.ToUpper(ticker), Currency: "KRW", Range: "max", Interval: "1d", Points: make([]PricePoint, 0, len(days))}
	for _, d := range days {
		t, ok := parseDay(d)
		if !ok {
			continue
		}
		// 날짜 그대로 (UTC 자정, 오프셋 0) — floorDiv(Time+GmtOffset, 86400) 이 그 날짜가 된다
		h.Points = append(h.Points, PricePoint{Time: t.Unix(), Close: byDay[d]})
	}
	return h
}
