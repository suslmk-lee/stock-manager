package models

import "time"

// 직접 환전 수수료 — 원화·외화 따로 계좌에서 원화예수금을 외화예수금(달러)으로 바꿀 때 (또는 반대로).
// 수수료 = 기본 수수료 × (1 − 우대율). 정규 시간(평일 09:00~15:30, KST)과 그 외 시간(밤·주말)의 우대율이 다르다.
// 공휴일은 모른다 (평일이면 정규 시간으로 본다).

// FxPreset: 증권사 기준 (기본 수수료 %, 정규 시간 우대 %, 그 외 우대 %)
type FxPreset struct {
	SpreadPct  float64
	DayDiscPct float64
	OffDiscPct float64
}

// FxPresets: 알려진 증권사 기준 — 계좌의 환전 수수료 칸이 생길 때 비어 있는 계좌에 한 번 넣고, 계좌 화면에서 고칠 수 있다.
// 토스증권: 기본 1%, 정규 시간 95% 우대(0.05%), 그 외 50% 우대(0.5%)
var FxPresets = map[string]FxPreset{
	"토스증권": {SpreadPct: 1, DayDiscPct: 95, OffDiscPct: 50},
}

var kst = time.FixedZone("KST", 9*60*60)

// FxDayHours: 그 시각이 정규 환전 시간(평일 09:00~15:30, KST)인지
func FxDayHours(t time.Time) bool {
	k := t.In(kst)
	if wd := k.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return false
	}
	m := k.Hour()*60 + k.Minute()
	return m >= 9*60 && m < 15*60+30
}

// HasFxFee: 직접 환전 수수료를 아는 계좌인지 (원화·외화 따로 + 기본 수수료가 있음)
func (a Account) HasFxFee() bool { return a.ForeignSettle == SettleUSD && a.FxSpreadPct > 0 }

// FxFeePctDay / FxFeePctOff: 정규 시간 / 그 외 시간 수수료 (%)
func (a Account) FxFeePctDay() float64 { return a.FxSpreadPct * (1 - a.FxDayDiscPct/100) }
func (a Account) FxFeePctOff() float64 { return a.FxSpreadPct * (1 - a.FxOffDiscPct/100) }

// FxFeePctAt: 그 시각에 직접 환전하면 붙는 수수료 (%)
func (a Account) FxFeePctAt(t time.Time) float64 {
	if FxDayHours(t) {
		return a.FxFeePctDay()
	}
	return a.FxFeePctOff()
}
