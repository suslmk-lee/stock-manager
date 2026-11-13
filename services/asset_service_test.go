package services

import (
	"testing"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// 한국 종목은 같은 코드면 같은 종목 — 꼬리표(.KS·.KQ·없음)만 다른 중복을 만들지 않는다. 영문이 섞인 새 코드도 .KS 를 붙인다.
func TestCreateAssetSameKRCode(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}); err != nil {
		t.Fatal(err)
	}
	s := &AssetService{db: db}
	create := func(ticker string) *models.Asset {
		t.Helper()
		a, err := s.CreateAsset(CreateAssetRequest{Ticker: ticker, Name: "종목 " + ticker, Type: models.AssetTypeETF, LogoURL: "x"})
		if err != nil {
			t.Fatalf("%s: %v", ticker, err)
		}
		return a
	}
	a := create("360750.KS")
	for _, tk := range []string{"360750", "360750.KQ", " 360750.ks "} {
		if b := create(tk); b.ID != a.ID {
			t.Fatalf("%q 는 같은 종목이어야 한다: %d vs %d (%s)", tk, b.ID, a.ID, b.Ticker)
		}
	}
	// 꼬리표 없이 저장된 옛 기록도 같은 종목으로
	db.Create(&models.Asset{Ticker: "0091P0", Name: "꼬리표 없는 옛 기록", Type: models.AssetTypeETF})
	old := models.Asset{}
	db.Where("ticker = ?", "0091P0").First(&old)
	if b := create("0091P0.KS"); b.ID != old.ID || b.Ticker != "0091P0.KS" {
		t.Fatalf("꼬리표 없는 옛 기록과 같은 종목이어야 한다: %+v", b)
	}
	// 새 영문 섞인 코드는 .KS
	if c := create("0105A0"); c.Ticker != "0105A0.KS" {
		t.Fatalf("영문 섞인 코드 = %s", c.Ticker)
	}
	// 미국 티커는 그대로
	if u := create("SCHD"); u.Ticker != "SCHD" {
		t.Fatalf("미국 티커 = %s", u.Ticker)
	}
	var n int64
	db.Model(&models.Asset{}).Count(&n)
	if n != 4 {
		t.Fatalf("자산 수 = %d (중복이 생겼다)", n)
	}
}
