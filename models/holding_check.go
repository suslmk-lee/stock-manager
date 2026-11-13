package models

import "time"

// 배당 기록으로 본 보유 수량 확인: 받은 배당 ÷ (주당 배당 × 세후 비율) = 그 회차 배당락일에 들고 있던 수량.
// 앱이 아는 수량과 다르면 소수점 매수(모으기 등)·매도 기록이 빠졌거나, 배당을 세전 금액으로 기록한 것이다.

const (
	SignalEventKindHolding = "holding" // 알림 종류: 보유 수량 확인

	HoldingCheckOK    = "ok"
	HoldingCheckShort = "short" // 배당으로는 더 많다 — 매수 기록이 빠진 듯
	HoldingCheckOver  = "over"  // 배당으로는 더 적다 — 매도 기록이 빠졌거나 배당 일부만 기록한 듯
	HoldingCheckGross = "gross" // 세전 금액으로 기록한 듯 (앱 수량 × 주당 배당과 맞는다)
)

// HoldingCheck 는 배당 기록 하나로 본 보유 수량 확인 결과다 (저장하지 않는다).
type HoldingCheck struct {
	DividendID    uint    `json:"dividend_id"`
	AccountID     uint    `json:"account_id"`
	AccountName   string  `json:"account_name"`
	AccountBroker string  `json:"account_broker"`
	AssetID       uint    `json:"asset_id"`
	Ticker        string  `json:"ticker"`
	AssetName     string  `json:"asset_name"`
	PaidOn        string  `json:"paid_on"`   // 배당 기록 날짜 (YYYY-MM-DD)
	ExDate        string  `json:"ex_date"`   // 짝지은 회차의 배당락일
	PerShare      float64 `json:"per_share"` // 그 회차 주당 배당 (세전, 종목 통화)
	Amount        float64 `json:"amount"`    // 기록한 세후 금액 (금액 − 세금)
	Currency      string  `json:"currency"`
	TaxRate       float64 `json:"tax_rate"` // 계산에 쓴 원천징수율 (국내 ETF 처럼 범위면 가장 높은 값)
	Implied       float64 `json:"implied"`  // 배당으로 본 그때 수량 (short: 적어도, over: 많아야)
	AppQty        float64 `json:"app_qty"`  // 앱이 아는 그때(배당락 전날) 수량
	Status        string  `json:"status"`   // ok | short | over | gross
	FixedAmount   float64 `json:"fixed_amount,omitempty"` // gross: 세후로 고친 금액
	Recurring     bool    `json:"recurring"`              // 최근 회차마다 배당으로 본 수량이 늘었다 (정기 소액 매수로 보임)
	BuyDate       string  `json:"buy_date"`               // 빠진 매수를 넣을 기본 날짜 (배당락 전날)
	Notes         string  `json:"notes"`                  // 기록 메모 (세후로 고칠 때 그대로 둔다)

	RecordedAt time.Time `json:"-"` // 기록을 저장한 시각 (알림을 조금 늦게 보내려고)
}

// HoldingCheckAlert 는 보유 수량 확인 알림을 보낸 배당 기록이다 (같은 기록으로 두 번 알리지 않는다).
type HoldingCheckAlert struct {
	ID         uint      `gorm:"primaryKey"`
	DividendID uint      `gorm:"uniqueIndex;not null"`
	Status     string    `gorm:"size:10"`
	CreatedAt  time.Time
}
