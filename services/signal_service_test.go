package services

import (
	"errors"
	"math"
	"testing"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newSignalTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.SignalRule{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestSignalRuleCRUD(t *testing.T) {
	svc := NewSignalService(newSignalTestDB(t), nil, nil)

	rules, err := svc.GetSignalRules()
	if err != nil {
		t.Fatal(err)
	}
	def := models.DefaultSignalRule()
	if rules.Default.ID == 0 || rules.Default.AssetID != 0 || rules.Default.TakeProfitPct != def.TakeProfitPct ||
		!rules.Default.BuyDipEnabled || rules.Default.SellMode != "any" || len(rules.Overrides) != 0 {
		t.Fatalf("default %+v", rules)
	}
	defID := rules.Default.ID

	// second read does not create another default
	if r2, _ := svc.GetSignalRules(); r2.Default.ID != defID {
		t.Error("default recreated")
	}

	// save default (store whatever is saved, incl. disabled)
	saved, err := svc.SaveDefaultRule(models.SignalRule{TakeProfitPct: 50, SellMode: ""})
	if err != nil || saved.ID != defID || saved.TakeProfitEnabled || saved.SellMode != "any" || saved.TakeProfitPct != 50 {
		t.Fatalf("save default %+v %v", saved, err)
	}

	// upsert override twice -> one row
	o1, err := svc.SaveAssetRule(7, models.SignalRule{StopLossEnabled: true, StopLossPct: -5, SellMode: "all", BuyMode: "any"})
	if err != nil || o1.AssetID != 7 {
		t.Fatalf("%+v %v", o1, err)
	}
	o2, err := svc.SaveAssetRule(7, models.SignalRule{StopLossEnabled: true, StopLossPct: -8})
	if err != nil || o2.ID != o1.ID || o2.StopLossPct != -8 || o2.SellMode != "any" {
		t.Fatalf("%+v %v", o2, err)
	}
	rules, _ = svc.GetSignalRules()
	if len(rules.Overrides) != 1 || rules.Overrides[0].StopLossPct != -8 {
		t.Fatalf("%+v", rules.Overrides)
	}

	if err := svc.DeleteAssetRule(7); err != nil {
		t.Fatal(err)
	}
	rules, _ = svc.GetSignalRules()
	if len(rules.Overrides) != 0 {
		t.Error("override not deleted")
	}
	// re-create after hard delete works with unique index
	if _, err := svc.SaveAssetRule(7, models.SignalRule{}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateSignalRule(t *testing.T) {
	bad := []models.SignalRule{
		{SellMode: "some"},
		{BuyMode: "x"},
		{StopLossPct: 1},
		{BuyDipPct: 0.1},
		{WeightBandPct: -1},
		{TakeProfitPct: math.NaN()},
		{HighYieldPct: math.Inf(1)},
	}
	for i, r := range bad {
		var inv *ErrInvalidSignalRule
		if err := ValidateSignalRule(&r); !errors.As(err, &inv) {
			t.Errorf("case %d: expected invalid, got %v", i, err)
		}
	}
	ok := models.SignalRule{SellMode: "ALL", StopLossPct: -20, BuyDipPct: 0}
	if err := ValidateSignalRule(&ok); err != nil || ok.SellMode != "all" || ok.BuyMode != "any" {
		t.Errorf("%v %+v", err, ok)
	}
}
