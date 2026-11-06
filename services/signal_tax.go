package services

import (
	"fmt"
	"time"

	"stock-manager/models"
)

// 해외주식 양도소득세: 연간 순이익에서 기본공제 250만원을 뺀 금액의 22%.
const OverseasTaxExemptionKRW = 2_500_000
const OverseasTaxRate = 0.22

// TaxPnL 은 양도세 계산용 실현손익 1건이다.
type TaxPnL struct {
	Date        time.Time
	ProfitLocal float64 // 해당 통화 기준 실현손익 (수수료 반영, 저장값)
	Currency    string
	Ticker      string
	AccountType models.AccountType
}

// TaxSummary 는 올해 해외주식 양도세 현황이다.
type TaxSummary struct {
	Year            int     `json:"year"`
	RealizedGainKRW float64 `json:"realized_gain_krw"`
	RealizedLossKRW float64 `json:"realized_loss_krw"`
	NetKRW          float64 `json:"net_krw"`
	ExemptionKRW    float64 `json:"exemption_krw"`
	RemainingKRW    float64 `json:"remaining_krw"`
	EstimatedTaxKRW float64 `json:"estimated_tax_krw"`
	HarvestWindow   bool    `json:"harvest_window"`
	Count           int     `json:"count"`
}

// ComputeOverseasTax 는 now(KST) 연도의 일반계좌 해외상장 종목 실현손익으로 양도세를 추정한다.
func ComputeOverseasTax(pnls []TaxPnL, fxAt func(time.Time) float64, now time.Time, fromMonth int) TaxSummary {
	nk := now.In(kst)
	s := TaxSummary{
		Year:          nk.Year(),
		ExemptionKRW:  OverseasTaxExemptionKRW,
		HarvestWindow: int(nk.Month()) >= fromMonth,
	}
	for _, p := range pnls {
		if p.AccountType != models.AccountTypeGeneral || p.Date.In(kst).Year() != s.Year {
			continue
		}
		// 국내 상장 종목은 기록된 통화가 USD 여도 해외주식이 아니다 (ResolveCurrency 참고)
		if ResolveCurrency(p.Currency, p.Ticker) != "USD" {
			continue
		}
		krw := p.ProfitLocal * fxAt(p.Date)
		if krw >= 0 {
			s.RealizedGainKRW += krw
		} else {
			s.RealizedLossKRW += -krw
		}
		s.Count++
	}
	s.NetKRW = s.RealizedGainKRW - s.RealizedLossKRW
	if r := s.ExemptionKRW - s.NetKRW; r > 0 {
		s.RemainingKRW = r
	}
	if e := s.NetKRW - s.ExemptionKRW; e > 0 {
		s.EstimatedTaxKRW = e * OverseasTaxRate
	}
	return s
}

// TaxHint 는 종목별 절세 힌트다.
type TaxHint struct {
	Kind      string  `json:"kind"` // "harvest_gain" | "harvest_loss"
	AmountKRW float64 `json:"amount_krw"`
	Message   string  `json:"message"`
}

func formatTaxKRW(v float64) string {
	n := int64(v + 0.5)
	if v < 0 {
		n = int64(v - 0.5)
	}
	neg := n < 0
	if neg {
		n = -n
	}
	s := fmt.Sprintf("%d", n)
	var out []byte
	for i := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, s[i])
	}
	r := "₩" + string(out)
	if neg {
		r = "-" + r
	}
	return r
}

func minTaxFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// TaxHintFor 는 연말 절세(이익 실현/손실 상계) 힌트를 만든다. 해당 없으면 nil.
func TaxHintFor(sum TaxSummary, foreignListed bool, generalUnrealizedKRW float64) *TaxHint {
	if !foreignListed || !sum.HarvestWindow {
		return nil
	}
	if sum.RemainingKRW > 0 && generalUnrealizedKRW > 0 {
		return &TaxHint{
			Kind:      "harvest_gain",
			AmountKRW: minTaxFloat(sum.RemainingKRW, generalUnrealizedKRW),
			Message:   fmt.Sprintf("올해 비과세 한도 %s 남음 · 이익 일부 실현 후 재매수 검토", formatTaxKRW(sum.RemainingKRW)),
		}
	}
	if sum.NetKRW > sum.ExemptionKRW && generalUnrealizedKRW < 0 {
		taxable := sum.NetKRW - sum.ExemptionKRW
		amt := minTaxFloat(-generalUnrealizedKRW, taxable)
		return &TaxHint{
			Kind:      "harvest_loss",
			AmountKRW: amt,
			Message:   fmt.Sprintf("올해 과세 대상 이익 %s · 손실 %s 실현 시 과세 이익과 상계 가능", formatTaxKRW(taxable), formatTaxKRW(amt)),
		}
	}
	return nil
}
