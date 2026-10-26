package services

import (
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"stock-manager/models"
)

// kst is the timezone used for month boundaries.
var kst = time.FixedZone("KST", 9*3600)

const historyCacheTTL = 6 * time.Hour

type monthKey struct {
	Year  int
	Month int
}

func (m monthKey) index() int { return m.Year*12 + m.Month - 1 }

func (m monthKey) less(o monthKey) bool { return m.index() < o.index() }

func (m monthKey) start() time.Time {
	return time.Date(m.Year, time.Month(m.Month), 1, 0, 0, 0, 0, kst)
}

// windowMonths returns the `months` calendar months (KST) ending with now's month, oldest first.
func windowMonths(now time.Time, months int) []monthKey {
	n := now.In(kst)
	cur := monthKey{n.Year(), int(n.Month())}
	out := make([]monthKey, 0, months)
	for i := months - 1; i >= 0; i-- {
		idx := cur.index() - i
		out = append(out, monthKey{idx / 12, idx%12 + 1})
	}
	return out
}

// estPosition is an (account, asset) pair with its current quantity.
type estPosition struct {
	AccountID  uint
	AssetID    uint
	Ticker     string
	CurrentQty float64
}

// estTxn is a trimmed-down transaction used for backward replay.
type estTxn struct {
	AccountID uint
	AssetID   uint
	Type      models.TransactionType
	Date      time.Time
	Quantity  float64
}

// monthlyPrices holds close prices keyed by month of the exchange-local bar start.
type monthlyPrices struct {
	Currency string
	keys     []monthKey // sorted ascending
	prices   map[monthKey]float64
}

// monthKeyFor maps a bar timestamp to a month using the exchange gmtoffset.
func monthKeyFor(ts, gmtOffset int64) monthKey {
	t := time.Unix(ts+gmtOffset, 0).UTC()
	return monthKey{t.Year(), int(t.Month())}
}

func currencyFor(ticker, reported string) string {
	if reported != "" {
		return reported
	}
	u := strings.ToUpper(ticker)
	if strings.HasSuffix(u, ".KS") || strings.HasSuffix(u, ".KQ") {
		return "KRW"
	}
	return "USD"
}

// buildMonthlyPrices converts a monthly price history into month-keyed closes.
func buildMonthlyPrices(ticker string, h *PriceHistory) *monthlyPrices {
	mp := &monthlyPrices{Currency: currencyFor(ticker, h.Currency), prices: map[monthKey]float64{}}
	pts := append([]PricePoint(nil), h.Points...)
	sort.Slice(pts, func(i, j int) bool { return pts[i].Time < pts[j].Time })
	for _, p := range pts {
		if p.Close <= 0 {
			continue
		}
		mp.prices[monthKeyFor(p.Time, h.GmtOffset)] = p.Close // later bar of same month wins
	}
	for k := range mp.prices {
		mp.keys = append(mp.keys, k)
	}
	sort.Slice(mp.keys, func(i, j int) bool { return mp.keys[i].less(mp.keys[j]) })
	return mp
}

// priceFor returns the close of the latest bar before month m; falls back to m's own bar.
func (mp *monthlyPrices) priceFor(m monthKey) (float64, bool) {
	for i := len(mp.keys) - 1; i >= 0; i-- {
		if mp.keys[i].less(m) {
			return mp.prices[mp.keys[i]], true
		}
	}
	if p, ok := mp.prices[m]; ok {
		return p, true
	}
	return 0, false
}

// estimateMonthlySummaries is the pure calculation: no DB, no network.
// For each month in `months` it replays transactions backward from the current quantity
// to get the quantity at the start of the month and values it at the previous month's close.
func estimateMonthlySummaries(months []monthKey, positions []estPosition, txns []estTxn, prices map[string]*monthlyPrices) []MonthlySnapshotSummary {
	type pairKey struct{ acc, asset uint }
	txByPair := map[pairKey][]estTxn{}
	for _, t := range txns {
		k := pairKey{t.AccountID, t.AssetID}
		txByPair[k] = append(txByPair[k], t)
	}

	type aggKey struct {
		m        monthKey
		acc      uint
		currency string
	}
	agg := map[aggKey]*MonthlySnapshotSummary{}

	for _, m := range months {
		start := m.start()
		for _, p := range positions {
			mp := prices[p.Ticker]
			if mp == nil {
				continue
			}
			qty := p.CurrentQty
			for _, t := range txByPair[pairKey{p.AccountID, p.AssetID}] {
				if t.Date.Before(start) {
					continue
				}
				switch t.Type {
				case models.TransactionTypeBuy:
					qty -= t.Quantity
				case models.TransactionTypeSell:
					qty += t.Quantity
				}
			}
			if qty < 1e-9 {
				continue
			}
			price, ok := mp.priceFor(m)
			if !ok {
				continue
			}
			k := aggKey{m, p.AccountID, mp.Currency}
			row := agg[k]
			if row == nil {
				row = &MonthlySnapshotSummary{Year: m.Year, Month: m.Month, AccountID: p.AccountID, Currency: mp.Currency, Estimated: true}
				agg[k] = row
			}
			row.TotalValue += qty * price
			row.AssetCount++
		}
	}

	out := make([]MonthlySnapshotSummary, 0, len(agg))
	for _, r := range agg {
		out = append(out, *r)
	}
	sortSummaries(out)
	return out
}

func sortSummaries(rows []MonthlySnapshotSummary) {
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.Year != b.Year {
			return a.Year < b.Year
		}
		if a.Month != b.Month {
			return a.Month < b.Month
		}
		if a.AccountID != b.AccountID {
			return a.AccountID < b.AccountID
		}
		return a.Currency < b.Currency
	})
}

// ---- history cache + concurrent fetch ----

type historyCacheEntry struct {
	prices    *monthlyPrices
	fetchedAt time.Time
}

type historyCache struct {
	mu      sync.Mutex
	entries map[string]historyCacheEntry
}

func (c *historyCache) get(ticker string, now time.Time) (*monthlyPrices, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[ticker]
	if !ok || now.Sub(e.fetchedAt) > historyCacheTTL {
		return nil, false
	}
	return e.prices, true
}

func (c *historyCache) set(ticker string, mp *monthlyPrices, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[string]historyCacheEntry{}
	}
	c.entries[ticker] = historyCacheEntry{mp, now}
}

// loadMonthlyPrices fetches (or reuses cached) monthly price histories, at most 5 concurrently.
// Failing tickers are logged once and omitted.
func (s *PortfolioSnapshotService) loadMonthlyPrices(tickers []string) map[string]*monthlyPrices {
	result := map[string]*monthlyPrices{}
	var rmu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 5)
	for _, t := range tickers {
		if mp, ok := s.histCache.get(t, time.Now()); ok {
			rmu.Lock()
			result[t] = mp
			rmu.Unlock()
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(ticker string) {
			defer wg.Done()
			defer func() { <-sem }()
			h, err := s.fetchHistory(ticker)
			if err != nil || h == nil || len(h.Points) == 0 {
				log.Printf("[Snapshot] price history unavailable for %s: %v", ticker, err)
				return
			}
			mp := buildMonthlyPrices(ticker, h)
			s.histCache.set(ticker, mp, time.Now())
			rmu.Lock()
			result[ticker] = mp
			rmu.Unlock()
		}(t)
	}
	wg.Wait()
	return result
}

// estimateMonths loads positions/transactions/prices and estimates the given months.
func (s *PortfolioSnapshotService) estimateMonths(months []monthKey) ([]MonthlySnapshotSummary, error) {
	var accounts []models.Account
	if err := s.db.Select("id").Find(&accounts).Error; err != nil {
		return nil, err
	}
	activeAcc := map[uint]bool{}
	for _, a := range accounts {
		activeAcc[a.ID] = true
	}

	var holdings []models.Holding
	if err := s.db.Where("quantity > 0").Find(&holdings).Error; err != nil {
		return nil, err
	}
	var txs []models.Transaction
	if err := s.db.Select("account_id", "asset_id", "type", "date", "quantity").Find(&txs).Error; err != nil {
		return nil, err
	}

	type pairKey struct{ acc, asset uint }
	qtyByPair := map[pairKey]float64{}
	var order []pairKey
	add := func(k pairKey) {
		if _, ok := qtyByPair[k]; !ok {
			qtyByPair[k] = 0
			order = append(order, k)
		}
	}
	for _, h := range holdings {
		k := pairKey{h.AccountID, h.AssetID}
		add(k)
		qtyByPair[k] += h.Quantity
	}
	estTxns := make([]estTxn, 0, len(txs))
	for _, t := range txs {
		add(pairKey{t.AccountID, t.AssetID})
		estTxns = append(estTxns, estTxn{t.AccountID, t.AssetID, t.Type, t.Date, t.Quantity})
	}

	assetIDs := map[uint]bool{}
	for _, k := range order {
		if activeAcc[k.acc] {
			assetIDs[k.asset] = true
		}
	}
	ids := make([]uint, 0, len(assetIDs))
	for id := range assetIDs {
		ids = append(ids, id)
	}
	tickerByAsset := map[uint]string{}
	if len(ids) > 0 {
		var assets []models.Asset
		if err := s.db.Unscoped().Select("id", "ticker").Where("id IN ?", ids).Find(&assets).Error; err != nil {
			return nil, err
		}
		for _, a := range assets {
			tickerByAsset[a.ID] = a.Ticker
		}
	}

	positions := make([]estPosition, 0, len(order))
	tickerSet := map[string]bool{}
	for _, k := range order {
		if !activeAcc[k.acc] {
			continue
		}
		tk := strings.TrimSpace(strings.ToUpper(tickerByAsset[k.asset]))
		if tk == "" {
			continue
		}
		positions = append(positions, estPosition{k.acc, k.asset, tk, qtyByPair[k]})
		tickerSet[tk] = true
	}
	if len(positions) == 0 {
		return []MonthlySnapshotSummary{}, nil
	}
	tickers := make([]string, 0, len(tickerSet))
	for t := range tickerSet {
		tickers = append(tickers, t)
	}
	sort.Strings(tickers)

	prices := s.loadMonthlyPrices(tickers)
	return estimateMonthlySummaries(months, positions, estTxns, prices), nil
}
