package services

import (
	"fmt"
	"testing"
	"time"

	"stock-manager/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func kstDate(y, m, d int) time.Time { return time.Date(y, time.Month(m), d, 12, 0, 0, 0, kst) }

// bar builds a monthly bar at exchange-local midnight of the 1st of (y, m) for the given offset.
func bar(y, m int, offset int64, close float64) PricePoint {
	local := time.Date(y, time.Month(m), 1, 0, 0, 0, 0, time.UTC)
	return PricePoint{Time: local.Unix() - offset, Close: close}
}

func krPrices(t *testing.T, closes map[monthKey]float64) *monthlyPrices {
	t.Helper()
	h := &PriceHistory{Currency: "KRW", GmtOffset: 9 * 3600}
	for k, v := range closes {
		h.Points = append(h.Points, bar(k.Year, k.Month, 9*3600, v))
	}
	return buildMonthlyPrices("005930.KS", h)
}

func TestEstimateMonthlySummaries(t *testing.T) {
	jan, feb, mar := monthKey{2026, 1}, monthKey{2026, 2}, monthKey{2026, 3}
	prices := map[string]*monthlyPrices{
		"AAA.KS": krPrices(t, map[monthKey]float64{
			{2025, 12}: 100, jan: 110, feb: 120, mar: 130,
		}),
	}

	tests := []struct {
		name      string
		months    []monthKey
		positions []estPosition
		txns      []estTxn
		prices    map[string]*monthlyPrices
		want      map[monthKey]float64 // month -> total value (account 1)
		wantCount map[monthKey]int64
	}{
		{
			name:      "backward replay with a buy and a sell after month start",
			months:    []monthKey{feb},
			positions: []estPosition{{1, 1, "AAA.KS", 10}},
			txns: []estTxn{
				{1, 1, models.TransactionTypeBuy, kstDate(2026, 2, 10), 5},  // after Feb start: undo
				{1, 1, models.TransactionTypeSell, kstDate(2026, 2, 20), 2}, // after Feb start: redo
				{1, 1, models.TransactionTypeBuy, kstDate(2026, 1, 5), 4},   // before: kept
			},
			prices:    prices,
			want:      map[monthKey]float64{feb: (10 - 5 + 2) * 110},
			wantCount: map[monthKey]int64{feb: 1},
		},
		{
			name:      "seeded holding without transactions is held throughout",
			months:    []monthKey{jan, feb, mar},
			positions: []estPosition{{1, 1, "AAA.KS", 3}},
			prices:    prices,
			want:      map[monthKey]float64{jan: 3 * 100, feb: 3 * 110, mar: 3 * 120},
		},
		{
			name:      "fully sold position only in transactions",
			months:    []monthKey{jan, feb, mar},
			positions: []estPosition{{1, 1, "AAA.KS", 0}},
			txns: []estTxn{
				{1, 1, models.TransactionTypeBuy, kstDate(2025, 12, 15), 8},
				{1, 1, models.TransactionTypeSell, kstDate(2026, 2, 15), 8},
			},
			prices: prices,
			// Jan: held 8 at start; Feb: 8 at start (sold mid Feb); Mar: 0 -> skipped
			want: map[monthKey]float64{jan: 8 * 100, feb: 8 * 110},
		},
		{
			name:      "position bought during month is absent at its start",
			months:    []monthKey{feb},
			positions: []estPosition{{1, 1, "AAA.KS", 5}},
			txns:      []estTxn{{1, 1, models.TransactionTypeBuy, kstDate(2026, 2, 3), 5}},
			prices:    prices,
			want:      map[monthKey]float64{},
		},
		{
			name:      "no previous bar falls back to the month's own bar",
			months:    []monthKey{{2026, 1}},
			positions: []estPosition{{1, 1, "NEW.KS", 2}},
			prices: map[string]*monthlyPrices{
				"NEW.KS": krPrices(t, map[monthKey]float64{{2026, 1}: 50, {2026, 2}: 60}),
			},
			want: map[monthKey]float64{{2026, 1}: 2 * 50},
		},
		{
			name:      "no bar at all skips the position",
			months:    []monthKey{{2025, 6}},
			positions: []estPosition{{1, 1, "NEW.KS", 2}},
			prices: map[string]*monthlyPrices{
				"NEW.KS": krPrices(t, map[monthKey]float64{{2026, 1}: 50}),
			},
			want: map[monthKey]float64{},
		},
		{
			name:      "missing price history skips the position",
			months:    []monthKey{feb},
			positions: []estPosition{{1, 1, "NOPE", 2}},
			prices:    prices,
			want:      map[monthKey]float64{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rows := estimateMonthlySummaries(tc.months, tc.positions, tc.txns, tc.prices)
			got := map[monthKey]float64{}
			for _, r := range rows {
				if !r.Estimated {
					t.Errorf("row %+v not marked estimated", r)
				}
				got[monthKey{r.Year, r.Month}] += r.TotalValue
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
			for k, v := range tc.want {
				if d := got[k] - v; d > 1e-6 || d < -1e-6 {
					t.Errorf("month %v: got %v want %v", k, got[k], v)
				}
			}
			for k, c := range tc.wantCount {
				for _, r := range rows {
					if (monthKey{r.Year, r.Month}) == k && r.AssetCount != c {
						t.Errorf("month %v asset_count %d want %d", k, r.AssetCount, c)
					}
				}
			}
		})
	}
}

func TestMonthKeyGmtOffset(t *testing.T) {
	// KS bar for April 2026 begins at 2026-04-01 00:00 KST = 2026-03-31 15:00 UTC.
	ts := time.Date(2026, 3, 31, 15, 0, 0, 0, time.UTC).Unix()
	if got := monthKeyFor(ts, 9*3600); got != (monthKey{2026, 4}) {
		t.Errorf("with offset: got %v want 2026-04", got)
	}
	if got := monthKeyFor(ts, 0); got != (monthKey{2026, 3}) {
		t.Errorf("raw UTC would be March, got %v", got)
	}
	// US bar: New York midnight Apr 1 (EDT, -4h) = 04:00 UTC Apr 1.
	us := time.Date(2026, 4, 1, 4, 0, 0, 0, time.UTC).Unix()
	if got := monthKeyFor(us, -4*3600); got != (monthKey{2026, 4}) {
		t.Errorf("US: got %v", got)
	}
}

func TestCurrencyFor(t *testing.T) {
	cases := map[[2]string]string{
		{"005930.KS", ""}: "KRW", {"035720.kq", ""}: "KRW", {"AAPL", ""}: "USD", {"AAPL", "EUR"}: "EUR",
	}
	for in, want := range cases {
		if got := currencyFor(in[0], in[1]); got != want {
			t.Errorf("%v: got %s want %s", in, got, want)
		}
	}
}

func TestWindowMonths(t *testing.T) {
	now := time.Date(2026, 1, 31, 16, 0, 0, 0, time.UTC) // Feb 1 01:00 KST
	got := windowMonths(now, 3)
	want := []monthKey{{2025, 12}, {2026, 1}, {2026, 2}}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
}

func newTestSnapshotService(t *testing.T, hist map[string]*PriceHistory) *PortfolioSnapshotService {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.Transaction{}, &models.PortfolioSnapshot{}); err != nil {
		t.Fatal(err)
	}
	s := NewPortfolioSnapshotService(db, nil)
	s.fetchHistory = func(ticker string) (*PriceHistory, error) {
		if h, ok := hist[ticker]; ok {
			return h, nil
		}
		return nil, fmt.Errorf("no history")
	}
	return s
}

func TestGetMonthlySummaryRealMonthNotEstimated(t *testing.T) {
	hist := map[string]*PriceHistory{
		"AAA.KS": {Currency: "KRW", GmtOffset: 9 * 3600, Points: []PricePoint{
			bar(2026, 1, 9*3600, 100), bar(2026, 2, 9*3600, 110), bar(2026, 3, 9*3600, 120), bar(2026, 4, 9*3600, 130),
		}},
	}
	s := newTestSnapshotService(t, hist)
	acc := models.Account{Name: "a"}
	if err := s.db.Omit("Holdings", "Transactions").Create(&acc).Error; err != nil {
		t.Skipf("cannot create account in test db: %v", err)
	}
	asset := models.Asset{Ticker: "AAA.KS", Name: "A", Type: models.AssetTypeStock}
	s.db.Create(&asset)
	s.db.Create(&models.Holding{AccountID: acc.ID, AssetID: asset.ID, Quantity: 4})
	// Real snapshot for March only.
	s.db.Create(&models.PortfolioSnapshot{AccountID: acc.ID, AssetID: asset.ID, Year: 2026, Month: 3, Quantity: 4, Price: 999, MarketValue: 3996, Currency: "KRW"})

	now := time.Date(2026, 4, 15, 0, 0, 0, 0, kst)
	rows, err := s.getMonthlySummary(3, now) // Feb, Mar, Apr
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows=%+v", rows)
	}
	for _, r := range rows {
		switch r.Month {
		case 3:
			if r.Estimated || r.TotalValue != 3996 {
				t.Errorf("March must be real: %+v", r)
			}
		case 2:
			if !r.Estimated || r.TotalValue != 4*100 {
				t.Errorf("Feb estimate: %+v", r)
			}
		case 4:
			if !r.Estimated || r.TotalValue != 4*120 {
				t.Errorf("Apr estimate: %+v", r)
			}
		}
	}

	// Second call is served from the history cache.
	s.fetchHistory = func(string) (*PriceHistory, error) { return nil, fmt.Errorf("should be cached") }
	if _, err := s.getMonthlySummary(3, now); err != nil {
		t.Fatal(err)
	}
}
