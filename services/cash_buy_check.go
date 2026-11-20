package services

import (
	"math"

	"stock-manager/models"
)

// 매수를 기록하기 전에 그날 예수금이 모자라지 않은지 — 계좌 규칙(달러로 · 원화로 바로 · 통합증거금 자동 환전 ·
// 토스증권처럼 모으기만 자동 환전)대로 이 매수를 더해 그날 마감 잔액을 다시 계산한다.
// 매수만 기록하고 입금을 빠뜨리면 예수금이 마이너스가 되고, 오늘 화면의 살 계좌와 모으기 예수금 확인이 틀어진다.
// 잔액을 맞춘 적이 없는 계좌는 계산 잔액을 믿을 수 없어 확인하지 않는다.

// BuyCashRequest: 확인할 매수 (아직 기록 전)
type BuyCashRequest struct {
	AssetID  uint    `json:"asset_id"`
	Date     string  `json:"date"` // YYYY-MM-DD (비면 오늘)
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Fee      float64 `json:"fee"`
}

// BuyCashShort: 이 매수 때문에 모자라는 예수금 (그 통화)
type BuyCashShort struct {
	Currency string  `json:"currency"`
	Short    float64 `json:"short"`   // 이 매수 몫으로 모자란 금액 — 이만큼 입금하면 이 매수로 마이너스가 되지 않는다
	Balance  float64 `json:"balance"` // 이 매수 전 그날 예수금
	// 달러가 모자라고 원화가 충분하면(원화·달러 따로 계좌) 입금 대신 원화에서 환전한 기록을 제안 — 그때 내줄 원화 (그날 환율 + 지금 환전 수수료)
	ExchangeKRW float64 `json:"exchange_krw,omitempty"`
}

// BuyCashCheck: 확인 결과
type BuyCashCheck struct {
	Tracked bool           `json:"tracked"` // 예수금을 기록하고 잔액을 맞춘 계좌 (아니면 확인하지 않음)
	Shorts  []BuyCashShort `json:"shorts,omitempty"`
}

// cashAsOf: day 마감 원화·달러 예수금 — 그날까지의 기록만, 계좌 규칙대로 (extra 가 있으면 그 매수도 더한다)
func (s *CashService) cashAsOf(acc *models.Account, entries []models.CashEntry, txs []models.Transaction, divs []models.Dividend, day string, extra *models.Transaction) (krw, usd float64, err error) {
	var es []models.CashEntry
	for _, e := range entries {
		if dayString(e.Date) <= day {
			es = append(es, e)
		}
	}
	var ts []models.Transaction
	for _, t := range txs {
		if dayString(t.Date) <= day {
			ts = append(ts, t)
		}
	}
	if extra != nil {
		ts = append(ts, *extra)
	}
	var ds []models.Dividend
	for _, d := range divs {
		if dayString(d.Date) <= day {
			ds = append(ds, d)
		}
	}
	flows, err := s.flowsOf(acc, es, ts, ds)
	if err != nil {
		return 0, 0, err
	}
	for _, f := range flows {
		switch f.Currency {
		case "KRW":
			krw += f.Amount
		case "USD":
			usd += f.Amount
		}
	}
	return krw, usd, nil
}

// buyShorts: 매수 전·후 잔액으로 이 매수 때문에 모자란 통화와 금액 (원은 올림, 달러는 센트 올림)
func buyShorts(beforeKRW, beforeUSD, afterKRW, afterUSD float64) []BuyCashShort {
	var out []BuyCashShort
	for _, c := range []struct {
		ccy           string
		before, after float64
		tol, unit     float64
	}{{"KRW", beforeKRW, afterKRW, 0.5, 1}, {"USD", beforeUSD, afterUSD, 0.005, 0.01}} {
		if c.after >= -c.tol || c.after >= c.before-c.tol {
			continue
		}
		short := math.Min(-c.after, c.before-c.after) // 이 매수 몫까지만 (전부터 마이너스였던 것은 빼고)
		short = math.Ceil(short/c.unit-1e-6) * c.unit
		out = append(out, BuyCashShort{Currency: c.ccy, Short: math.Round(short/c.unit) * c.unit, Balance: math.Round(c.before/c.unit) * c.unit})
	}
	return out
}

// CheckBuy: 이 매수를 기록하면 그날 예수금이 모자라는지
func (s *CashService) CheckBuy(accountID uint, req BuyCashRequest) (*BuyCashCheck, error) {
	acc, err := s.account(accountID)
	if err != nil {
		return nil, err
	}
	if acc.NoCash {
		return &BuyCashCheck{}, nil
	}
	var entries []models.CashEntry
	if err := s.db.Where("account_id = ?", acc.ID).Find(&entries).Error; err != nil {
		return nil, err
	}
	reconciled := false
	for _, e := range entries {
		if e.Kind == models.CashAdjust {
			reconciled = true
			break
		}
	}
	if !reconciled {
		return &BuyCashCheck{}, nil
	}
	out := &BuyCashCheck{Tracked: true}
	if req.Price <= 0 || req.Quantity <= 0 || req.AssetID == 0 {
		return out, nil
	}
	date, err := parseCashDate(req.Date, s.clock())
	if err != nil {
		return nil, err
	}
	var asset models.Asset
	if err := s.db.First(&asset, req.AssetID).Error; err != nil {
		return nil, ErrCashNotFound
	}
	var txs []models.Transaction
	if err := s.db.Preload("Asset").Where("account_id = ?", acc.ID).Find(&txs).Error; err != nil {
		return nil, err
	}
	var divs []models.Dividend
	if err := s.db.Preload("Asset").Where("account_id = ? AND is_received = ?", acc.ID, true).Find(&divs).Error; err != nil {
		return nil, err
	}
	day := dayString(date)
	bk, bu, err := s.cashAsOf(acc, entries, txs, divs, day, nil)
	if err != nil {
		return nil, err
	}
	buy := models.Transaction{AccountID: acc.ID, AssetID: asset.ID, Asset: asset, Type: models.TransactionTypeBuy, Date: date, Price: req.Price, Quantity: req.Quantity, Fee: req.Fee}
	ak, au, err := s.cashAsOf(acc, entries, txs, divs, day, &buy)
	if err != nil {
		return nil, err
	}
	out.Shorts = buyShorts(bk, bu, ak, au)
	// 원화·달러 따로 계좌에서 달러만 모자라면, 그 달러는 원화를 환전해 마련했을 가능성이 크다 — 원화가 충분하면 환전 기록을 제안
	if acc.ForeignSettle == models.SettleUSD && len(out.Shorts) == 1 && out.Shorts[0].Currency == "USD" {
		if fxAt := s.fxLookup(); fxAt != nil {
			if fx := fxAt(date); fx > 0 {
				fee := 0.0
				if acc.HasFxFee() {
					fee = acc.FxFeePctAt(s.clock()) / 100
				}
				if krw := math.Ceil(out.Shorts[0].Short * fx * (1 + fee)); krw <= bk {
					out.Shorts[0].ExchangeKRW = krw
				}
			}
		}
	}
	return out, nil
}
