package services

import (
	"fmt"
	"math"
	"time"

	"stock-manager/models"
)

// 펀드 모으기 (토스 펀드 모으기 등) — 펀드는 거래소 시세가 없어서 회차마다 그날 종가 대신 앱 기준가로 좌수를 센다.
// 앱 기준가는 처음 1,000원, 평가금액 맞추기(증권사 앱의 평가금액 ÷ 앱 좌수)로 바로잡힌다 (퇴직연금 펀드와 같은 방식).
// 영업일은 국내 거래일로 보고, 계획한 날이 공휴일이면 다음 영업일에 산다.

const fundCalendarTicker = "069500.KS" // 국내 영업일 판단용 (KODEX 200 이 거래된 날)

// SetFunds: 펀드 기준가 (펀드 모으기에 쓴다)
func (s *AccumulationService) SetFunds(f *FundService) { s.funds = f }

// fundRules: 펀드면 원화 금액·조건 없음(항상)·좌수 단위로 맞춘다 (기준가가 실시간이 아니라 조건 판단이 맞지 않는다)
func (s *AccumulationService) fundRules(req *AccumulationPlanRequest, asset models.Asset) error {
	if !IsFundTicker(asset.Ticker) {
		return nil
	}
	if s.funds == nil {
		return planInputErr("펀드 모으기를 쓸 수 없습니다")
	}
	if req.AmountCurrency != "KRW" {
		return planInputErr("펀드는 원화로 모읍니다")
	}
	req.Condition, req.ConditionValue = models.PlanConditionAlways, 0
	req.QtyStep = contribQtyStep
	return nil
}

// fundUnits: 금액으로 그날 앱 기준가에 살 수 있는 좌수
func (s *AccumulationService) fundUnits(assetID uint, amount float64, day string) float64 {
	nav := s.funds.BuyNav(assetID, day)
	return math.Floor(amount/nav/contribQtyStep) * contribQtyStep
}

// syncBonus: 지원금(이벤트로 받은 돈)을 그 계좌 예수금에 기타 수입(이자)으로 남긴다 — 그 돈으로 산 몫 때문에 예수금이 줄지 않게.
// 금액이 바뀌면 고치고, 0 이면 지운다. day: 지원금을 받은 날 (처음 시작한 날, 없으면 오늘).
func (s *AccumulationService) syncBonus(plan *models.AccumulationPlan, bonus float64, day time.Time, assetName string) error {
	var acc models.Account
	noCash := s.db.First(&acc, plan.AccountID).Error == nil && acc.NoCash
	entryBonus := bonus
	if noCash {
		entryBonus = 0 // 예수금 기록 안 하는 계좌 (토스뱅크 등): 예수금 기록 없이 금액만 남긴다
	}
	if plan.BonusEntryID != nil {
		var e models.CashEntry
		if err := s.db.First(&e, *plan.BonusEntryID).Error; err != nil {
			plan.BonusEntryID = nil // 예수금 화면에서 이미 지운 경우
		} else if entryBonus <= 0 {
			if err := s.db.Delete(&models.CashEntry{}, e.ID).Error; err != nil {
				return err
			}
			plan.BonusEntryID = nil
		} else if math.Abs(e.Amount-entryBonus) > 1e-9 || !e.Date.Equal(day) {
			if err := s.db.Model(&models.CashEntry{}).Where("id = ?", e.ID).Updates(map[string]any{"amount": entryBonus, "date": day}).Error; err != nil {
				return err
			}
		}
	}
	if entryBonus > 0 && plan.BonusEntryID == nil {
		e := models.CashEntry{AccountID: plan.AccountID, Currency: plan.AmountCurrency, Date: day, Kind: models.CashInterest, Amount: entryBonus,
			Notes: fmt.Sprintf("모으기 지원금 (%s)", assetName)}
		if err := s.db.Create(&e).Error; err != nil {
			return err
		}
		plan.BonusEntryID = &e.ID
	}
	plan.OpeningBonus = math.Max(bonus, 0)
	return s.db.Model(&models.AccumulationPlan{}).Where("id = ?", plan.ID).Updates(map[string]any{"opening_bonus": plan.OpeningBonus, "bonus_entry_id": plan.BonusEntryID}).Error
}

// bonusDay: 지원금을 받은 날 — 처음 시작한 날, 없으면 오늘
func bonusDay(startedOn string, now time.Time) time.Time {
	if d, ok := parseDay(startedOn); ok {
		return d
	}
	d, _ := parseDay(todayKST(now))
	return d
}

// krTradingDays: from 이후 국내 영업일 (KODEX 200 이 거래된 날). 시세를 못 받으면 평일로 본다.
func (s *AccumulationService) krTradingDays(from string, now time.Time) []string {
	rng := "3mo"
	if f, ok := parseDay(from); ok && now.Sub(f) > 80*24*time.Hour {
		rng = "1y"
	}
	var days []string
	if h, err := s.getHistory(fundCalendarTicker, rng); err == nil && h != nil {
		for _, b := range sessionBars(h) {
			if b.day >= from {
				days = append(days, b.day)
			}
		}
		return days
	}
	f, ok := parseDay(from)
	if !ok {
		return nil
	}
	today := todayKST(now)
	for d := f; dayString(d) <= today; d = d.AddDate(0, 0, 1) {
		if wd := d.Weekday(); wd != time.Saturday && wd != time.Sunday {
			days = append(days, dayString(d))
		}
	}
	return days
}

// processFundPlan: 영업일마다 계획한 날(공휴일이면 다음 영업일)에 앱 기준가로 금액만큼 산다
func (s *AccumulationService) processFundPlan(p *models.AccumulationPlan, days []string, now time.Time, res *AccumulationRunResult) {
	from := firstPending(p)
	open := map[string]bool{}
	last := ""
	for _, d := range days {
		if d >= from && sessionClosed(p.Asset.Ticker, d, now) {
			open[d] = true
			if d > last {
				last = d
			}
		}
	}
	start, ok := parseDay(from)
	if !ok || last == "" {
		return
	}
	pending := false // 계획한 날이 공휴일이면 다음 영업일에 산다
	processed := ""
	for d := start; dayString(d) <= last; d = d.AddDate(0, 0, 1) {
		ds := dayString(d)
		if scheduledOn(p, d) {
			pending = true
		}
		if !open[ds] {
			continue
		}
		if !pending {
			processed = ds
			continue
		}
		pending = false
		qty := s.fundUnits(p.AssetID, p.Amount, ds)
		if qty <= 0 {
			res.Skipped++
			processed = ds
			continue
		}
		_, err := s.txs.CreateTransaction(CreateTransactionRequest{
			AccountID: p.AccountID, AssetID: p.AssetID, Type: models.TransactionTypeBuy,
			Date: d, Price: p.Amount / qty, Quantity: qty, Notes: accumulationNote, PlanID: &p.ID,
		})
		if err != nil {
			if !isUniqueViolation(err) {
				res.Errors = append(res.Errors, fmt.Sprintf("%s %s: %v", p.Asset.Name, ds, err))
				break
			}
		} else {
			res.Created++
		}
		processed = ds
	}
	if processed != "" && processed > p.ProcessedThrough {
		s.db.Model(&models.AccumulationPlan{}).Where("id = ?", p.ID).Update("processed_through", processed)
		p.ProcessedThrough = processed
	}
}

// fundPriceDate: 펀드 평가금액을 마지막으로 맞춘 날 (없으면 빈칸)
func (s *AccumulationService) fundPriceDate(assetID uint) string {
	var fp models.FundPrice
	if err := s.db.Where("asset_id = ?", assetID).Order("date DESC").Limit(1).Find(&fp).Error; err == nil && fp.ID != 0 {
		return fp.Date
	}
	return ""
}
