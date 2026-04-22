package services

import (
	"errors"
	"fmt"
	"stock-manager/database"
	"stock-manager/models"
	"time"

	"gorm.io/gorm"
)

func monthlyDividendQuery(withAccount bool) string {
	var yearExpr, monthExpr, groupExpr string

	if database.IsPostgres() {
		yearExpr = "EXTRACT(YEAR FROM date)::int"
		monthExpr = "EXTRACT(MONTH FROM date)::int"
		groupExpr = "EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date)"
	} else {
		yearExpr = "CAST(strftime('%Y', date) AS INTEGER)"
		monthExpr = "CAST(strftime('%m', date) AS INTEGER)"
		groupExpr = "strftime('%Y-%m', date)"
	}

	accountFilter := ""
	if withAccount {
		accountFilter = "AND account_id = ?\n\t\t"
	}

	return fmt.Sprintf(`
		SELECT 
			%s as year,
			%s as month,
			SUM(CASE WHEN currency = 'USD' THEN amount ELSE 0 END) as total_usd,
			SUM(CASE WHEN currency = 'KRW' THEN amount ELSE 0 END) as total_krw,
			COUNT(*) as count
		FROM dividends
		WHERE %sdate BETWEEN ? AND ?
		AND deleted_at IS NULL
		GROUP BY %s
		ORDER BY year, month
	`, yearExpr, monthExpr, accountFilter, groupExpr)
}

type DividendService struct {
	db         *gorm.DB
	sheetsSync *GoogleSheetsDividendSync
}

func NewDividendService() *DividendService {
	sheetsSync, err := NewGoogleSheetsDividendSyncFromEnv()
	if err != nil {
		fmt.Printf("[GSYNC][INIT] disabled: %v\n", err)
	} else if sheetsSync != nil {
		fmt.Printf("[GSYNC][INIT] enabled\n")
	}

	return &DividendService{
		db:         database.GetDB(),
		sheetsSync: sheetsSync,
	}
}

type CreateDividendRequest struct {
	AccountID  uint
	AssetID    uint
	Date       time.Time
	Amount     float64
	Currency   string
	Tax        float64
	IsReceived bool
	Notes      string
}

type MonthlyDividend struct {
	Year     int     `json:"year"`
	Month    int     `json:"month"`
	TotalUSD float64 `json:"total_usd"`
	TotalKRW float64 `json:"total_krw"`
	Count    int64   `json:"count"`
	Label    string  `json:"label"`
}

type DividendStats struct {
	TotalDividendsUSD float64 `json:"total_dividends_usd"`
	TotalDividendsKRW float64 `json:"total_dividends_krw"`
	TotalTaxUSD       float64 `json:"total_tax_usd"`
	TotalTaxKRW       float64 `json:"total_tax_krw"`
	ReceivedCount     int64   `json:"received_count"`
	PendingCount      int64   `json:"pending_count"`
}

func (s *DividendService) CreateDividend(req CreateDividendRequest) (*models.Dividend, error) {
	if req.Amount <= 0 {
		return nil, errors.New("dividend amount must be greater than 0")
	}
	if req.Tax < 0 {
		return nil, errors.New("tax cannot be negative")
	}

	var account models.Account
	if err := s.db.First(&account, req.AccountID).Error; err != nil {
		return nil, fmt.Errorf("account not found: %w", err)
	}

	var asset models.Asset
	if err := s.db.First(&asset, req.AssetID).Error; err != nil {
		return nil, fmt.Errorf("asset not found: %w", err)
	}

	if req.Currency == "" {
		req.Currency = account.Currency
	}

	dividend := &models.Dividend{
		AccountID:  req.AccountID,
		AssetID:    req.AssetID,
		Date:       req.Date,
		Amount:     req.Amount,
		Currency:   req.Currency,
		Tax:        req.Tax,
		IsReceived: req.IsReceived,
		Notes:      req.Notes,
	}

	if err := s.db.Create(dividend).Error; err != nil {
		return nil, fmt.Errorf("failed to create dividend: %w", err)
	}

	s.syncDividendDelta(account, asset, req.Date, req.Amount, "create")

	return dividend, nil
}

func (s *DividendService) GetDividendsByAccount(accountID uint) ([]models.Dividend, error) {
	var dividends []models.Dividend
	err := s.db.Where("account_id = ?", accountID).
		Preload("Asset").
		Order("date DESC, created_at DESC").
		Find(&dividends).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get dividends: %w", err)
	}

	fmt.Printf("GetDividendsByAccount: accountID=%d, found %d dividends\n", accountID, len(dividends))
	for i, d := range dividends {
		fmt.Printf("  [%d] ID=%d, AccountID=%d, AssetID=%d, Amount=%.2f, Date=%s\n",
			i, d.ID, d.AccountID, d.AssetID, d.Amount, d.Date)
	}

	return dividends, nil
}

func (s *DividendService) GetDividendsByAsset(assetID uint) ([]models.Dividend, error) {
	var dividends []models.Dividend
	err := s.db.Where("asset_id = ?", assetID).
		Preload("Account").
		Order("date DESC, created_at DESC").
		Find(&dividends).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get dividends: %w", err)
	}

	return dividends, nil
}

func (s *DividendService) GetMonthlyDividends(startDate, endDate time.Time) ([]MonthlyDividend, error) {
	var results []MonthlyDividend

	query := monthlyDividendQuery(false)
	rows, err := s.db.Raw(query, startDate, endDate).Rows()

	if err != nil {
		return nil, fmt.Errorf("failed to get monthly dividends: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var md MonthlyDividend

		if err := rows.Scan(&md.Year, &md.Month, &md.TotalUSD, &md.TotalKRW, &md.Count); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		md.Label = fmt.Sprintf("%d-%02d", md.Year, md.Month)
		results = append(results, md)
	}

	return results, nil
}

func (s *DividendService) GetMonthlyDividendsByAccount(accountID uint, startDate, endDate time.Time) ([]MonthlyDividend, error) {
	var results []MonthlyDividend

	query := monthlyDividendQuery(true)
	rows, err := s.db.Raw(query, accountID, startDate, endDate).Rows()

	if err != nil {
		return nil, fmt.Errorf("failed to get monthly dividends: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var md MonthlyDividend

		if err := rows.Scan(&md.Year, &md.Month, &md.TotalUSD, &md.TotalKRW, &md.Count); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		md.Label = fmt.Sprintf("%d-%02d", md.Year, md.Month)
		results = append(results, md)
	}

	return results, nil
}

func (s *DividendService) GetDividendStats() (*DividendStats, error) {
	var stats DividendStats

	var totalAmountUSD, totalAmountKRW, totalTaxUSD, totalTaxKRW float64
	var receivedCount, pendingCount int64

	// USD 배당금 및 세금
	s.db.Model(&models.Dividend{}).
		Select("COALESCE(SUM(amount), 0)").
		Where("currency = ?", "USD").
		Scan(&totalAmountUSD)

	s.db.Model(&models.Dividend{}).
		Select("COALESCE(SUM(tax), 0)").
		Where("currency = ?", "USD").
		Scan(&totalTaxUSD)

	// KRW 배당금 및 세금
	s.db.Model(&models.Dividend{}).
		Select("COALESCE(SUM(amount), 0)").
		Where("currency = ?", "KRW").
		Scan(&totalAmountKRW)

	s.db.Model(&models.Dividend{}).
		Select("COALESCE(SUM(tax), 0)").
		Where("currency = ?", "KRW").
		Scan(&totalTaxKRW)

	// 건수
	s.db.Model(&models.Dividend{}).Where("is_received = ?", true).Count(&receivedCount)
	s.db.Model(&models.Dividend{}).Where("is_received = ?", false).Count(&pendingCount)

	stats.TotalDividendsUSD = totalAmountUSD
	stats.TotalDividendsKRW = totalAmountKRW
	stats.TotalTaxUSD = totalTaxUSD
	stats.TotalTaxKRW = totalTaxKRW
	stats.ReceivedCount = receivedCount
	stats.PendingCount = pendingCount

	return &stats, nil
}

func (s *DividendService) UpdateDividend(id uint, req CreateDividendRequest) (*models.Dividend, error) {
	var dividend models.Dividend
	if err := s.db.First(&dividend, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("dividend not found")
		}
		return nil, fmt.Errorf("failed to find dividend: %w", err)
	}

	// 기존 배당 정보(시트 역보정용)
	oldDividend := dividend
	var oldAccount models.Account
	oldAccountFound := s.db.First(&oldAccount, oldDividend.AccountID).Error == nil
	var oldAsset models.Asset
	oldAssetFound := s.db.First(&oldAsset, oldDividend.AssetID).Error == nil

	// 계좌 존재 확인
	var account models.Account
	if err := s.db.First(&account, req.AccountID).Error; err != nil {
		return nil, errors.New("account not found")
	}

	// 자산 존재 확인
	var asset models.Asset
	if err := s.db.First(&asset, req.AssetID).Error; err != nil {
		return nil, errors.New("asset not found")
	}

	// 배당금 정보 업데이트
	dividend.AccountID = req.AccountID
	dividend.AssetID = req.AssetID
	dividend.Date = req.Date
	dividend.Amount = req.Amount
	dividend.Currency = req.Currency
	dividend.Tax = req.Tax
	dividend.IsReceived = req.IsReceived
	dividend.Notes = req.Notes

	if err := s.db.Save(&dividend).Error; err != nil {
		return nil, fmt.Errorf("failed to update dividend: %w", err)
	}

	// 기존 반영분 차감 후, 신규 반영분 가산
	if oldAccountFound && oldAssetFound {
		s.syncDividendDelta(oldAccount, oldAsset, oldDividend.Date, -oldDividend.Amount, "update-revert")
	}
	s.syncDividendDelta(account, asset, req.Date, req.Amount, "update-apply")

	return &dividend, nil
}

func (s *DividendService) DeleteDividend(id uint) error {
	var dividend models.Dividend
	if err := s.db.First(&dividend, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("dividend not found")
		}
		return fmt.Errorf("failed to find dividend: %w", err)
	}

	result := s.db.Delete(&models.Dividend{}, id)
	if result.Error != nil {
		return fmt.Errorf("failed to delete dividend: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return errors.New("dividend not found")
	}

	var account models.Account
	accountFound := s.db.First(&account, dividend.AccountID).Error == nil
	var asset models.Asset
	assetFound := s.db.First(&asset, dividend.AssetID).Error == nil
	if accountFound && assetFound {
		s.syncDividendDelta(account, asset, dividend.Date, -dividend.Amount, "delete")
	}

	return nil
}

func (s *DividendService) syncDividendDelta(account models.Account, asset models.Asset, date time.Time, delta float64, action string) {
	if delta == 0 {
		return
	}

	if s.sheetsSync == nil {
		sync, err := NewGoogleSheetsDividendSyncFromEnv()
		if err != nil {
			if envBool("GOOGLE_SHEETS_ENABLED") {
				fmt.Printf("[GSYNC][INIT][FAIL] action=%s err=%v\n", action, err)
			}
			return
		}
		if sync == nil {
			return
		}
		s.sheetsSync = sync
	}

	if err := s.sheetsSync.ApplyDelta(account, asset, date, delta); err != nil {
		fmt.Printf("[GSYNC][FAIL] action=%s account=%s ticker=%s amount=%.4f date=%s err=%v\n",
			action,
			account.Name,
			asset.Ticker,
			delta,
			date.Format("2006-01-02"),
			err,
		)
		return
	}

	if envBool("GOOGLE_SHEETS_DEBUG") {
		fmt.Printf("[GSYNC][OK] action=%s account=%s ticker=%s amount=%.4f date=%s\n",
			action,
			account.Name,
			asset.Ticker,
			delta,
			date.Format("2006-01-02"),
		)
	}
}
