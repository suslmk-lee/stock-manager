package services

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrInvalidSignalRule 은 규칙 검증 실패를 나타낸다 (HTTP 400 으로 매핑).
type ErrInvalidSignalRule struct{ Msg string }

func (e *ErrInvalidSignalRule) Error() string { return e.Msg }

type SignalRules struct {
	Default   models.SignalRule   `json:"default"`
	Overrides []models.SignalRule `json:"overrides"`
}

type SignalService struct {
	db       *gorm.DB
	ticker   *TickerService
	exchange *ExchangeRateService
}

func NewSignalService(db *gorm.DB, ticker *TickerService, exchange *ExchangeRateService) *SignalService {
	return &SignalService{db: db, ticker: ticker, exchange: exchange}
}

// ValidateSignalRule 은 규칙을 검증하고 sell_mode/buy_mode 를 정규화한다.
func ValidateSignalRule(r *models.SignalRule) error {
	fin := map[string]float64{
		"take_profit_pct":                 r.TakeProfitPct,
		"stop_loss_pct":                   r.StopLossPct,
		"target_weight_pct":               r.TargetWeightPct,
		"weight_band_pct":                 r.WeightBandPct,
		"dividend_payback_pct":            r.DividendPaybackPct,
		"dividend_payback_min_return_pct": r.DividendPaybackMinReturnPct,
		"low_yield_pct":                   r.LowYieldPct,
		"buy_dip_pct":                     r.BuyDipPct,
		"high_yield_pct":                  r.HighYieldPct,
	}
	for k, v := range fin {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return &ErrInvalidSignalRule{fmt.Sprintf("%s must be a finite number", k)}
		}
	}
	if r.StopLossPct > 0 {
		return &ErrInvalidSignalRule{"stop_loss_pct must be <= 0"}
	}
	if r.BuyDipPct > 0 {
		return &ErrInvalidSignalRule{"buy_dip_pct must be <= 0"}
	}
	if r.WeightBandPct < 0 {
		return &ErrInvalidSignalRule{"weight_band_pct must be >= 0"}
	}
	var err error
	if r.SellMode, err = normalizeSignalMode("sell_mode", r.SellMode); err != nil {
		return err
	}
	if r.BuyMode, err = normalizeSignalMode("buy_mode", r.BuyMode); err != nil {
		return err
	}
	return nil
}

func normalizeSignalMode(name, v string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "any":
		return "any", nil
	case "all":
		return "all", nil
	}
	return "", &ErrInvalidSignalRule{name + " must be 'any' or 'all'"}
}

// getOrCreateDefault 는 전역 기본 규칙을 반환하며 없으면 "균형" 기본값으로 생성한다.
func (s *SignalService) getOrCreateDefault() (models.SignalRule, error) {
	var r models.SignalRule
	err := s.db.Where("asset_id = ?", 0).First(&r).Error
	if err == nil {
		return r, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return r, err
	}
	r = models.DefaultSignalRule()
	if err := s.db.Create(&r).Error; err != nil {
		return r, err
	}
	return r, nil
}

func (s *SignalService) GetSignalRules() (*SignalRules, error) {
	def, err := s.getOrCreateDefault()
	if err != nil {
		return nil, err
	}
	overrides := []models.SignalRule{}
	if err := s.db.Where("asset_id <> ?", 0).Order("asset_id").Find(&overrides).Error; err != nil {
		return nil, err
	}
	return &SignalRules{Default: def, Overrides: overrides}, nil
}

func (s *SignalService) saveRule(assetID uint, rule models.SignalRule) (models.SignalRule, error) {
	if err := ValidateSignalRule(&rule); err != nil {
		return rule, err
	}
	rule.AssetID = assetID
	var existing models.SignalRule
	err := s.db.Where("asset_id = ?", assetID).First(&existing).Error
	switch {
	case err == nil:
		rule.ID = existing.ID
		rule.CreatedAt = existing.CreatedAt
		if err := s.db.Omit(clause.Associations).Save(&rule).Error; err != nil {
			return rule, err
		}
	case errors.Is(err, gorm.ErrRecordNotFound):
		rule.ID = 0
		rule.CreatedAt = time.Time{}
		if err := s.db.Create(&rule).Error; err != nil {
			return rule, err
		}
	default:
		return rule, err
	}
	return rule, nil
}

func (s *SignalService) SaveDefaultRule(rule models.SignalRule) (*models.SignalRule, error) {
	r, err := s.saveRule(0, rule)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *SignalService) SaveAssetRule(assetID uint, rule models.SignalRule) (*models.SignalRule, error) {
	if assetID == 0 {
		return nil, &ErrInvalidSignalRule{"asset id is required"}
	}
	r, err := s.saveRule(assetID, rule)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *SignalService) DeleteAssetRule(assetID uint) error {
	if assetID == 0 {
		return &ErrInvalidSignalRule{"asset id is required"}
	}
	return s.db.Where("asset_id = ?", assetID).Delete(&models.SignalRule{}).Error
}

// GetSignals 는 보유 종목별 지표를 집계해 규칙을 평가한 리포트를 만든다.
func (s *SignalService) GetSignals() (*SignalReport, error) {
	rules, err := s.GetSignalRules()
	if err != nil {
		return nil, fmt.Errorf("신호 규칙 조회 실패: %w", err)
	}
	overrides := make(map[uint]models.SignalRule, len(rules.Overrides))
	for _, o := range rules.Overrides {
		overrides[o.AssetID] = o
	}

	var holdings []models.Holding
	if err := s.db.Where("quantity > 0").Find(&holdings).Error; err != nil {
		return nil, fmt.Errorf("보유 조회 실패: %w", err)
	}
	var accounts []models.Account
	if err := s.db.Find(&accounts).Error; err != nil {
		return nil, fmt.Errorf("계좌 조회 실패: %w", err)
	}
	accMap := make(map[uint]models.Account, len(accounts))
	for _, a := range accounts {
		accMap[a.ID] = a
	}
	var assets []models.Asset
	if err := s.db.Find(&assets).Error; err != nil {
		return nil, fmt.Errorf("종목 조회 실패: %w", err)
	}
	assetMap := make(map[uint]models.Asset, len(assets))
	for _, a := range assets {
		assetMap[a.ID] = a
	}

	inputs := map[uint]*SignalAssetInput{}
	var order []uint
	for _, h := range holdings {
		acc, ok := accMap[h.AccountID]
		if !ok {
			continue // 삭제된 계좌
		}
		asset, ok := assetMap[h.AssetID]
		if !ok {
			continue
		}
		in := inputs[h.AssetID]
		if in == nil {
			in = &SignalAssetInput{AssetID: asset.ID, Ticker: asset.Ticker, Name: asset.Name}
			if o, has := overrides[asset.ID]; has {
				in.Rule, in.RuleSource = o, "asset"
			} else {
				in.Rule, in.RuleSource = rules.Default, "default"
			}
			inputs[h.AssetID] = in
			order = append(order, h.AssetID)
		}
		in.Holdings = append(in.Holdings, SignalHoldingInput{
			AccountID: acc.ID, AccountName: acc.Name, Broker: acc.Broker,
			AccountType: acc.AccountType, Quantity: h.Quantity, AvgPrice: h.AveragePrice,
		})
	}

	if len(order) > 0 {
		var pnls []models.RealizedPnL
		if err := s.db.Where("asset_id IN ?", order).Find(&pnls).Error; err != nil {
			return nil, fmt.Errorf("실현손익 조회 실패: %w", err)
		}
		for _, p := range pnls {
			if _, ok := accMap[p.AccountID]; !ok {
				continue
			}
			inputs[p.AssetID].PnLs = append(inputs[p.AssetID].PnLs, SignalPnLInput{
				Profit: p.Profit, BuyAvgPrice: p.BuyAvgPrice, Quantity: p.Quantity, Currency: p.Currency,
			})
		}
		var divs []models.Dividend
		if err := s.db.Where("asset_id IN ?", order).Find(&divs).Error; err != nil {
			return nil, fmt.Errorf("배당 조회 실패: %w", err)
		}
		for _, d := range divs {
			if _, ok := accMap[d.AccountID]; !ok {
				continue
			}
			inputs[d.AssetID].Dividends = append(inputs[d.AssetID].Dividends, SignalDividendInput{
				Amount: d.Amount, Tax: d.Tax, Currency: d.Currency, Date: d.Date,
			})
		}
	}

	tickers := make([]string, 0, len(order))
	for _, id := range order {
		tickers = append(tickers, inputs[id].Ticker)
	}
	prices := map[string]*CurrentPrice{}
	if len(tickers) > 0 {
		prices = s.ticker.GetCurrentPrices(tickers)
	}
	for _, id := range order {
		in := inputs[id]
		if p := lookupPrice(prices, in.Ticker); p != nil && p.Price > 0 {
			in.Price = p.Price
			in.PriceCurrency = p.Currency
		}
	}

	usdKRW, _ := s.exchange.GetUSDToKRW()
	if usdKRW <= 0 {
		usdKRW = 1300 // 환율 조회 실패 시 서비스 기본값과 동일
	}
	list := make([]SignalAssetInput, 0, len(order))
	for _, id := range order {
		list = append(list, *inputs[id])
	}
	report := BuildSignalReport(list, usdKRW, time.Now())
	sanitizeSignalReport(&report)
	return &report, nil
}

func lookupPrice(prices map[string]*CurrentPrice, ticker string) *CurrentPrice {
	if p, ok := prices[strings.ToUpper(ticker)]; ok {
		return p
	}
	return prices[ticker]
}
