package services

import (
	"context"
	"fmt"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 사기 좋은 가격 — 보유 종목마다 자기 과거 가격(10년 일봉)과 배당으로 "지금이 싼가"를 계산해 KST 날짜별로 DB 에 남긴다.
//   가격 위치 : 오늘 가격이 최근 1년 · 3년 종가 가운데 하위 몇 %인가
//   가격대    : 아주 좋은 가격 = 3년 종가 하위 10%, 좋은 가격 = 하위 20%, 보통 = 중간값 이하
//   배당      : 최근 1년 배당 ÷ 가격이 지난 5년 배당률 가운데 어디인가 (배당률 2% 이상만 점수에 쓴다)
//   흐름      : 20일선 아래이고 직전 20거래일 저점에서 2% 안쪽이면 '아직 내려가는 중'
//   자기 검증 : 과거에 1년 종가 하위 20%였던 날 샀다면 1년 뒤 총수익(배당 재투자)이 모든 날보다 좋았나
//   가격 매력 : (100 − 가격 위치) × 0.7 + 배당률 위치 × 0.3 (배당을 안 쓰면 가격만), 과거에 안 통했으면 절반, 사례가 적으면 0.8배
// 계산은 백그라운드에서 몇 시간마다 (앱과 서버가 같은 DB 를 쓰므로 오늘 기록이 새것이면 건너뛴다), 30일 지난 기록은 지운다.

const (
	zoneKeepDays     = 30
	zoneStaleAfter   = 4 * time.Hour
	zoneConcurrency  = 4
	zoneMinCloses    = 252 // 1년 (이보다 짧으면 계산하지 않는다)
	zoneYearCloses   = 252
	zone3YCloses     = 756
	zone5YCloses     = 1260
	zoneMinYield     = 2.0 // 배당률이 이보다 낮으면 배당을 점수에 쓰지 않는다
	zoneCheapPos     = 20.0
	zoneMinCheapDays = 40
	zoneAlertQuiet   = 7 // 이 날수 안에 알렸으면 다시 알리지 않는다
)

type PriceZoneService struct {
	db     *gorm.DB
	ticker *TickerService
	now    func() time.Time
	fetch  func(ticker string) (*PriceHistory, []DividendEvent, error)
	mu     sync.Mutex
}

func NewPriceZoneService(db *gorm.DB, ticker *TickerService) *PriceZoneService {
	s := &PriceZoneService{db: db, ticker: ticker, now: time.Now}
	if ticker != nil {
		s.fetch = ticker.GetZoneHistory
	}
	return s
}

// PriceZoneRow: 화면용 (종목 이름 포함)
type PriceZoneRow struct {
	models.PriceZone
	Name string `json:"name"`
}

type PriceZoneList struct {
	Date      string         `json:"date"`       // 가장 최근 계산 날짜 (KST)
	UpdatedAt *time.Time     `json:"updated_at"` // 가장 최근 계산 시각
	Held      int            `json:"held"`       // 계산 대상 보유 종목 수 (펀드 제외)
	Rows      []PriceZoneRow `json:"rows"`       // 가격 매력 높은 순
}

type PriceZoneDetail struct {
	Zone    *PriceZoneRow      `json:"zone"`    // 가장 최근 (없으면 null)
	History []models.PriceZone `json:"history"` // 최근 30일 (오래된 것부터)
}

// ── 계산 (순수 함수) ──

// zonePos: win(마지막이 v) 가운데 v 보다 낮은 종가의 비율 (0 = 최저, 100 = 최고)
func zonePos(win []float64, v float64) float64 {
	if len(win) < 2 {
		return 50
	}
	lower := 0
	for _, c := range win {
		if c < v {
			lower++
		}
	}
	return float64(lower) / float64(len(win)-1) * 100
}

func zoneQuantile(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	return sorted[int(math.Round(q*float64(len(sorted)-1)))]
}

// priceRound: 가격은 통화 단위에 맞게 (원·엔은 정수, 그 외 소수 둘째 자리)
func priceRound(v float64, ccy string) float64 {
	if ccy == "KRW" || ccy == "JPY" {
		return math.Round(v)
	}
	return round2(v)
}

// computeZone: 일봉(시간 오름차순이 아니어도 된다)과 주당 배당으로 오늘의 가격대를 계산한다. 1년보다 짧으면 false.
func computeZone(ticker string, points []PricePoint, divs []DividendEvent) (models.PriceZone, bool) {
	ps := make([]PricePoint, 0, len(points))
	for _, p := range points {
		if p.Close > 0 && !math.IsNaN(p.Close) && !math.IsInf(p.Close, 0) {
			ps = append(ps, p)
		}
	}
	sort.Slice(ps, func(i, j int) bool { return ps[i].Time < ps[j].Time })
	n := len(ps)
	if n < zoneMinCloses {
		return models.PriceZone{}, false
	}
	closes := make([]float64, n)
	for i, p := range ps {
		closes[i] = p.Close
	}
	ccy := tickerCurrency(ticker)
	cur := closes[n-1]
	z := models.PriceZone{Ticker: ticker, Currency: ccy, Price: cur, PriceAt: ps[n-1].Time,
		Years: round2(float64(ps[n-1].Time-ps[0].Time) / (365.25 * 86400))}

	// 가격 위치와 가격대
	y1 := closes[n-zoneYearCloses:]
	y3 := closes[max(0, n-zone3YCloses):]
	z.Pos1y = round2(zonePos(y1, cur))
	z.Pos3y = round2(zonePos(y3, cur))
	s1 := append([]float64(nil), y1...)
	sort.Float64s(s1)
	s3 := append([]float64(nil), y3...)
	sort.Float64s(s3)
	z.Low1y, z.High1y = s1[0], s1[len(s1)-1]
	z.Great = priceRound(zoneQuantile(s3, 0.1), ccy)
	z.Good = priceRound(zoneQuantile(s3, 0.2), ccy)
	z.Mid = priceRound(zoneQuantile(s3, 0.5), ccy)
	switch {
	case cur <= z.Great:
		z.Level = models.ZoneLevelGreat
	case cur <= z.Good:
		z.Level = models.ZoneLevelGood
	case cur <= z.Mid:
		z.Level = models.ZoneLevelFair
	default:
		z.Level = models.ZoneLevelHigh
	}

	// 최근 흐름
	if n >= 21 {
		low := math.Inf(1)
		for _, c := range closes[n-21 : n-1] {
			low = math.Min(low, c)
		}
		ma := 0.0
		for _, c := range closes[n-20:] {
			ma += c
		}
		ma /= 20
		z.MA20 = priceRound(ma, ccy)
		z.FromLow20 = round2((cur/low - 1) * 100)
		z.Falling = cur < ma && z.FromLow20 < 2
	}

	// 배당: 날마다 최근 1년 배당 (배당 이벤트는 그 날짜 이하·1년 이내)
	ds := append([]DividendEvent(nil), divs...)
	sort.Slice(ds, func(i, j int) bool { return ds[i].Time < ds[j].Time })
	ttm := make([]float64, n)
	lo, hi, sum := 0, 0, 0.0
	for i := 0; i < n; i++ {
		t := ps[i].Time
		for hi < len(ds) && ds[hi].Time <= t {
			sum += ds[hi].Amount
			hi++
		}
		for lo < hi && ds[lo].Time <= t-365*86400 {
			sum -= ds[lo].Amount
			lo++
		}
		ttm[i] = math.Max(0, sum)
	}
	z.Yield = round2(ttm[n-1] / cur * 100)
	z.YieldPos = -1
	if z.Yield >= zoneMinYield {
		var ys []float64
		for i := max(0, n-zone5YCloses); i < n-1; i++ {
			if ps[i].Time-ps[0].Time >= 365*86400 && ttm[i] > 0 { // 처음 1년은 배당 1년치가 다 안 모였다
				ys = append(ys, ttm[i]/closes[i]*100)
			}
		}
		if len(ys) >= zoneYearCloses {
			below := 0
			for _, y := range ys {
				if y < z.Yield {
					below++
				}
			}
			z.YieldPos = round2(float64(below) / float64(len(ys)) * 100)
			sort.Float64s(ys)
			if hiY := zoneQuantile(ys, 0.8); hiY > 0 {
				z.YieldGoodPrice = priceRound(ttm[n-1]/(hiY/100), ccy)
			}
		}
	}

	// 자기 검증: 총수익 지수(배당 재투자)로 1년 뒤 수익
	tr := make([]float64, n)
	tr[0] = 1
	for i := 1; i < n; i++ {
		d := ttmDelta(ds, ps[i-1].Time, ps[i].Time)
		tr[i] = tr[i-1] * (closes[i] + d) / closes[i-1]
	}
	var allSum, cheapSum float64
	cheapWin, lastCheap := 0, -1000
	for i := zoneYearCloses - 1; i+zoneYearCloses < n; i++ {
		fwd := (tr[i+zoneYearCloses]/tr[i] - 1) * 100
		z.TestDays++
		allSum += fwd
		if zonePos(closes[i-zoneYearCloses+1:i+1], closes[i]) <= zoneCheapPos {
			z.CheapDays++
			cheapSum += fwd
			if fwd > 0 {
				cheapWin++
			}
			if i-lastCheap > 21 {
				z.CheapEpisodes++
			}
			lastCheap = i
		}
	}
	if z.TestDays > 0 {
		z.AllAvg = round2(allSum / float64(z.TestDays))
	}
	if z.CheapDays > 0 {
		z.CheapAvg = round2(cheapSum / float64(z.CheapDays))
		z.CheapWin = round2(float64(cheapWin) / float64(z.CheapDays) * 100)
	}
	// 나빴던 결과는 한 구간이어도 경고하고, 좋았던 결과는 두 구간 이상일 때만 믿는다
	switch {
	case z.CheapDays < zoneMinCheapDays:
		z.Verdict = models.ZoneVerdictFew
	case z.CheapAvg < z.AllAvg || z.CheapAvg <= 0:
		z.Verdict = models.ZoneVerdictTrap
	case z.CheapEpisodes < 2:
		z.Verdict = models.ZoneVerdictFew
	default:
		z.Verdict = models.ZoneVerdictWorks
	}

	// 가격 매력
	pos := z.Pos1y
	if z.Years >= 1.5 {
		pos = (z.Pos1y + z.Pos3y) / 2
	}
	score := 100 - pos
	if z.YieldPos >= 0 {
		score = 0.7*score + 0.3*z.YieldPos
	}
	switch z.Verdict {
	case models.ZoneVerdictTrap:
		score *= 0.5
	case models.ZoneVerdictFew:
		score *= 0.8
	}
	z.Score = math.Round(score*10) / 10
	return z, true
}

// ttmDelta: (from, to] 에 배당락이 있는 주당 배당 합
func ttmDelta(ds []DividendEvent, from, to int64) float64 {
	i := sort.Search(len(ds), func(k int) bool { return ds[k].Time > from })
	s := 0.0
	for ; i < len(ds) && ds[i].Time <= to; i++ {
		s += ds[i].Amount
	}
	return s
}

// ── 저장 ──

type zoneAsset struct {
	ID     uint
	Ticker string
	Name   string
}

// heldAssets: 보유 수량이 있는 종목 (펀드 제외)
func (s *PriceZoneService) heldAssets() ([]zoneAsset, error) {
	var rows []zoneAsset
	err := s.db.Table("holdings").
		Select("DISTINCT assets.id AS id, assets.ticker AS ticker, assets.name AS name").
		Joins("JOIN assets ON assets.id = holdings.asset_id AND assets.deleted_at IS NULL").
		Where("holdings.deleted_at IS NULL AND holdings.quantity > ?", 1e-9).
		Order("assets.id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := rows[:0]
	for _, r := range rows {
		if !IsFundTicker(r.Ticker) {
			out = append(out, r)
		}
	}
	return out, nil
}

// zoneUpdateColumns: 같은 날 다시 계산하면 덮어쓸 컬럼 (알림 여부·처음 만든 시각은 그대로)
func (s *PriceZoneService) zoneUpdateColumns() []string {
	stmt := &gorm.Statement{DB: s.db}
	if err := stmt.Parse(&models.PriceZone{}); err != nil {
		return nil
	}
	var cols []string
	for _, f := range stmt.Schema.Fields {
		switch f.DBName {
		case "", "id", "asset_id", "date", "alerted", "created_at":
			continue
		}
		cols = append(cols, f.DBName)
	}
	return cols
}

// Refresh: 보유 종목의 가격대를 지금 계산해 오늘 날짜로 저장하고 30일 지난 기록을 지운다. 저장한 종목 수.
func (s *PriceZoneService) Refresh() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fetch == nil {
		return 0, fmt.Errorf("시세 서비스가 없습니다")
	}
	assets, err := s.heldAssets()
	if err != nil {
		return 0, err
	}
	today := todayKST(s.now())
	var (
		mu    sync.Mutex
		rows  []models.PriceZone
		wg    sync.WaitGroup
		sem   = make(chan struct{}, zoneConcurrency)
		fails int
	)
	for _, a := range assets {
		wg.Add(1)
		sem <- struct{}{}
		go func(a zoneAsset) {
			defer wg.Done()
			defer func() { <-sem }()
			h, divs, err := s.fetch(a.Ticker)
			if err != nil || h == nil {
				mu.Lock()
				fails++
				mu.Unlock()
				return
			}
			z, ok := computeZone(a.Ticker, h.Points, divs)
			if !ok {
				return
			}
			z.AssetID, z.Date = a.ID, today
			mu.Lock()
			rows = append(rows, z)
			mu.Unlock()
		}(a)
	}
	wg.Wait()
	if len(rows) > 0 {
		sort.Slice(rows, func(i, j int) bool { return rows[i].AssetID < rows[j].AssetID })
		err := s.db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "asset_id"}, {Name: "date"}},
			DoUpdates: clause.AssignmentColumns(s.zoneUpdateColumns()),
		}).CreateInBatches(&rows, 100).Error
		if err != nil {
			return 0, err
		}
	}
	cutoff := s.now().In(kst).AddDate(0, 0, -zoneKeepDays).Format(dateLayout)
	if err := s.db.Where("date < ?", cutoff).Delete(&models.PriceZone{}).Error; err != nil {
		return len(rows), err
	}
	if fails > 0 {
		log.Printf("[PriceZone] %d종목 저장, 이력을 못 받은 종목 %d개", len(rows), fails)
	}
	return len(rows), nil
}

// RefreshIfStale: 오늘 기록이 없거나 마지막 계산이 4시간보다 오래됐으면 다시 계산한다 (앱과 서버 중 먼저 하는 쪽만).
func (s *PriceZoneService) RefreshIfStale() (bool, error) {
	now := s.now()
	var last []models.PriceZone
	if err := s.db.Where("date = ?", todayKST(now)).Order("updated_at DESC").Limit(1).Find(&last).Error; err != nil {
		return false, err
	}
	if len(last) > 0 && now.Sub(last[0].UpdatedAt) < zoneStaleAfter {
		return false, nil
	}
	_, err := s.Refresh()
	return err == nil, err
}

// RunEvery: 시작하고 조금 뒤 한 번, 이후 every 마다 오래된 계산을 새로 한다.
func (s *PriceZoneService) RunEvery(ctx context.Context, startDelay, every time.Duration) {
	run := func() {
		if _, err := s.RefreshIfStale(); err != nil {
			log.Printf("[PriceZone] 계산 오류: %v", err)
		}
	}
	select {
	case <-ctx.Done():
		return
	case <-time.After(startDelay):
	}
	run()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}

// ── 읽기 ──

// LatestMap: 지금 보유한 종목마다 가장 최근 기록 (최근 7일 안), 그리고 그중 가장 늦은 날짜
func (s *PriceZoneService) LatestMap() (map[uint]PriceZoneRow, error) {
	assets, err := s.heldAssets()
	if err != nil {
		return nil, err
	}
	names := map[uint]string{}
	for _, a := range assets {
		names[a.ID] = a.Name
	}
	since := s.now().In(kst).AddDate(0, 0, -7).Format(dateLayout)
	var rows []models.PriceZone
	if err := s.db.Where("date >= ?", since).Order("date").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := map[uint]PriceZoneRow{}
	for _, r := range rows {
		if name, ok := names[r.AssetID]; ok {
			out[r.AssetID] = PriceZoneRow{PriceZone: r, Name: name} // 날짜 순이라 마지막이 가장 최근
		}
	}
	return out, nil
}

// GetLatest: 보유 종목의 가장 최근 가격대 (가격 매력 높은 순)
func (s *PriceZoneService) GetLatest() (*PriceZoneList, error) {
	m, err := s.LatestMap()
	if err != nil {
		return nil, err
	}
	assets, err := s.heldAssets()
	if err != nil {
		return nil, err
	}
	out := &PriceZoneList{Held: len(assets), Rows: make([]PriceZoneRow, 0, len(m))}
	for _, r := range m {
		out.Rows = append(out.Rows, r)
		if r.Date > out.Date {
			out.Date = r.Date
		}
		if out.UpdatedAt == nil || r.UpdatedAt.After(*out.UpdatedAt) {
			t := r.UpdatedAt
			out.UpdatedAt = &t
		}
	}
	sort.Slice(out.Rows, func(i, j int) bool {
		if out.Rows[i].Score != out.Rows[j].Score {
			return out.Rows[i].Score > out.Rows[j].Score
		}
		return out.Rows[i].AssetID < out.Rows[j].AssetID
	})
	return out, nil
}

// GetAsset: 한 종목의 최근 기록과 30일 이력
func (s *PriceZoneService) GetAsset(assetID uint) (*PriceZoneDetail, error) {
	var hist []models.PriceZone
	if err := s.db.Where("asset_id = ?", assetID).Order("date").Find(&hist).Error; err != nil {
		return nil, err
	}
	out := &PriceZoneDetail{History: hist}
	if len(hist) > 0 {
		var a models.Asset
		s.db.Select("id", "name").First(&a, assetID)
		out.Zone = &PriceZoneRow{PriceZone: hist[len(hist)-1], Name: a.Name}
	}
	return out, nil
}

// ── 알림 ──

// ZoneAlertMessage: 알림 문구
func ZoneAlertMessage(z models.PriceZone) string {
	what := "좋은 가격"
	line := z.Good
	if z.Level == models.ZoneLevelGreat {
		what, line = "아주 좋은 가격", z.Great
	}
	msg := fmt.Sprintf("%s에 들어왔어요 · %s (%s 이하, 1년 중 하위 %.0f%%) · 과거 이만큼 쌌을 때 1년 뒤 평균 %+.1f%%",
		what, holdingMoney(z.Price, z.Currency), holdingMoney(line, z.Currency), z.Pos1y, z.CheapAvg)
	if z.Falling {
		msg += " · 아직 내려가는 중"
	}
	return msg
}

// Alerts: 오늘 기록이 좋은 가격대에 새로 들어온 종목을 한 번 알린다 (신호 점검 때 함께 돈다).
//   - 과거에 싸게 사서 통했던 종목만 (사례가 적거나 안 통했으면 알리지 않는다)
//   - 바로 전 기록이 가격대 밖이었을 때만 (처음 계산한 종목은 알리지 않는다), 7일 안에 알렸으면 건너뛴다
func (s *PriceZoneService) Alerts(enabled bool, now time.Time) ([]models.SignalEvent, error) {
	today := todayKST(now)
	var rows []models.PriceZone
	if err := s.db.Where("date = ? AND alerted = ?", today, false).Order("asset_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	quiet := now.In(kst).AddDate(0, 0, -zoneAlertQuiet).Format(dateLayout)
	var created []models.SignalEvent
	for _, z := range rows {
		if !z.InZone() || z.Verdict != models.ZoneVerdictWorks {
			continue
		}
		var prev []models.PriceZone
		if err := s.db.Where("asset_id = ? AND date < ?", z.AssetID, today).Order("date DESC").Limit(1).Find(&prev).Error; err != nil || len(prev) == 0 || prev[0].InZone() {
			continue
		}
		var recent int64
		s.db.Model(&models.PriceZone{}).Where("asset_id = ? AND date >= ? AND alerted = ?", z.AssetID, quiet, true).Count(&recent)
		if recent > 0 {
			continue
		}
		var a models.Asset
		if err := s.db.Select("id", "name", "ticker").First(&a, z.AssetID).Error; err != nil {
			continue
		}
		ev := models.SignalEvent{AssetID: z.AssetID, Ticker: z.Ticker, Name: a.Name, ToAction: "ZONE", Message: ZoneAlertMessage(z),
			CurrentPrice: z.Price, Currency: z.Currency, CreatedAt: now, Kind: models.SignalEventKindZone}
		if !enabled {
			t := now
			ev.ReadAt = &t
		}
		made := false
		err := s.db.Transaction(func(tx *gorm.DB) error {
			res := tx.Model(&models.PriceZone{}).Where("id = ? AND alerted = ?", z.ID, false).Update("alerted", true)
			if res.Error != nil || res.RowsAffected == 0 {
				return res.Error // 이미 알렸다 (앱과 서버가 함께 돌아도 한 번만)
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
	return created, nil
}

// CombineAlerts: 신호 점검 때 함께 돌릴 알림 여러 개를 하나로
func CombineAlerts(fns ...func(enabled bool, now time.Time) ([]models.SignalEvent, error)) func(enabled bool, now time.Time) ([]models.SignalEvent, error) {
	return func(enabled bool, now time.Time) ([]models.SignalEvent, error) {
		var out []models.SignalEvent
		var firstErr error
		for _, fn := range fns {
			if fn == nil {
				continue
			}
			evs, err := fn(enabled, now)
			out = append(out, evs...)
			if err != nil && firstErr == nil {
				firstErr = err
			}
		}
		return out, firstErr
	}
}
