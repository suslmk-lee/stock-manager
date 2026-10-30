package services

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

// 평단가가 NaN 인 비정상 보유가 섞여도 리포트가 JSON 으로 직렬화돼야 한다.
func TestSanitizeSignalReportAllowsJSON(t *testing.T) {
	in := []SignalAssetInput{{
		AssetID: 1, Ticker: "SCHD", Name: "SCHD", Price: 28, PriceCurrency: "USD",
		Rule: models.DefaultSignalRuleConfig(), RuleSource: "default",
		Holdings: []SignalHoldingInput{{AccountID: 1, Quantity: 10, AvgPrice: math.NaN()}},
	}}
	report := BuildSignalReport(in, 1300, time.Now(), SignalContext{})
	if _, err := json.Marshal(report); err == nil {
		t.Fatalf("precondition: expected NaN to break json before sanitizing")
	}
	sanitizeSignalReport(&report)
	if _, err := json.Marshal(report); err != nil {
		t.Fatalf("json after sanitize: %v", err)
	}
	report.Items[0].SellChecks = append(report.Items[0].SellChecks, SignalCheck{Value: math.Inf(1)})
	sanitizeSignalReport(&report)
	if v := report.Items[0].SellChecks[len(report.Items[0].SellChecks)-1].Value; v != 0 {
		t.Fatalf("Inf in nested check not sanitized: %v", v)
	}
}
