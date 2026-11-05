package services

import (
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

// ErrInvalidSignalRule 은 규칙 검증 실패를 나타낸다 (HTTP 400 으로 매핑).
type ErrInvalidSignalRule struct{ Msg string }

func (e *ErrInvalidSignalRule) Error() string { return e.Msg }

// ErrSignalNotFound 는 대상(프로필/종목)이 없음을 나타낸다 (HTTP 404 으로 매핑).
type ErrSignalNotFound struct{ Msg string }

func (e *ErrSignalNotFound) Error() string { return e.Msg }

type SignalService struct {
	db       *gorm.DB
	ticker   *TickerService
	exchange *ExchangeRateService

	alertMu         sync.Mutex // 신호 상태/이벤트 기록 직렬화
	seedMu          sync.Mutex // 기본 프로필 시딩 직렬화
	seeded          bool
	onSettingsSaved func()
}

func NewSignalService(db *gorm.DB, ticker *TickerService, exchange *ExchangeRateService) *SignalService {
	return &SignalService{db: db, ticker: ticker, exchange: exchange}
}

// ValidateSignalRule 은 규칙을 검증하고 sell_mode/buy_mode 를 정규화한다.
func ValidateSignalRule(r *models.SignalRule) error {
	return ValidateSignalRuleConfig(&r.SignalRuleConfig)
}

// ValidateSignalRuleConfig 는 규칙 설정을 검증하고 일부 값을 정규화한다.
func ValidateSignalRuleConfig(r *models.SignalRuleConfig) error {
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
		"crash_pct":                       r.CrashPct,
		"min_sell_qty":                    r.MinSellQty,
		"trailing_activate_pct":           r.TrailingActivatePct,
		"trailing_drop_pct":               r.TrailingDropPct,
		"annualized_pct":                  r.AnnualizedPct,
		"annualized_min_return_pct":       r.AnnualizedMinReturnPct,
		"drift_pct":                       r.DriftPct,
		"partial_pct":                     r.PartialPct,
	}
	for k, v := range fin {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return &ErrInvalidSignalRule{fmt.Sprintf("%s must be a finite number", k)}
		}
	}
	if r.StopLossPct > 0 {
		return &ErrInvalidSignalRule{"stop_loss_pct must be <= 0"}
	}
	if r.CrashPct > 0 {
		return &ErrInvalidSignalRule{"crash_pct must be <= 0"}
	}
	if r.CrashPct == 0 {
		r.CrashPct = defaultCrashPct // 구버전 클라이언트가 필드를 보내지 않은 경우
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
	if r.MinSellQty < 0 {
		return &ErrInvalidSignalRule{"min_sell_qty must be >= 0"}
	}
	if r.TrailingActivatePct < 0 {
		return &ErrInvalidSignalRule{"trailing_activate_pct must be >= 0"}
	}
	if r.TrailingDropPct > 0 {
		return &ErrInvalidSignalRule{"trailing_drop_pct must be <= 0"}
	}
	if r.TrailingEnabled && r.TrailingDropPct == 0 {
		return &ErrInvalidSignalRule{"trailing_drop_pct must be < 0 when trailing is enabled"}
	}
	if r.AnnualizedPct < 0 {
		return &ErrInvalidSignalRule{"annualized_pct must be >= 0"}
	}
	if r.AnnualizedMinReturnPct < 0 {
		return &ErrInvalidSignalRule{"annualized_min_return_pct must be >= 0"}
	}
	if r.AnnualizedMinDays == 0 {
		r.AnnualizedMinDays = defaultAnnualizedMinDays // 구버전 클라이언트가 필드를 보내지 않은 경우
	}
	if r.AnnualizedMinDays < 1 || r.AnnualizedMinDays > 3650 {
		return &ErrInvalidSignalRule{"annualized_min_days must be 1..3650"}
	}
	if r.DriftPct < 0 {
		return &ErrInvalidSignalRule{"drift_pct must be >= 0"}
	}
	if r.DriftEnabled && r.DriftPct == 0 {
		return &ErrInvalidSignalRule{"drift_pct must be > 0 when drift is enabled"}
	}
	if r.PartialPct == 0 {
		r.PartialPct = defaultPartialPct
	}
	if r.PartialPct < 1 || r.PartialPct > 100 {
		return &ErrInvalidSignalRule{"partial_pct must be 1..100"}
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
	var profiles []models.SignalProfile
	if err := s.db.Find(&profiles).Error; err != nil {
		return nil, fmt.Errorf("프로필 조회 실패: %w", err)
	}
	profByID := make(map[uint]models.SignalProfile, len(profiles))
	var defProf models.SignalProfile
	for _, p := range profiles {
		profByID[p.ID] = p
		if p.Key == models.ProfileKeyDefault {
			defProf = p
		}
	}
	var assigns []models.AssetSignalProfile
	if err := s.db.Find(&assigns).Error; err != nil {
		return nil, fmt.Errorf("프로필 배정 조회 실패: %w", err)
	}
	assignOf := make(map[uint]uint, len(assigns))
	for _, a := range assigns {
		assignOf[a.AssetID] = a.ProfileID
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
			in = &SignalAssetInput{AssetID: asset.ID, Ticker: asset.Ticker, Name: asset.Name, Sector: asset.Sector}
			applyResolvedRule(in, defProf, profByID, assignOf, overrides)
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
		go func() { defer wg.Done(); histories = s.ticker.GetDailyHistoriesRangeCached(tickers, "2y") }() // 트레일링 고점은 1년보다 오래된 구간도 필요
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
	month := defProf.Rule.TaxHarvestFromMonth
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

// applyResolvedRule 은 종목에 적용할 규칙을 정한다: 종목 오버라이드 > 배정된 프로필 > 기본 프로필.
// 프로필 정보(profile_*)는 오버라이드가 있어도 종목이 속한 프로필을 가리킨다.
func applyResolvedRule(in *SignalAssetInput, def models.SignalProfile, profByID map[uint]models.SignalProfile,
	assignOf map[uint]uint, overrides map[uint]models.SignalRule) {
	prof, source := def, "default"
	if p, ok := profByID[assignOf[in.AssetID]]; ok && p.ID != def.ID {
		prof, source = p, "profile"
	}
	in.Rule, in.RuleSource = prof.Rule, source
	in.ProfileID, in.ProfileKey, in.ProfileName, in.ProfileKind = prof.ID, prof.Key, prof.Name, prof.Kind
	if o, has := overrides[in.AssetID]; has {
		in.Rule, in.RuleSource = o.SignalRuleConfig, "asset"
	}
}

func lookupPrice(prices map[string]*CurrentPrice, ticker string) *CurrentPrice {
	if p, ok := prices[strings.ToUpper(ticker)]; ok {
		return p
	}
	return prices[ticker]
}
