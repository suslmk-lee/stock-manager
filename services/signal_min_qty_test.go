package services

import (
	"testing"

	"stock-manager/models"
)

// 소량 보유 매도 제외: 보유 수량이 기준(주) 이하이면 매도 조건이 충족돼도 매도 검토에서 빠진다.
func TestMinSellQtyExclusion(t *testing.T) {
	// avg 100, price 130 → 목표 수익률(30%) 충족
	tp := models.SignalRuleConfig{TakeProfitEnabled: true, TakeProfitPct: 30, SellMode: "any", BuyMode: "any"}
	withMin := func(enabled bool, qty float64) models.SignalRuleConfig {
		r := tp
		r.MinSellQtyEnabled, r.MinSellQty = enabled, qty
		return r
	}

	tests := []struct {
		name     string
		rule     models.SignalRuleConfig
		qty      float64
		want     string
		excluded bool
	}{
		{"1주 보유, 기준 1주 → 제외", withMin(true, 1), 1, SignalHold, true},
		{"0.4주(소수점) 보유, 기준 1주 → 제외", withMin(true, 1), 0.4, SignalHold, true},
		{"2주 보유, 기준 1주 → 매도", withMin(true, 1), 2, SignalSell, false},
		{"5주 보유, 기준 5주 → 제외", withMin(true, 5), 5, SignalHold, true},
		{"꺼짐이면 1주도 매도", withMin(false, 1), 1, SignalSell, false},
		{"기준 0이면 적용 안 함", withMin(true, 0), 1, SignalSell, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			it := evalOne(t, krwAsset(1, 130, tt.qty, 100, tt.rule))
			if it.Action != tt.want || it.SellExcludedSmallQty != tt.excluded {
				t.Errorf("action %s excluded %v, want %s %v", it.Action, it.SellExcludedSmallQty, tt.want, tt.excluded)
			}
			// 매도 조건 자체는 그대로 보여 준다
			if len(it.SellChecks) != 1 || !it.SellChecks[0].Met {
				t.Errorf("sell checks must stay visible: %+v", it.SellChecks)
			}
			if tt.excluded && it.MinSellQty != tt.rule.MinSellQty {
				t.Errorf("min_sell_qty %v", it.MinSellQty)
			}
		})
	}

	// 매도·매수가 동시에 충족(충돌)이던 종목은 매도만 빠져 매수 검토가 된다: price 80 → 손절·평단 하락 모두 충족
	c := models.SignalRuleConfig{StopLossEnabled: true, StopLossPct: -20, BuyDipEnabled: true, BuyDipPct: -10,
		MinSellQtyEnabled: true, MinSellQty: 1, SellMode: "any", BuyMode: "any"}
	if it := evalOne(t, krwAsset(1, 80, 1, 100, c)); it.Action != SignalBuy || !it.SellExcludedSmallQty {
		t.Errorf("conflict with small qty → buy: %s %v", it.Action, it.SellExcludedSmallQty)
	}

	// 켜진 매도 조건이 하나도 없으면 제외 표시도 하지 않는다
	if it := evalOne(t, krwAsset(1, 130, 1, 100, models.SignalRuleConfig{MinSellQtyEnabled: true, MinSellQty: 1, SellMode: "any", BuyMode: "any"})); it.SellExcludedSmallQty {
		t.Errorf("no sell checks must not be flagged")
	}
}

func TestMinSellQtyValidation(t *testing.T) {
	bad := models.DefaultSignalRuleConfig()
	bad.MinSellQty = -1
	if err := ValidateSignalRuleConfig(&bad); err == nil {
		t.Error("negative min_sell_qty must fail")
	}
	ok := models.DefaultSignalRuleConfig()
	ok.MinSellQty = 3
	if err := ValidateSignalRuleConfig(&ok); err != nil {
		t.Errorf("valid: %v", err)
	}
}

// v3 으로 저장된 프로필은 다음 로드 때 한 번만 v4 기본값(1주 이하 제외, 켜짐)으로 보정된다.
func TestProfileMigrationToV4(t *testing.T) {
	svc, db := newProfileSvc(t)
	if _, err := svc.GetSignalProfiles(); err != nil { // 내장 프로필 생성
		t.Fatal(err)
	}
	// v3 시절 저장 상태로 되돌린다 (새 컬럼은 0 값)
	if err := db.Model(&models.SignalProfile{}).Where("1 = 1").
		Updates(map[string]interface{}{"rule_version": 3, "rule_min_sell_qty_enabled": false, "rule_min_sell_qty": 0}).Error; err != nil {
		t.Fatal(err)
	}

	svc2 := NewSignalService(db, nil, nil) // 새 프로세스처럼 seeded 상태 없이 시작
	res, err := svc2.GetSignalProfiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Profiles) == 0 {
		t.Fatal("no profiles")
	}
	for _, p := range res.Profiles {
		if !p.Rule.MinSellQtyEnabled || p.Rule.MinSellQty != 1 {
			t.Errorf("profile %s not migrated: %+v", p.Key, p.Rule)
		}
	}
	var stored models.SignalProfile
	if err := db.First(&stored).Error; err != nil || stored.RuleVersion != models.SignalRuleVersion {
		t.Fatalf("version not persisted: %v %d", err, stored.RuleVersion)
	}

	// 사용자가 끈 뒤에는 다시 켜지지 않는다
	if err := db.Model(&models.SignalProfile{}).Where("1 = 1").Update("rule_min_sell_qty_enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	res, _ = NewSignalService(db, nil, nil).GetSignalProfiles()
	for _, p := range res.Profiles {
		if p.Rule.MinSellQtyEnabled {
			t.Errorf("must not re-migrate %s", p.Key)
		}
	}
}
