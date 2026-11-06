package database

import (
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestRepairKoreanTickerPnLCurrency(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Transaction{}, &models.RealizedPnL{}); err != nil {
		t.Fatal(err)
	}
	acc := models.Account{Name: "해외", Broker: "토스증권", MarketType: models.MarketType("International"), Currency: "USD"}
	if err := db.Create(&acc).Error; err != nil {
		t.Fatal(err)
	}
	kr := models.Asset{Ticker: "379800.KS", Name: "KODEX 미국S&P500"}
	kq := models.Asset{Ticker: "091990.kq", Name: "코스닥 종목"}
	us := models.Asset{Ticker: "SOXL", Name: "SOXL"}
	for _, a := range []*models.Asset{&kr, &kq, &us} {
		if err := db.Create(a).Error; err != nil {
			t.Fatal(err)
		}
	}
	pnl := func(txID uint, assetID uint, cur string) *models.RealizedPnL {
		return &models.RealizedPnL{TransactionID: txID, AccountID: acc.ID, AssetID: assetID, Date: time.Now(), Quantity: 1, SellPrice: 100, Profit: 10, Currency: cur}
	}
	rows := []*models.RealizedPnL{
		pnl(1, kr.ID, "USD"), // 고쳐야 함
		pnl(2, kq.ID, "usd"), // 고쳐야 함 (소문자 티커·통화)
		pnl(3, kr.ID, "KRW"), // 이미 정상
		pnl(4, us.ID, "USD"), // 미국 종목은 그대로
	}
	for _, r := range rows {
		if err := db.Create(r).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := repairKoreanTickerPnLCurrency(db); err != nil {
		t.Fatal(err)
	}
	want := map[uint]string{1: "KRW", 2: "KRW", 3: "KRW", 4: "USD"}
	var got []models.RealizedPnL
	db.Find(&got)
	for _, r := range got {
		if r.Currency != want[r.TransactionID] {
			t.Errorf("tx %d currency = %q, want %q", r.TransactionID, r.Currency, want[r.TransactionID])
		}
	}

	// 다시 실행해도 바뀌는 것이 없어야 한다
	if err := repairKoreanTickerPnLCurrency(db); err != nil {
		t.Fatal(err)
	}
}
