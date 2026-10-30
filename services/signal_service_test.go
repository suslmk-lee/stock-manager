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
	if err := db.AutoMigrate(&models.SignalRule{}, &models.SignalProfile{}, &models.AssetSignalProfile{}, &models.ProfileSuggestion{}, &models.Asset{}, &models.Holding{}); err != nil {
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
	saved, err := svc.SaveDefaultRule(models.SignalRule{SignalRuleConfig: models.SignalRuleConfig{TakeProfitPct: 50, SellMode: ""}})
	if err != nil || saved.ID != defID || saved.TakeProfitEnabled || saved.SellMode != "any" || saved.TakeProfitPct != 50 {
		t.Fatalf("save default %+v %v", saved, err)
	}

	// upsert override twice -> one row
	o1, err := svc.SaveAssetRule(7, models.SignalRule{SignalRuleConfig: models.SignalRuleConfig{StopLossEnabled: true, StopLossPct: -5, SellMode: "all", BuyMode: "any"}})
	if err != nil || o1.AssetID != 7 {
		t.Fatalf("%+v %v", o1, err)
	}
	o2, err := svc.SaveAssetRule(7, models.SignalRule{SignalRuleConfig: models.SignalRuleConfig{StopLossEnabled: true, StopLossPct: -8}})
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
	if _, err := svc.SaveAssetRule(7, models.SignalRule{SignalRuleConfig: models.SignalRuleConfig{}}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateSignalRule(t *testing.T) {
	bad := []models.SignalRuleConfig{
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
		if err := ValidateSignalRuleConfig(&r); !errors.As(err, &inv) {
			t.Errorf("case %d: expected invalid, got %v", i, err)
		}
	}
	ok := models.SignalRuleConfig{SellMode: "ALL", StopLossPct: -20, BuyDipPct: 0}
	if err := ValidateSignalRuleConfig(&ok); err != nil || ok.SellMode != "all" || ok.BuyMode != "any" {
		t.Errorf("%v %+v", err, ok)
	}
}

func TestSignalRuleMigrationV1(t *testing.T) {
	db := newSignalTestDB(t)
	// 1단계 행: 새 컬럼은 모두 0/false, RuleVersion 0
	v1 := models.SignalRule{AssetID: 0, SignalRuleConfig: models.SignalRuleConfig{TakeProfitEnabled: true, TakeProfitPct: 30, StopLossEnabled: true, StopLossPct: -20, SellMode: "any", BuyMode: "any"}}
	ov := models.SignalRule{AssetID: 5, SignalRuleConfig: models.SignalRuleConfig{TakeProfitEnabled: true, TakeProfitPct: 12, SellMode: "any", BuyMode: "any"}}
	if err := db.Create(&v1).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&ov).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewSignalService(db, nil, nil)
	rules, err := svc.GetSignalRules()
	if err != nil {
		t.Fatal(err)
	}
	check := func(r models.SignalRule) {
		t.Helper()
		if r.RuleVersion != 3 || r.FromHighPct != -20 || r.BelowMAPct != -5 || r.AboveMAPct != 25 || r.DividendCutPct != 10 ||
			r.TaxHarvestFromMonth != 11 || !r.FxHistorical || !r.TaxHarvestEnabled ||
			r.FromHighEnabled || r.BelowMAEnabled || r.AboveMAEnabled || r.DividendCutEnabled {
			t.Errorf("migrated rule %+v", r)
		}
	}
	check(rules.Default)
	if len(rules.Overrides) != 1 || rules.Overrides[0].TakeProfitPct != 12 {
		t.Fatalf("overrides %+v", rules.Overrides)
	}
	check(rules.Overrides[0])

	// 영속화 확인
	var stored models.SignalRule
	if err := db.Where("asset_id = ?", 0).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	check(stored)

	// 사용자가 이후 값을 바꾸면(0 포함) 재보정되지 않는다: 버전은 저장 시 항상 최신
	if _, err := svc.SaveDefaultRule(models.SignalRule{SignalRuleConfig: models.SignalRuleConfig{FromHighPct: 0, FxHistorical: false, TaxHarvestFromMonth: 0}}); err != nil {
		t.Fatal(err)
	}
	rules, _ = svc.GetSignalRules()
	d := rules.Default
	if d.RuleVersion != 3 || d.FromHighPct != 0 || d.FxHistorical || d.TaxHarvestEnabled || d.TaxHarvestFromMonth != 11 {
		t.Errorf("must not re-migrate: %+v", d)
	}
}

func TestValidateSignalRuleStage2(t *testing.T) {
	bad := []models.SignalRuleConfig{
		{FromHighPct: 1},
		{BelowMAPct: 0.5},
		{AboveMAPct: -1},
		{DividendCutPct: -1},
		{TaxHarvestFromMonth: 13},
		{TaxHarvestFromMonth: -1},
		{AboveMAPct: math.Inf(1)},
		{DividendCutPct: math.NaN()},
	}
	for i, r := range bad {
		var inv *ErrInvalidSignalRule
		if err := ValidateSignalRuleConfig(&r); !errors.As(err, &inv) {
			t.Errorf("case %d: expected invalid, got %v", i, err)
		}
	}
	ok := models.SignalRuleConfig{FromHighPct: -30, AboveMAPct: 0, TaxHarvestFromMonth: 0}
	if err := ValidateSignalRuleConfig(&ok); err != nil || ok.TaxHarvestFromMonth != 11 {
		t.Errorf("%v %+v", err, ok)
	}
	def := models.DefaultSignalRule()
	if err := ValidateSignalRule(&def); err != nil || def.FromHighEnabled || def.BelowMAEnabled || def.AboveMAEnabled || def.DividendCutEnabled ||
		!def.TaxHarvestEnabled || !def.FxHistorical || def.RuleVersion != 3 {
		t.Errorf("default %v %+v", err, def)
	}
}
