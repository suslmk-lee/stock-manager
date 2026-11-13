package services

import (
	"strings"
	"testing"
	"time"

	"stock-manager/models"
)

// 기록 누락 판정: 최근 회차부터 짝짓기 · 언제 샀는지 모르는 계좌는 첫 배당 기록의 회차부터
func TestMissingRecordsMatching(t *testing.T) {
	now := dsDay("2026-11-13").Add(12 * time.Hour)
	exDates := []string{"2025-11-03", "2025-12-01", "2025-12-31", "2026-02-02", "2026-03-02", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01", "2026-11-02"}
	var market []DividendEvent
	for _, d := range exDates {
		market = append(market, DividendEvent{Time: dsDay(d).Unix(), Amount: 0.5})
	}
	// 2025-12-31 회차부터 받은 날 (배당락 3~5일 뒤)
	paid := []string{"2026-01-05", "2026-02-05", "2026-03-05", "2026-04-06", "2026-05-05", "2026-06-04", "2026-07-06", "2026-08-06", "2026-09-04", "2026-10-06", "2026-11-04"}

	const (
		accUnknown   = 1 // 매수 기록 없이 보유, 기록 빠짐 없음 (예전엔 12/1 회차가 1월 기록을 가져가 한 칸씩 밀렸다)
		accGap       = 2 // 매수 기록 없이 보유, 7월 기록 하나 빠짐
		accKnown     = 3 // 2025-11-20 에 샀다 — 12/1 회차를 받았어야 한다
		accNoRecords = 4 // 매수 기록도 배당 기록도 없음 — 1년 전부터 들고 있었다고 보고 모두 묻는다
	)
	cur := map[uint]float64{accUnknown: 11, accGap: 6, accKnown: 5, accNoRecords: 2}
	txs := []AcctTxn{{AccountID: accKnown, Type: models.TransactionTypeBuy, Date: dsDay("2025-11-20"), Quantity: 5}}
	var recs []models.Dividend
	for _, acc := range []uint{accUnknown, accGap, accKnown} {
		for _, d := range paid {
			if acc == accGap && d == "2026-07-06" {
				continue
			}
			recs = append(recs, models.Dividend{AccountID: acc, Date: dsDay(d), Amount: 1, IsReceived: true})
		}
	}
	a := &divScoreAsset{
		asset:   models.Asset{ID: 7, Ticker: "JEPQ"},
		qtyAt:   QuantityAtFunc(cur, txs),
		acctIDs: []uint{accUnknown, accGap, accKnown, accNoRecords},
		market:  market,
		records: recs,
		firstTx: map[uint]time.Time{accKnown: dsDay("2025-11-20")},
	}
	got := map[uint][]string{}
	for _, m := range missingRecords(a, map[uint]models.Account{}, now) {
		got[m.AccountID] = append(got[m.AccountID], m.ExDate+":"+m.Status)
	}
	want := map[uint]string{
		accUnknown:   "",
		accGap:       "2026-07-01:missing",
		accKnown:     "2025-12-01:missing",
		accNoRecords: "2025-12-01:missing 2025-12-31:missing 2026-02-02:missing 2026-03-02:missing 2026-04-01:missing 2026-05-01:missing 2026-06-01:missing 2026-07-01:missing 2026-08-03:missing 2026-09-01:missing 2026-10-01:upcoming 2026-11-02:upcoming", // 10/1 회차는 11/30 까지 지급 기간
	}
	for acc, w := range want {
		if g := strings.Join(got[acc], " "); g != w {
			t.Errorf("계좌 %d: 누락 = %q, 기대 %q", acc, g, w)
		}
	}
}

// 국내 분기 배당: 12월 결산 배당이 4월에, 1분기 배당이 5월에 들어와도 회차마다 맞는 기록과 짝지어진다
func TestMissingRecordsKRQuarterly(t *testing.T) {
	now := dsDay("2026-11-13").Add(12 * time.Hour)
	var market []DividendEvent
	for _, d := range []string{"2025-12-29", "2026-03-30", "2026-06-29", "2026-09-29"} {
		market = append(market, DividendEvent{Time: dsDay(d).Unix(), Amount: 361})
	}
	var recs []models.Dividend
	for _, d := range []string{"2026-04-17", "2026-05-15", "2026-08-14"} {
		recs = append(recs, models.Dividend{AccountID: 1, Date: dsDay(d), Amount: 1000, IsReceived: true})
	}
	a := &divScoreAsset{
		asset:   models.Asset{ID: 9, Ticker: "005930.KS"},
		qtyAt:   QuantityAtFunc(map[uint]float64{1: 10}, []AcctTxn{{AccountID: 1, Type: models.TransactionTypeBuy, Date: dsDay("2025-01-10"), Quantity: 10}}),
		acctIDs: []uint{1},
		market:  market,
		records: recs,
		firstTx: map[uint]time.Time{1: dsDay("2025-01-10")},
	}
	var got []string
	for _, m := range missingRecords(a, map[uint]models.Account{}, now) {
		got = append(got, m.ExDate+":"+m.Status)
	}
	// 3분기(9/29) 배당은 아직 안 들어왔지만 지급 기간 안이라 '들어올 수 있음'
	if g := strings.Join(got, " "); g != "2026-09-29:upcoming" {
		t.Fatalf("누락 = %q", g)
	}
}
