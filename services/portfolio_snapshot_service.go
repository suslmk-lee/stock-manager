package services

import (
	"fmt"
	"log"
	"math"
	"strings"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

type PortfolioSnapshotService struct {
	db            *gorm.DB
	tickerService *TickerService
	cash          *CashService // 월별 요약에 예수금 행을 더한다 (nil 이면 주식만)
	histCache     historyCache
	fetchHistory  func(ticker string) (*PriceHistory, error)
	// 엔화 등 원화·달러가 아닌 통화의 날짜별 원화 환율 (테스트에서 바꾼다, nil 이면 tickerService 로)
	fxLookup func(ccy string) func(time.Time) float64
}

func NewPortfolioSnapshotService(db *gorm.DB, tickerService *TickerService) *PortfolioSnapshotService {
	s := &PortfolioSnapshotService{db: db, tickerService: tickerService}
	s.fetchHistory = func(ticker string) (*PriceHistory, error) {
		return tickerService.GetPriceHistory(ticker, "5y", "1mo")
	}
	return s
}

// SetCash: 월별 요약에 계좌별 예수금 행을 더한다.
func (s *PortfolioSnapshotService) SetCash(c *CashService) { s.cash = c }

// EnsureCurrentMonthSnapshot checks if current month snapshot exists, if not, records it.
// Returns true if a new snapshot was created.
func (s *PortfolioSnapshotService) EnsureCurrentMonthSnapshot() (bool, error) {
	now := time.Now()
	year, month := now.Year(), int(now.Month())

	// Check if snapshot already exists for this month
	var count int64
	s.db.Model(&models.PortfolioSnapshot{}).
		Where("year = ? AND month = ?", year, month).
		Count(&count)

	if count > 0 {
		return false, nil
	}

	// Record snapshot for all accounts/assets
	if err := s.recordSnapshot(year, month); err != nil {
		return false, err
	}
	return true, nil
}

func (s *PortfolioSnapshotService) recordSnapshot(year, month int) error {
	// Get all holdings with positive quantity
	var holdings []models.Holding
	if err := s.db.Preload("Account").Preload("Asset").
		Where("quantity > 0").Find(&holdings).Error; err != nil {
		return fmt.Errorf("failed to fetch holdings: %w", err)
	}

	if len(holdings) == 0 {
		log.Println("[Snapshot] No holdings to snapshot")
		return nil
	}

	// Collect unique tickers
	tickerSet := make(map[string]bool)
	for _, h := range holdings {
		if h.Asset.Ticker != "" {
			tickerSet[h.Asset.Ticker] = true
		}
	}
	tickers := make([]string, 0, len(tickerSet))
	for t := range tickerSet {
		tickers = append(tickers, t)
	}

	// Batch fetch prices
	priceMap := s.tickerService.GetCurrentPrices(tickers)

	// Build snapshots
	snapshots := make([]models.PortfolioSnapshot, 0, len(holdings))
	for _, h := range holdings {
		ticker := h.Asset.Ticker
		price := 0.0
		currency := "KRW"

		if p, ok := priceMap[ticker]; ok && p != nil {
			price = p.Price
			currency = p.Currency
		}

		marketValue := h.Quantity * price

		snapshots = append(snapshots, models.PortfolioSnapshot{
			AccountID:   h.AccountID,
			AssetID:     h.AssetID,
			Year:        year,
			Month:       month,
			Quantity:    h.Quantity,
			Price:       price,
			MarketValue: marketValue,
			Currency:    currency,
		})
	}

	// Batch insert
	if err := s.db.CreateInBatches(snapshots, 50).Error; err != nil {
		return fmt.Errorf("failed to save snapshots: %w", err)
	}

	log.Printf("[Snapshot] Recorded %d snapshots for %d-%02d", len(snapshots), year, month)
	return nil
}

// GetSnapshotsByAccount returns all snapshots for a given account, ordered by year/month desc
func (s *PortfolioSnapshotService) GetSnapshotsByAccount(accountID uint) ([]models.PortfolioSnapshot, error) {
	var snapshots []models.PortfolioSnapshot
	err := s.db.Preload("Asset").
		Where("account_id = ?", accountID).
		Order("year DESC, month DESC").
		Find(&snapshots).Error
	s.rowsToKRW(snapshots)
	return snapshots, err
}

// GetSnapshotsByAccountAndAsset returns snapshots for a specific account+asset
func (s *PortfolioSnapshotService) GetSnapshotsByAccountAndAsset(accountID, assetID uint) ([]models.PortfolioSnapshot, error) {
	var snapshots []models.PortfolioSnapshot
	err := s.db.Where("account_id = ? AND asset_id = ?", accountID, assetID).
		Order("year DESC, month DESC").
		Find(&snapshots).Error
	s.rowsToKRW(snapshots)
	return snapshots, err
}

// GetSnapshotsByAsset returns snapshots for a specific asset across all accounts (전 계좌 기준 종목 추세용)
func (s *PortfolioSnapshotService) GetSnapshotsByAsset(assetID uint) ([]models.PortfolioSnapshot, error) {
	var snapshots []models.PortfolioSnapshot
	err := s.db.Preload("Account").Preload("Asset").
		Where("asset_id = ?", assetID).
		Order("year DESC, month DESC").
		Find(&snapshots).Error
	s.rowsToKRW(snapshots)
	return snapshots, err
}

// needsKRW: 화면이 직접 환산하지 못하는 통화 (원화·달러가 아닌 엔화 등)
func needsKRW(ccy string) bool {
	c := strings.TrimSpace(ccy)
	return c != "" && !isKRW(c) && !isUSD(c)
}

// monthFx: 통화별 그달 1일 원화 환율 (못 구하면 0). 한 번 받은 환율 히스토리는 이 조회 동안 다시 쓴다.
func (s *PortfolioSnapshotService) monthFx() func(ccy string, year, month int) float64 {
	cache := map[string]func(time.Time) float64{}
	return func(ccy string, year, month int) float64 {
		if s.tickerService == nil && s.fxLookup == nil {
			return 0
		}
		f, ok := cache[ccy]
		if !ok {
			if s.fxLookup != nil {
				f = s.fxLookup(ccy)
			} else {
				f = s.tickerService.FxLookupFor(ccy, s.tickerService.FxRateNow(ccy))
			}
			cache[ccy] = f
		}
		return f(time.Date(year, time.Month(month), 1, 0, 0, 0, 0, kst))
	}
}

// rowsToKRW: 엔화 등 원화·달러가 아닌 스냅샷 행을 그달 환율로 원화로 바꾼다 (화면은 원화·달러만 환산한다).
func (s *PortfolioSnapshotService) rowsToKRW(rows []models.PortfolioSnapshot) {
	rate := s.monthFx()
	for i := range rows {
		if !needsKRW(rows[i].Currency) {
			continue
		}
		if r := rate(rows[i].Currency, rows[i].Year, rows[i].Month); r > 0 {
			rows[i].Price *= r
			rows[i].MarketValue *= r
			rows[i].Currency = "KRW"
		}
	}
}

// GetMonthlyTotalByAccount returns monthly total market value per account
func (s *PortfolioSnapshotService) GetMonthlyTotalByAccount(accountID uint) ([]map[string]interface{}, error) {
	var results []struct {
		Year       int
		Month      int
		TotalValue float64
		AssetCount int64
	}

	err := s.db.Model(&models.PortfolioSnapshot{}).
		Select("year, month, SUM(market_value) as total_value, COUNT(*) as asset_count").
		Where("account_id = ?", accountID).
		Group("year, month").
		Order("year DESC, month DESC").
		Find(&results).Error

	if err != nil {
		return nil, err
	}

	output := make([]map[string]interface{}, len(results))
	for i, r := range results {
		output[i] = map[string]interface{}{
			"year":        r.Year,
			"month":       r.Month,
			"total_value": r.TotalValue,
			"asset_count": r.AssetCount,
		}
	}
	return output, nil
}

// MonthlySnapshotSummary is the per-month, per-account, per-currency aggregate of snapshots.
type MonthlySnapshotSummary struct {
	Year       int     `json:"year"`
	Month      int     `json:"month"`
	AccountID  uint    `json:"account_id"`
	Currency   string  `json:"currency"`
	TotalValue float64 `json:"total_value"`
	AssetCount int64   `json:"asset_count"`
	Estimated  bool    `json:"estimated"`
	Cash       bool    `json:"cash,omitempty"` // 예수금 행 (그 달 초 잔액)
}

// GetMonthlySummary returns monthly aggregates for the last `months` calendar months (KST, oldest first).
// Months with real snapshots are returned as recorded; other months up to the current one are
// estimated from transactions and historical prices (Estimated=true).
func (s *PortfolioSnapshotService) GetMonthlySummary(months int) ([]MonthlySnapshotSummary, error) {
	return s.getMonthlySummary(months, time.Now())
}

func (s *PortfolioSnapshotService) getMonthlySummary(months int, now time.Time) ([]MonthlySnapshotSummary, error) {
	if months < 1 {
		months = 1
	}
	if months > 60 {
		months = 60
	}
	window := windowMonths(now, months)
	first := window[0]

	real := []MonthlySnapshotSummary{}
	err := s.db.Raw(`SELECT year, month, account_id, currency, SUM(market_value) AS total_value, COUNT(*) AS asset_count
FROM portfolio_snapshots
WHERE (year * 12 + month) >= ? AND (year * 12 + month) <= ?
GROUP BY year, month, account_id, currency
ORDER BY year ASC, month ASC, account_id ASC`, first.index()+1, window[len(window)-1].index()+1).Scan(&real).Error
	if err != nil {
		return nil, err
	}

	have := map[monthKey]bool{}
	for _, r := range real {
		have[monthKey{r.Year, r.Month}] = true
	}
	missing := []monthKey{}
	for _, m := range window {
		if !have[m] {
			missing = append(missing, m)
		}
	}

	out := real
	if len(missing) > 0 {
		est, err := s.estimateMonths(missing)
		if err != nil {
			log.Printf("[Snapshot] estimate failed: %v", err)
		} else {
			out = append(out, est...)
		}
	}
	// 엔화 등은 그달 환율로 원화로 (화면은 원화·달러만 환산한다)
	rate := s.monthFx()
	for i := range out {
		if !needsKRW(out[i].Currency) {
			continue
		}
		if r := rate(out[i].Currency, out[i].Year, out[i].Month); r > 0 {
			out[i].TotalValue *= r
			out[i].Currency = "KRW"
		}
	}
	if s.cash != nil {
		out = append(out, cashMonthRows(window, s.cash.Timelines(), have)...)
	}
	sortSummaries(out)
	return out, nil
}

// cashMonthRows: 달마다 계좌별 예수금 행. 월별 스냅샷이 월초 기준이라 예수금도 전달 말일 마감 잔액을 쓴다.
// 추정 표시는 그 달 주식 행과 같게 맞춘다 (실측 스냅샷이 없는 달이면 추정).
func cashMonthRows(window []monthKey, tls []CashTimeline, recorded map[monthKey]bool) []MonthlySnapshotSummary {
	var out []MonthlySnapshotSummary
	for _, m := range window {
		day := m.start().AddDate(0, 0, -1).Format(dateLayout)
		for i := range tls {
			krw, usd, ok := tls[i].At(day)
			if !ok {
				continue
			}
			for _, c := range []struct {
				ccy string
				v   float64
			}{{"KRW", krw}, {"USD", usd}} {
				if math.Abs(c.v) < 0.005 {
					continue
				}
				out = append(out, MonthlySnapshotSummary{
					Year: m.Year, Month: m.Month, AccountID: tls[i].AccountID, Currency: c.ccy,
					TotalValue: math.Round(c.v*100) / 100, Estimated: !recorded[m], Cash: true,
				})
			}
		}
	}
	return out
}

// EnsureCurrentMonthSnapshotAsync runs snapshot in background (non-blocking)
var snapshotOnce sync.Once

func (s *PortfolioSnapshotService) EnsureCurrentMonthSnapshotAsync() {
	go func() {
		created, err := s.EnsureCurrentMonthSnapshot()
		if err != nil {
			log.Printf("[Snapshot] Error: %v", err)
		} else if created {
			log.Println("[Snapshot] Monthly snapshot created successfully")
		}
	}()
}
