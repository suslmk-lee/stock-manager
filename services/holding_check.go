package services

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 배당 기록으로 본 보유 수량 확인 — 받은 배당(세후) ÷ (주당 배당 × 세후 비율) = 그 회차 배당락일에 들고 있던 수량.
// 앱이 아는 그날 수량과 다르면 소수점 매수(모으기 등)나 매도 기록이 빠졌거나, 배당을 세전 금액으로 기록한 것이다.

const (
	holdingRecentDays = 120              // 화면·알림은 계좌마다 이 기간 안의 최근 기록 하나만 본다
	holdingAlertGrace = 20 * time.Minute // 기록하자마자 화면에서 바로 안내하므로, 그 사이 고칠 시간을 두고 알린다
)

// holdingTax: 그 계좌·통화 배당의 원천징수율 범위 (lo~hi) 와 정확한 값인지
//   - ISA·연금저축·IRP·DC: 떼지 않는다
//   - 일반 계좌 미국 종목: 15% (한국 거주자 조세조약 세율)
//   - 일반 계좌 국내 종목: 0~15.4% (국내 상장 해외 ETF 는 과세표준이 분배금보다 작을 수 있다)
//   - 그 밖의 통화: 0~20%
func holdingTax(acc models.Account, ccy string) (lo, hi float64, exact bool) {
	if acc.AccountType != "" && acc.AccountType != models.AccountTypeGeneral {
		return 0, 0, true
	}
	switch ccy {
	case "USD":
		return divTaxUS, divTaxUS, true
	case "KRW":
		return 0, divTaxKR, false
	}
	return 0, 0.2, false
}

// holdingAmountTol: 금액 반올림·증권사 세금 반올림으로 생기는 차이 (기록 통화 단위)
func holdingAmountTol(ccy string) float64 {
	switch ccy {
	case "KRW":
		return 20
	case "JPY":
		return 5
	}
	return 0.03
}

func roundMinor(v float64, ccy string) float64 {
	if ccy == "KRW" || ccy == "JPY" {
		return math.Round(v)
	}
	return math.Round(v*100) / 100
}

// judgeHolding: 세후 금액 net·주당 배당 dps 로 본 수량을 앱 수량 app 과 비교한다.
// canGross 면 세전 금액으로 기록했는지도 본다 (세율이 정해진 계좌에서 세금 칸 없이 기록한 것).
func judgeHolding(net, dps, app, lo, hi float64, canGross bool, ccy string) (status string, implied, fixed float64) {
	tol := holdingAmountTol(ccy)
	qLo, qHi := net/(dps*(1-lo)), net/(dps*(1-hi))
	tolQ := tol/(dps*(1-hi)) + 0.005*app
	if app >= qLo-tolQ && app <= qHi+tolQ {
		if qLo == qHi {
			return models.HoldingCheckOK, qLo, 0
		}
		return models.HoldingCheckOK, math.Min(math.Max(app, qLo), qHi), 0
	}
	if canGross && hi > 0 {
		if qG := net / dps; math.Abs(app-qG) <= tol/dps+0.005*app {
			return models.HoldingCheckGross, qG, roundMinor(net*(1-hi), ccy)
		}
	}
	if app < qLo {
		return models.HoldingCheckShort, qLo, 0
	}
	return models.HoldingCheckOver, qHi, 0
}

// pairRecordsByRound: 회차(배당락일, 오래된 것부터)와 기록 날짜(오래된 것부터)를 짝짓는다 — 최근 회차부터 거꾸로, 회차마다 기간 안의 가장 늦은 기록.
// 기록마다 짝지은 회차 인덱스 (-1: 없음).
func pairRecordsByRound(market []DividendEvent, recs []time.Time, window int) []int {
	out := make([]int, len(recs))
	for i := range out {
		out[i] = -1
	}
	for k := len(market) - 1; k >= 0; k-- {
		ex := time.Unix(market[k].Time, 0)
		lo, hi := ex.AddDate(0, 0, -divRecordLeadDays), ex.AddDate(0, 0, window)
		for i := len(recs) - 1; i >= 0; i-- {
			if out[i] < 0 && !recs[i].Before(lo) && !recs[i].After(hi) {
				out[i] = k
				break
			}
		}
	}
	return out
}

// holdingChecks: 이 종목의 계좌별 배당 기록 확인 (날짜순). 받은 기록만, 기록 통화가 종목 통화와 같을 때만
// (엔화 종목을 원화로 기록한 것처럼 환율이 끼면 오차가 커서 보지 않는다).
func holdingChecks(a *divScoreAsset, accounts map[uint]models.Account) map[uint][]models.HoldingCheck {
	if len(a.market) == 0 {
		return nil
	}
	ccy := tickerCurrency(a.asset.Ticker)
	window := divRecordWindowUS
	if isKRTicker(a.asset.Ticker) {
		window = divRecordWindowKR
	}
	market := append([]DividendEvent(nil), a.market...)
	sort.Slice(market, func(i, j int) bool { return market[i].Time < market[j].Time })

	byAcc := map[uint][]models.Dividend{}
	for _, r := range a.records {
		if r.IsReceived {
			byAcc[r.AccountID] = append(byAcc[r.AccountID], r)
		}
	}
	out := map[uint][]models.HoldingCheck{}
	for accID, recs := range byAcc {
		sort.SliceStable(recs, func(i, j int) bool { return recs[i].Date.Before(recs[j].Date) })
		dates := make([]time.Time, len(recs))
		for i, r := range recs {
			dates[i] = r.Date
		}
		pair := pairRecordsByRound(market, dates, window)
		paired := map[int]bool{}
		for _, k := range pair {
			if k >= 0 {
				paired[k] = true
			}
		}
		acc := accounts[accID]
		lo, hi, exact := holdingTax(acc, ccy)

		var list []models.HoldingCheck
		var raw []float64 // 회차마다 배당으로 본 수량 (가장 높은 세율 기준) — 정기 소액 매수 판단용
		for i, r := range recs {
			net := r.Amount - r.Tax
			if pair[i] < 0 || net <= 0 || !strings.EqualFold(strings.TrimSpace(r.Currency), ccy) {
				continue
			}
			judge := func(k int) models.HoldingCheck {
				e := market[k]
				ex := time.Unix(e.Time, 0)
				app := a.qtyAt(accID, ex.AddDate(0, 0, -1))
				st, implied, fixed := judgeHolding(net, e.Amount, app, lo, hi, exact && r.Tax == 0, ccy)
				return models.HoldingCheck{
					DividendID: r.ID, AccountID: accID, AccountName: acc.Name, AccountBroker: acc.Broker,
					AssetID: a.asset.ID, Ticker: a.asset.Ticker, AssetName: a.asset.Name,
					PaidOn: r.Date.In(kst).Format(dateLayout), ExDate: ex.In(kst).Format(dateLayout), PerShare: e.Amount,
					Amount: net, Currency: ccy, TaxRate: hi, Implied: implied, AppQty: app, Status: st, FixedAmount: fixed,
					BuyDate: ex.AddDate(0, 0, -1).In(kst).Format(dateLayout), Notes: r.Notes, RecordedAt: r.CreatedAt,
				}
			}
			if market[pair[i]].Amount <= 0 {
				continue
			}
			c := judge(pair[i])
			if c.Status != models.HoldingCheckOK {
				// 짝 없는 다른 회차의 배당이었을 수도 있다 (국내 12월 결산 배당이 1분기 배당락 뒤 4월에 들어올 때)
				for k := range market {
					if k == pair[i] || paired[k] || market[k].Amount <= 0 {
						continue
					}
					ex := time.Unix(market[k].Time, 0)
					if r.Date.Before(ex.AddDate(0, 0, -divRecordLeadDays)) || r.Date.After(ex.AddDate(0, 0, window)) {
						continue
					}
					if alt := judge(k); alt.Status == models.HoldingCheckOK {
						c = alt
						break
					}
				}
			}
			list = append(list, c)
			raw = append(raw, net/(c.PerShare*(1-hi)))
		}
		// 정기 소액 매수로 보임: 앱보다 많고, 최근 세 회차 동안 배당으로 본 수량이 계속 늘었다
		if n := len(list); n >= 3 && list[n-1].Status == models.HoldingCheckShort {
			list[n-1].Recurring = raw[n-1] > raw[n-2]*1.002 && raw[n-2] > raw[n-3]*1.002
		}
		if len(list) > 0 {
			out[accID] = list
		}
	}
	return out
}

// latestHoldingChecks: 계좌마다 최근(120일 안) 기록 하나의 확인 — 지금 보유 수량을 가늠한다 (계좌 순)
func latestHoldingChecks(a *divScoreAsset, accounts map[uint]models.Account, now time.Time) []models.HoldingCheck {
	var out []models.HoldingCheck
	for _, list := range holdingChecks(a, accounts) {
		c := list[len(list)-1]
		if paid, err := time.ParseInLocation(dateLayout, c.PaidOn, kst); err == nil && now.Sub(paid) <= holdingRecentDays*24*time.Hour {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AccountID < out[j].AccountID })
	return out
}

func (s *DividendScoreService) accountMap() (map[uint]models.Account, error) {
	var accounts []models.Account
	if err := s.db.Unscoped().Find(&accounts).Error; err != nil {
		return nil, err
	}
	m := make(map[uint]models.Account, len(accounts))
	for _, a := range accounts {
		m[a.ID] = a
	}
	return m, nil
}

// CheckDividend: 배당 기록 하나로 본 보유 수량 확인 — 그 계좌의 이 종목 최근 기록이고 앱 수량과 맞지 않을 때만 돌려준다 (기록을 저장한 직후 안내용).
// 지난 기록을 채우거나 고칠 때는 묻지 않는다 (여러 번 산 것을 한 번에 넣은 경우 예전 회차는 맞지 않는 게 당연하다).
func (s *DividendScoreService) CheckDividend(id uint) (*models.HoldingCheck, error) {
	var d models.Dividend
	if err := s.db.First(&d, id).Error; err != nil {
		return nil, err
	}
	assets, err := s.loadAssetsOf(s.clock(), false, d.AssetID)
	if err != nil {
		return nil, err
	}
	a := assets[d.AssetID]
	if a == nil {
		return nil, nil
	}
	accounts, err := s.accountMap()
	if err != nil {
		return nil, err
	}
	list := holdingChecks(a, accounts)[d.AccountID]
	if n := len(list); n > 0 && list[n-1].DividendID == id && list[n-1].Status != models.HoldingCheckOK {
		c := list[n-1]
		return &c, nil
	}
	return nil, nil
}

// HoldingAlerts: 계좌·종목마다 최근 배당 기록으로 본 수량이 앱과 다르면 알림을 만든다
// (기록 하나에 한 번, 저장하고 20분 지난 기록만 — 신호 점검 때 함께 돈다). enabled 가 false 면 읽음으로 남긴다.
func (s *DividendScoreService) HoldingAlerts(enabled bool, now time.Time) ([]models.SignalEvent, error) {
	assets, err := s.loadAssets(now.AddDate(-1, 0, 0), false)
	if err != nil {
		return nil, err
	}
	accounts, err := s.accountMap()
	if err != nil {
		return nil, err
	}
	ids := make([]uint, 0, len(assets))
	for id := range assets {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	var created []models.SignalEvent
	for _, id := range ids {
		for _, c := range latestHoldingChecks(assets[id], accounts, now) {
			if c.Status == models.HoldingCheckOK || now.Sub(c.RecordedAt) < holdingAlertGrace {
				continue
			}
			ev := models.SignalEvent{
				AssetID: c.AssetID, Ticker: c.Ticker, Name: c.AssetName, ToAction: "HOLDING",
				Message: HoldingCheckMessage(c), Currency: c.Currency, CreatedAt: now, Kind: models.SignalEventKindHolding,
			}
			if !enabled {
				t := now
				ev.ReadAt = &t
			}
			made := false
			err := s.db.Transaction(func(tx *gorm.DB) error {
				res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&models.HoldingCheckAlert{DividendID: c.DividendID, Status: c.Status})
				if res.Error != nil || res.RowsAffected == 0 {
					return res.Error // 이미 알린 기록 (앱과 서버가 함께 돌아도 한 번만)
				}
				made = true
				return tx.Create(&ev).Error
			})
			if err != nil {
				return created, err
			}
			if made {
				created = append(created, ev)
			}
		}
	}
	return created, nil
}

// holdingAccountLabel: '토스증권'·'토스 달러'처럼 이름에 증권사가 보이면 이름만, 아니면 '카카오증권 종합계좌'
func holdingAccountLabel(name, broker string) string {
	core := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(broker, "증권"), "투자"), "페이")
	if broker == "" || (core != "" && strings.Contains(name, core)) {
		return name
	}
	return broker + " " + name
}

func holdingQty(q float64) string {
	return strings.TrimSuffix(fmtQty(math.Round(q*100)/100), "주")
}

func holdingMoney(v float64, ccy string) string {
	if ccy == "USD" || ccy == "KRW" {
		return fmtMoney(v, ccy)
	}
	return fmt.Sprintf("%s %.2f", ccy, v)
}

// HoldingCheckMessage: 알림 문구
func HoldingCheckMessage(c models.HoldingCheck) string {
	acc := holdingAccountLabel(c.AccountName, c.AccountBroker)
	paid := c.PaidOn
	if t, err := time.Parse(dateLayout, c.PaidOn); err == nil {
		paid = fmt.Sprintf("%d/%d", int(t.Month()), t.Day())
	}
	switch c.Status {
	case models.HoldingCheckShort:
		msg := fmt.Sprintf("%s · %s 배당으로 보면 약 %s주인데 앱은 %s주 — 매수 %s주가 빠진 것 같아요", acc, paid, holdingQty(c.Implied), holdingQty(c.AppQty), holdingQty(c.Implied-c.AppQty))
		if c.Recurring {
			msg += " (매달 늘고 있어 모으기로 보여요)"
		}
		return msg
	case models.HoldingCheckOver:
		return fmt.Sprintf("%s · %s 배당으로 보면 약 %s주인데 앱은 %s주 — 매수를 실제보다 이른 날짜로 넣었거나, 매도 기록이 빠졌거나, 배당을 일부만 기록한 것 같아요", acc, paid, holdingQty(c.Implied), holdingQty(c.AppQty))
	case models.HoldingCheckGross:
		return fmt.Sprintf("%s · %s 배당 %s은 세전 금액 같아요 — 세후 약 %s", acc, paid, holdingMoney(c.Amount, c.Currency), holdingMoney(c.FixedAmount, c.Currency))
	}
	return ""
}
