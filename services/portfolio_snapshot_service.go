package services

import (
	"fmt"
	"log"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

type PortfolioSnapshotService struct {
	db            *gorm.DB
	tickerService *TickerService
	histCache     historyCache
	fetchHistory  func(ticker string) (*PriceHistory, error)
}

func NewPortfolioSnapshotService(db *gorm.DB, tickerService *TickerService) *PortfolioSnapshotService {
	s := &PortfolioSnapshotService{db: db, tickerService: tickerService}
	s.fetchHistory = func(ticker string) (*PriceHistory, error) {
		return tickerService.GetPriceHistory(ticker, "5y", "1mo")
	}
	return s
}

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
	return snapshots, err
}

// GetSnapshotsByAccountAndAsset returns snapshots for a specific account+asset
func (s *PortfolioSnapshotService) GetSnapshotsByAccountAndAsset(accountID, assetID uint) ([]models.PortfolioSnapshot, error) {
	var snapshots []models.PortfolioSnapshot
	err := s.db.Where("account_id = ? AND asset_id = ?", accountID, assetID).
		Order("year DESC, month DESC").
		Find(&snapshots).Error
	return snapshots, err
}

// GetSnapshotsByAsset returns snapshots for a specific asset across all accounts (전 계좌 기준 종목 추세용)
func (s *PortfolioSnapshotService) GetSnapshotsByAsset(assetID uint) ([]models.PortfolioSnapshot, error) {
	var snapshots []models.PortfolioSnapshot
	err := s.db.Preload("Account").Preload("Asset").
		Where("asset_id = ?", assetID).
		Order("year DESC, month DESC").
		Find(&snapshots).Error
	return snapshots, err
}

// GetMonthlyTotalByAccount returns monthly total market value per account
func (s *PortfolioSnapshotService) GetMonthlyTotalByAccount(accountID uint) ([]map[string]interface{}, error) {
	var results []struct {
		Year        int
		Month       int
		TotalValue  float64
		AssetCount  int64
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
	sortSummaries(out)
	return out, nil
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
