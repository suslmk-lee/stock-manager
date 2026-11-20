package services

import (
	"fmt"
	"math"
	"strings"
	"time"

	"stock-manager/models"
)

// 오늘 카드의 참고 사실 — 점수에는 넣지 않는다. 사람이 판단할 때 놓치기 쉬운 것만 보여 준다.
//   - 최근 3개월(63거래일) 가운데 하루 −7% 넘게, 그날 지수보다 5%p 넘게 더 빠진 날 (가장 크게 빠진 날 하나)
//   - PER · PBR · 추정 EPS (지난 실적 대비, 쌓인 기록이 두 달 넘으면 그동안 추정이 얼마나 바뀌었나)
//
// 실적 충격을 점수에 넣는 것은 보유 종목 백테스트(2018년 말~2025년)에서 순위가 오히려 나빠져 넣지 않았다:
// 하루 급락을 그 종목 평소 변동과 비교하면 시장 전체가 빠진 날의 ETF 가 걸리고, 지수 대비로 바꾸면 앞 7개의 1년 뒤가 낮아졌다.
// 추정 EPS 는 2026-11 부터 날마다 쌓으므로, 1년쯤 쌓이면 '추정 이익이 깎이는 종목'을 따로 검증할 수 있다.

const (
	factDropDays   = 63   // 최근 거래일 수
	factDropMin    = -7.0 // 하루 하락 (%)
	factDropVsMkt  = -5.0 // 그날 지수보다 더 빠진 정도 (%p)
	factReviseDays = 60   // 추정 EPS 를 비교할 최소 간격 (일)
)

// marketIndex: 종목의 기준 지수 (Yahoo 기호, 이름). 모르면 빈칸.
func marketIndex(ticker string) (string, string) {
	t := strings.ToUpper(strings.TrimSpace(ticker))
	switch {
	case t == "" || IsFundTicker(t):
		return "", ""
	case strings.HasSuffix(t, ".KS"):
		return "^KS11", "코스피"
	case strings.HasSuffix(t, ".KQ"):
		return "^KQ11", "코스닥"
	case strings.Contains(t, "."):
		return "", ""
	}
	return "^GSPC", "S&P 500"
}

// bigDropFact: 최근 63거래일 가운데 하루 −7% 넘게, 그날 지수보다 5%p 넘게 더 빠진 날 중 가장 크게 빠진 날
func bigDropFact(stock, index *PriceHistory, label string) string {
	if stock == nil || index == nil {
		return ""
	}
	day := func(ts int64) string { return time.Unix(ts, 0).UTC().Format(dateLayout) }
	idx := map[string]float64{}
	for _, p := range index.Points {
		if p.Close > 0 {
			idx[day(p.Time)] = p.Close
		}
	}
	var pts []PricePoint
	for _, p := range stock.Points {
		if p.Close > 0 {
			pts = append(pts, p)
		}
	}
	best, bestMkt, bestDay := 0.0, 0.0, ""
	for j := max(1, len(pts)-factDropDays); j < len(pts); j++ {
		r := (pts[j].Close/pts[j-1].Close - 1) * 100
		if r > factDropMin {
			continue
		}
		a, b := idx[day(pts[j].Time)], idx[day(pts[j-1].Time)]
		if a <= 0 || b <= 0 {
			continue
		}
		m := (a/b - 1) * 100
		if r-m > factDropVsMkt || r >= best {
			continue
		}
		best, bestMkt, bestDay = r, m, day(pts[j].Time)
	}
	if bestDay == "" {
		return ""
	}
	d, _ := time.Parse(dateLayout, bestDay)
	return fmt.Sprintf("%d/%d 하루 %+.1f%% (그날 %s %+.1f%%)", int(d.Month()), d.Day(), best, label, bestMkt)
}

// valuationFact: 가장 최근 펀더멘털 (오래된 것부터 정렬된 기록). PER · PBR · 추정 EPS
func valuationFact(snaps []models.FundamentalSnapshot) string {
	if len(snaps) == 0 {
		return ""
	}
	last := snaps[len(snaps)-1]
	var parts []string
	if last.PER > 0 {
		parts = append(parts, fmt.Sprintf("PER %.1f", last.PER))
	}
	if last.PBR > 0 {
		parts = append(parts, fmt.Sprintf("PBR %.2f", last.PBR))
	}
	if last.ForwardEPS > 0 && last.EPS > 0 {
		parts = append(parts, fmt.Sprintf("추정 EPS 지난 실적보다 %+.0f%%", (last.ForwardEPS/last.EPS-1)*100))
	}
	// 두 달 넘게 쌓였으면 그동안 추정 EPS 가 얼마나 바뀌었나 (factReviseDays 보다 오래된 것 가운데 가장 가까운 날)
	if lt, ok := parseDay(last.Date); ok && last.ForwardEPS > 0 {
		for i := len(snaps) - 2; i >= 0; i-- {
			t, ok := parseDay(snaps[i].Date)
			if !ok || lt.Sub(t) < factReviseDays*24*time.Hour || snaps[i].ForwardEPS <= 0 {
				continue
			}
			months := int(math.Round(lt.Sub(t).Hours() / 24 / 30))
			parts = append(parts, fmt.Sprintf("%d달 새 추정 EPS %+.0f%%", months, (last.ForwardEPS/snaps[i].ForwardEPS-1)*100))
			break
		}
	}
	return strings.Join(parts, " · ")
}

// pickFacts: 추천 카드들의 참고 사실 — 지수 이력은 한 번씩만, 펀더멘털 기록은 한 번에 읽는다
func (s *TodayService) pickFacts(picks []TodayPick) map[uint][]string {
	out := map[uint][]string{}
	if len(picks) == 0 {
		return out
	}
	snaps := map[uint][]models.FundamentalSnapshot{}
	if s.db != nil {
		ids := make([]uint, 0, len(picks))
		for _, p := range picks {
			ids = append(ids, p.AssetID)
		}
		since := s.now().In(kst).AddDate(0, 0, -150).Format(dateLayout)
		var rows []models.FundamentalSnapshot
		if err := s.db.Where("asset_id IN ? AND date >= ?", ids, since).Order("date").Find(&rows).Error; err == nil {
			for _, r := range rows {
				snaps[r.AssetID] = append(snaps[r.AssetID], r)
			}
		}
	}
	index := map[string]*PriceHistory{}
	if s.ticker != nil {
		for _, p := range picks {
			if sym, _ := marketIndex(p.Ticker); sym != "" {
				if _, done := index[sym]; !done {
					index[sym], _ = s.ticker.GetDailyHistoryCached(sym)
				}
			}
		}
	}
	for _, p := range picks {
		var facts []string
		if sym, label := marketIndex(p.Ticker); sym != "" && index[sym] != nil && s.ticker != nil {
			if h, err := s.ticker.GetDailyHistoryCached(p.Ticker); err == nil {
				if f := bigDropFact(h, index[sym], label); f != "" {
					facts = append(facts, f)
				}
			}
		}
		if f := valuationFact(snaps[p.AssetID]); f != "" {
			facts = append(facts, f)
		}
		if len(facts) > 0 {
			out[p.AssetID] = facts
		}
	}
	return out
}
