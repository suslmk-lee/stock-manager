package services

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
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

	alertMu         sync.Mutex // 신호 상태/이벤트 기록 직렬화
	onSettingsSaved func()
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
		"from_high_pct":                   r.FromHighPct,
		"below_ma_pct":                    r.BelowMAPct,
		"above_ma_pct":                    r.AboveMAPct,
		"dividend_cut_pct":                r.DividendCutPct,
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
	if r.FromHighPct > 0 {
		return &ErrInvalidSignalRule{"from_high_pct must be <= 0"}
	}
	if r.BelowMAPct > 0 {
		return &ErrInvalidSignalRule{"below_ma_pct must be <= 0"}
	}
	if r.AboveMAPct < 0 {
		return &ErrInvalidSignalRule{"above_ma_pct must be >= 0"}
	}
	if r.DividendCutPct < 0 {
		return &ErrInvalidSignalRule{"dividend_cut_pct must be >= 0"}
	}
	if r.TaxHarvestFromMonth == 0 {
		r.TaxHarvestFromMonth = defaultTaxHarvestMonth
	}
	if r.TaxHarvestFromMonth < 1 || r.TaxHarvestFromMonth > 12 {
		return &ErrInvalidSignalRule{"tax_harvest_from_month must be 1..12"}
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

const defaultTaxHarvestMonth = 11

// migrateSignalRule 은 1단계(RuleVersion < 2) 규칙의 0 값 필드를 새 기본값으로 한 번만 보정한다.
// 보정했으면 true.
func migrateSignalRule(r *models.SignalRule) bool {
	if r.RuleVersion >= models.SignalRuleVersion {
		return false
	}
	def := models.DefaultSignalRule()
	if r.FromHighPct == 0 {
		r.FromHighPct = def.FromHighPct
	}
	if r.BelowMAPct == 0 {
		r.BelowMAPct = def.BelowMAPct
	}
	if r.AboveMAPct == 0 {
		r.AboveMAPct = def.AboveMAPct
	}
	if r.DividendCutPct == 0 {
		r.DividendCutPct = def.DividendCutPct
	}
	if r.TaxHarvestFromMonth == 0 {
		r.TaxHarvestFromMonth = defaultTaxHarvestMonth
	}
	r.FxHistorical = true
	r.TaxHarvestEnabled = true
	r.RuleVersion = models.SignalRuleVersion
	return true
}

func (s *SignalService) persistMigrated(r *models.SignalRule) error {
	if !migrateSignalRule(r) {
		return nil
	}
	return s.db.Omit(clause.Associations).Save(r).Error
}

func (s *SignalService) GetSignalRules() (*SignalRules, error) {
	def, err := s.getOrCreateDefault()
	if err != nil {
		return nil, err
	}
	if err := s.persistMigrated(&def); err != nil {
		return nil, err
	}
	overrides := []models.SignalRule{}
	if err := s.db.Where("asset_id <> ?", 0).Order("asset_id").Find(&overrides).Error; err != nil {
		return nil, err
	}
	for i := range overrides {
		if err := s.persistMigrated(&overrides[i]); err != nil {
			return nil, err
		}
	}
	return &SignalRules{Default: def, Overrides: overrides}, nil
}

func (s *SignalService) saveRule(assetID uint, rule models.SignalRule) (models.SignalRule, error) {
	if err := ValidateSignalRule(&rule); err != nil {
		return rule, err
	}
	rule.AssetID = assetID
	rule.RuleVersion = models.SignalRuleVersion // 클라이언트가 보낸 값과 무관하게 최신 스키마로 저장 (재보정 방지)
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

// GetSignals 는 신호 리포트를 만들고, 신호 변화를 이력에 기록한다 (기록 실패는 로그만 남김).
func (s *SignalService) GetSignals() (*SignalReport, error) {
	report, err := s.buildSignalReport()
	if err != nil {
		return nil, err
	}
	_, rerr := s.recordReport(report)
	logRecordErr(rerr)
	return report, nil
}

// buildSignalReport 는 보유 종목별 지표를 집계해 규칙을 평가한 리포트를 만든다.
func (s *SignalService) buildSignalReport() (*SignalReport, error) {
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

	now := time.Now()

	// 시세/일봉/환율 이력은 네트워크 호출이므로 DB 조회와 무관하게 동시에 가져온다.
	tickers := make([]string, 0, len(order))
	for _, id := range order {
		tickers = append(tickers, inputs[id].Ticker)
	}
	var (
		wg        sync.WaitGroup
		prices    = map[string]*CurrentPrice{}
		histories = map[string]*PriceHistory{}
		fxHist    *PriceHistory
	)
	if len(tickers) > 0 {
		wg.Add(2)
		go func() { defer wg.Done(); prices = s.ticker.GetCurrentPrices(tickers) }()
		go func() { defer wg.Done(); histories = s.ticker.GetDailyHistoriesCached(tickers) }()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		if h, err := s.ticker.GetFxHistoryCached(); err == nil {
			fxHist = h
		}
	}()

	if len(order) > 0 {
		var txns []models.Transaction
		if err := s.db.Where("asset_id IN ?", order).Find(&txns).Error; err != nil {
			wg.Wait()
			return nil, fmt.Errorf("거래 조회 실패: %w", err)
		}
		for _, t := range txns {
			if _, ok := accMap[t.AccountID]; !ok {
				continue
			}
			inputs[t.AssetID].Txns = append(inputs[t.AssetID].Txns, SignalTxnInput{
				AccountID: t.AccountID, Type: t.Type, Date: t.Date, Quantity: t.Quantity, Price: t.Price, Fee: t.Fee,
			})
		}
		var divs []models.Dividend
		if err := s.db.Where("asset_id IN ?", order).Find(&divs).Error; err != nil {
			wg.Wait()
			return nil, fmt.Errorf("배당 조회 실패: %w", err)
		}
		for _, d := range divs {
			if _, ok := accMap[d.AccountID]; !ok {
				continue
			}
			inputs[d.AssetID].Dividends = append(inputs[d.AssetID].Dividends, SignalDividendInput{
				AccountID: d.AccountID, Amount: d.Amount, Tax: d.Tax, Currency: d.Currency, Date: d.Date,
			})
		}
	}

	// 실현손익: 양도세는 보유 여부와 무관하게 전 종목이 필요하다.
	var allPnls []models.RealizedPnL
	if err := s.db.Find(&allPnls).Error; err != nil {
		wg.Wait()
		return nil, fmt.Errorf("실현손익 조회 실패: %w", err)
	}
	var taxPnls []TaxPnL
	for _, p := range allPnls {
		acc, ok := accMap[p.AccountID]
		if !ok {
			continue
		}
		ticker := assetMap[p.AssetID].Ticker
		taxPnls = append(taxPnls, TaxPnL{
			Date: p.Date, ProfitLocal: p.Profit, Currency: p.Currency, Ticker: ticker, AccountType: acc.AccountType,
		})
		if in := inputs[p.AssetID]; in != nil {
			in.PnLs = append(in.PnLs, SignalPnLInput{
				Date: p.Date, Profit: p.Profit, BuyAvgPrice: p.BuyAvgPrice, Quantity: p.Quantity, Currency: p.Currency,
			})
		}
	}

	usdKRW, _ := s.exchange.GetUSDToKRW()
	if usdKRW <= 0 {
		usdKRW = 1300 // 환율 조회 실패 시 서비스 기본값과 동일
	}
	wg.Wait()

	for _, id := range order {
		in := inputs[id]
		if p := lookupPrice(prices, in.Ticker); p != nil && p.Price > 0 {
			in.Price = p.Price
			in.PriceCurrency = p.Currency
		}
		if h := histories[strings.ToUpper(in.Ticker)]; h != nil {
			in.History = h.Points
		}
	}

	ctx := SignalContext{FxAt: NewFxLookup(fxHist, usdKRW), FxOK: fxHist != nil && len(fxHist.Points) > 0}
	month := rules.Default.TaxHarvestFromMonth
	if month < 1 || month > 12 {
		month = defaultTaxHarvestMonth
	}
	tax := ComputeOverseasTax(taxPnls, ctx.FxAt, now, month)
	ctx.Tax = &tax

	list := make([]SignalAssetInput, 0, len(order))
	for _, id := range order {
		list = append(list, *inputs[id])
	}
	report := BuildSignalReport(list, usdKRW, now, ctx)
	sanitizeSignalReport(&report)
	return &report, nil
}

func lookupPrice(prices map[string]*CurrentPrice, ticker string) *CurrentPrice {
	if p, ok := prices[strings.ToUpper(ticker)]; ok {
		return p
	}
	return prices[ticker]
}
