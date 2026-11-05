package services

import (
	"testing"

	"stock-manager/models"
)

// "N개 이상 충족" 방식: 켜진 조건 중 충족된 개수가 N 이상이면 신호.
func TestSellMinCountMode(t *testing.T) {
	// avg 100, price 130: 목표 수익률(30) 충족, 배당 회수(0%·최소 0) 충족, 손절(-20) 미충족 → 켜진 3개 중 2개 충족
	base := models.SignalRuleConfig{
		TakeProfitEnabled: true, TakeProfitPct: 30,
		DividendPaybackEnabled: true, DividendPaybackPct: 0, DividendPaybackMinReturnPct: 0,
		StopLossEnabled: true, StopLossPct: -20,
		BuyMode: "any",
	}
	tests := []struct {
		name  string
		mode  string
		count int
		want  string
	}{
		{"any", "any", 0, SignalSell},
		{"2개 이상 → 충족", "count", 2, SignalSell},
		{"3개 이상 → 미충족", "count", 3, SignalHold},
		{"켜진 수보다 큰 값은 모두로 처리", "count", 9, SignalHold},
		{"all", "all", 0, SignalHold},
		{"count 1 은 any 와 같다", "count", 1, SignalSell},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := base
			r.SellMode, r.SellMinCount = tt.mode, tt.count
			if it := evalOne(t, krwAsset(1, 130, 10, 100, r)); it.Action != tt.want {
				t.Errorf("action %s want %s", it.Action, tt.want)
			}
		})
	}

	// 켜진 조건이 2개뿐이고 둘 다 충족이면, 3개 이상을 요구해도 "모두"로 보고 신호를 낸다
	two := base
	two.StopLossEnabled = false
	two.SellMode, two.SellMinCount = "count", 3
	if it := evalOne(t, krwAsset(1, 130, 10, 100, two)); it.Action != SignalSell {
		t.Errorf("count above enabled → all: %s", it.Action)
	}
}

func TestMinCountValidation(t *testing.T) {
	c := models.DefaultSignalRuleConfig()
	c.SellMode, c.SellMinCount = "count", 0
	if err := ValidateSignalRuleConfig(&c); err == nil {
		t.Error("count mode needs min count >= 1")
	}
	c = models.DefaultSignalRuleConfig()
	c.BuyMode, c.BuyMinCount = "count", 2
	if err := ValidateSignalRuleConfig(&c); err != nil || c.BuyMinCount != 2 {
		t.Errorf("valid count: %v %d", err, c.BuyMinCount)
	}
	// count 가 아닌 방식이면 개수는 비운다
	c = models.DefaultSignalRuleConfig()
	c.SellMode, c.SellMinCount = "any", 4
	if err := ValidateSignalRuleConfig(&c); err != nil || c.SellMinCount != 0 {
		t.Errorf("non-count mode clears count: %v %d", err, c.SellMinCount)
	}
	c = models.DefaultSignalRuleConfig()
	c.SellMode = "most"
	if err := ValidateSignalRuleConfig(&c); err == nil {
		t.Error("unknown mode must fail")
	}
}
