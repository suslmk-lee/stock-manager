package services

import (
	"math"
	"testing"
	"time"

	"stock-manager/models"
)

func fx1300(time.Time) float64 { return 1300 }

func TestComputeOverseasTax(t *testing.T) {
	now := kd(2026, 11, 15, 12)
	G := models.AccountTypeGeneral
	tests := []struct {
		name  string
		pnls  []TaxPnL
		fx    func(time.Time) float64
		now   time.Time
		from  int
		gain  float64
		loss  float64
		net   float64
		rem   float64
		tax   float64
		count int
		win   bool
	}{
		{"basic below exemption", []TaxPnL{{kd(2026, 3, 1, 10), 1000, "USD", "AAPL", G}}, fx1300, now, 10, 1_300_000, 0, 1_300_000, 1_200_000, 0, 1, true},
		{"above exemption with loss", []TaxPnL{
			{kd(2026, 3, 1, 10), 3000, "USD", "AAPL", G},
			{kd(2026, 4, 1, 10), -500, "USD", "MSFT", G}}, fx1300, now, 10, 3_900_000, 650_000, 3_250_000, 0, 750_000 * 0.22, 2, true},
		{"loss only", []TaxPnL{{kd(2026, 3, 1, 10), -100, "USD", "AAPL", G}}, fx1300, now, 10, 0, 130_000, -130_000, 2_630_000, 0, 1, true},
		{"ISA excluded", []TaxPnL{{kd(2026, 3, 1, 10), 1000, "USD", "AAPL", models.AccountTypeISA}}, fx1300, now, 10, 0, 0, 0, 2_500_000, 0, 0, true},
		{"pension excluded", []TaxPnL{{kd(2026, 3, 1, 10), 1000, "USD", "AAPL", models.AccountTypePension}}, fx1300, now, 10, 0, 0, 0, 2_500_000, 0, 0, true},
		{"domestic ETF excluded", []TaxPnL{{kd(2026, 3, 1, 10), 5_000_000, "KRW", "069500.KS", G}}, fx1300, now, 10, 0, 0, 0, 2_500_000, 0, 0, true},
		{"empty currency falls back to ticker", []TaxPnL{
			{kd(2026, 3, 1, 10), 1000, "", "AAPL", G},
			{kd(2026, 3, 1, 10), 9_000_000, "", "069500.KS", G}}, fx1300, now, 10, 1_300_000, 0, 1_300_000, 1_200_000, 0, 1, true},
		{"previous year excluded", []TaxPnL{{kd(2025, 12, 30, 10), 1000, "USD", "AAPL", G}}, fx1300, now, 10, 0, 0, 0, 2_500_000, 0, 0, true},
		{"Dec 31 23:30 KST counts for that year (UTC is still Dec 31 14:30)",
			[]TaxPnL{{time.Date(2026, 12, 31, 23, 30, 0, 0, kst), 100, "USD", "AAPL", G}}, fx1300, kd(2026, 12, 31, 23), 10, 130_000, 0, 130_000, 2_370_000, 0, 1, true},
		{"Jan 1 00:30 KST is new year (UTC Dec 31 15:30)",
			[]TaxPnL{{time.Date(2026, 12, 31, 15, 30, 0, 0, time.UTC), 100, "USD", "AAPL", G}}, fx1300, kd(2027, 1, 5, 12), 10, 130_000, 0, 130_000, 2_370_000, 0, 1, false},
		{"fx per date", []TaxPnL{
			{kd(2026, 1, 10, 10), 1000, "USD", "A", G},
			{kd(2026, 6, 10, 10), 1000, "USD", "B", G}},
			func(d time.Time) float64 {
				if d.Month() < 6 {
					return 1000
				}
				return 1400
			}, now, 10, 2_400_000, 0, 2_400_000, 100_000, 0, 2, true},
		{"window before fromMonth", nil, fx1300, kd(2026, 9, 30, 12), 10, 0, 0, 0, 2_500_000, 0, 0, false},
		{"window at fromMonth", nil, fx1300, kd(2026, 10, 1, 0), 10, 0, 0, 0, 2_500_000, 0, 0, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := ComputeOverseasTax(tc.pnls, tc.fx, tc.now, tc.from)
			eq := func(a, b float64) bool { return math.Abs(a-b) < 1e-6 }
			if !eq(s.RealizedGainKRW, tc.gain) || !eq(s.RealizedLossKRW, tc.loss) || !eq(s.NetKRW, tc.net) ||
				!eq(s.RemainingKRW, tc.rem) || !eq(s.EstimatedTaxKRW, tc.tax) || s.Count != tc.count ||
				s.HarvestWindow != tc.win || s.ExemptionKRW != OverseasTaxExemptionKRW {
				t.Errorf("got %+v", s)
			}
		})
	}
	if s := ComputeOverseasTax(nil, fx1300, kd(2026, 12, 31, 23), 10); s.Year != 2026 {
		t.Errorf("year %d", s.Year)
	}
	if s := ComputeOverseasTax(nil, fx1300, time.Date(2026, 12, 31, 15, 30, 0, 0, time.UTC), 10); s.Year != 2027 {
		t.Errorf("KST year %d", s.Year)
	}
}

func TestTaxHintFor(t *testing.T) {
	win := TaxSummary{HarvestWindow: true, ExemptionKRW: 2_500_000, NetKRW: 1_300_000, RemainingKRW: 1_200_000}
	over := TaxSummary{HarvestWindow: true, ExemptionKRW: 2_500_000, NetKRW: 4_000_000}
	closed := win
	closed.HarvestWindow = false
	tests := []struct {
		name    string
		sum     TaxSummary
		foreign bool
		unreal  float64
		kind    string
		amt     float64
		msg     string
	}{
		{"gain capped by remaining", win, true, 5_000_000, "harvest_gain", 1_200_000, "올해 비과세 한도 ₩1,200,000 남음 · 이익 일부 실현 후 재매수 검토"},
		{"gain capped by unrealized", win, true, 700_000, "harvest_gain", 700_000, "올해 비과세 한도 ₩1,200,000 남음 · 이익 일부 실현 후 재매수 검토"},
		{"loss capped by taxable", over, true, -3_000_000, "harvest_loss", 1_500_000, "올해 과세 대상 이익 ₩1,500,000 · 손실 ₩1,500,000 실현 시 과세 이익과 상계 가능"},
		{"loss capped by unrealized", over, true, -400_000, "harvest_loss", 400_000, "올해 과세 대상 이익 ₩1,500,000 · 손실 ₩400,000 실현 시 과세 이익과 상계 가능"},
		{"outside window", closed, true, 5_000_000, "", 0, ""},
		{"not foreign", win, false, 5_000_000, "", 0, ""},
		{"loss but no remaining and not over", TaxSummary{HarvestWindow: true, ExemptionKRW: 2_500_000, NetKRW: 2_500_000}, true, -100, "", 0, ""},
		{"gain but over exemption", over, true, 100_000, "", 0, ""},
		{"zero unrealized", win, true, 0, "", 0, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := TaxHintFor(tc.sum, tc.foreign, tc.unreal)
			if tc.kind == "" {
				if h != nil {
					t.Errorf("want nil, got %+v", h)
				}
				return
			}
			if h == nil || h.Kind != tc.kind || h.AmountKRW != tc.amt || h.Message != tc.msg {
				t.Errorf("got %+v", h)
			}
		})
	}
}

func TestFormatTaxKRW(t *testing.T) {
	for in, want := range map[float64]string{0: "₩0", 999: "₩999", 1000: "₩1,000", 1234567.4: "₩1,234,567", -2500000: "-₩2,500,000"} {
		if got := formatTaxKRW(in); got != want {
			t.Errorf("%v: got %s want %s", in, got, want)
		}
	}
}
