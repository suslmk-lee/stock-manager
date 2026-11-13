package services

import (
	"errors"
	"testing"

	"stock-manager/models"
)

// 시트 티커 맞추기: 거래소 꼬리표(.T 도쿄 등)는 떼고도 비교, 한국 6자리는 완전 일치, 미국 종류주(BRK.B)는 꼬리표 그대로
func TestSheetTickerMatches(t *testing.T) {
	cases := []struct {
		row, asset string
		want       bool
	}{
		{"2621", "2621.T", true},   // 시트에 꼬리표 없이 적은 도쿄 ETF
		{"2621.T", "2621.T", true}, // 그대로
		{"2621.t", "2621.T", true},
		{"2622", "2621.T", false},
		{"005930", "005930.KS", true},
		{"005930.KS", "005930.KS", true},
		{"005935", "005930.KS", false},
		{"0700", "0700.HK", true},
		{"SCHD", "SCHD", true},
		{"BRK.B", "BRK.B", true},
		{"BRK.A", "BRK.B", false}, // 종류가 다른 주식은 다른 줄
	}
	for _, c := range cases {
		if got := tickerMatches(c.row, buildTickerMatchValues(c.asset)); got != c.want {
			t.Errorf("시트 %q ↔ 종목 %q = %v, want %v", c.row, c.asset, got, c.want)
		}
	}
}

// 시트에 그 종목 줄이 없으면 ErrSheetRowNotFound — 배당 기록은 막지 않고 안내만 하는 경우와 구분한다
func TestSheetRowNotFound(t *testing.T) {
	snap := &sheetSnapshot{
		Rows: [][]interface{}{
			{"증권사", "계좌", "티커", "1월", "2월"},
			{"NH투자증권", "일반계좌", "SCHD", "0", "0"},
		},
		BrokerCol: 0, AccountCol: 1, TargetCol: -1, TickerCol: 2,
		MonthCols: map[int]int{1: 3, 2: 4},
	}
	acc := models.Account{Name: "일반계좌", Broker: "NH투자증권"}
	if _, err := snap.findRowCandidate(acc, models.Asset{Ticker: "2621.T"}, 4); !errors.Is(err, ErrSheetRowNotFound) {
		t.Fatalf("줄이 없으면 ErrSheetRowNotFound 여야 한다: %v", err)
	}
	snap.Rows = append(snap.Rows, []interface{}{"NH투자증권", "일반계좌", "2621", "0", "0"})
	if c, err := snap.findRowCandidate(acc, models.Asset{Ticker: "2621.T"}, 4); err != nil || c.RowIndex != 3 {
		t.Fatalf("꼬리표 없이 적은 줄을 찾아야 한다: %+v err %v", c, err)
	}
}
