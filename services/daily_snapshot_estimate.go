package services

import (
	"math"
	"sort"
	"strings"
	"time"

	"stock-manager/models"
)

// 일별 총자산 추정(순수 계산). DB/네트워크 없이 주입된 데이터만 사용한다.

const dateLayout = "2006-01-02"

// kstDay 는 시각의 KST 달력일(에폭 기준 일 수)을 반환한다.
func kstDay(t time.Time) int64 { return floorDiv(t.Unix()+9*3600, 86400) }

// kstDateString 은 KST 기준 YYYY-MM-DD.
func kstDateString(t time.Time) string { return t.In(kst).Format(dateLayout) }

func parseKSTDate(s string) (time.Time, error) { return time.ParseInLocation(dateLayout, s, kst) }

type dsPos struct {
	AccountID  uint
	AssetID    uint
	Ticker     string
	Restricted bool
	CurrentQty float64
	AvgPrice   float64 // 현재 평균단가(종목 통화) — 거래 이력이 모자랄 때 잔여 수량의 원가 추정에 사용
}

type dsTxn struct {
	AccountID uint
	AssetID   uint
	Type      models.TransactionType
	Date      time.Time
	Qty       float64
	Price     float64
	Fee       float64
}

// dsDiv 는 수령 완료된 배당 1건 (세후, 배당 통화).
type dsDiv struct {
	Date     time.Time
	Net      float64
	Currency string
}

// dailyPrices 는 종목의 일봉 종가 (거래소 현지 날짜 기준, 오름차순).
type dailyPrices struct {
	Currency string
	days     []int64
	closes   []float64
}

func buildDailyPrices(ticker string, h *PriceHistory) *dailyPrices {
	dp := &dailyPrices{Currency: currencyFor(ticker, h.Currency)}
	type bar struct {
		day int64
		c   float64
	}
	bars := make([]bar, 0, len(h.Points))
	for _, p := range h.Points {
		if p.Close > 0 && finite(p.Close) {
			bars = append(bars, bar{floorDiv(p.Time+h.GmtOffset, 86400), p.Close})
		}
	}
	sort.SliceStable(bars, func(i, j int) bool { return bars[i].day < bars[j].day })
	for _, b := range bars {
		if n := len(dp.days); n > 0 && dp.days[n-1] == b.day {
			dp.closes[n-1] = b.c // 같은 날 마지막 봉
			continue
		}
		dp.days = append(dp.days, b.day)
		dp.closes = append(dp.closes, b.c)
	}
	return dp
}

// maxPriceGapDays: 첫 봉보다 이만큼 이전 날짜에는 가격이 없다고 본다 (상장 전 등).
const maxPriceGapDays = 10

// at 은 day 이하의 마지막 종가 (휴일/주말 이월). 첫 봉 이전이면 maxPriceGapDays 이내일 때만 첫 봉.
func (dp *dailyPrices) at(day int64) (float64, bool) {
	if dp == nil || len(dp.days) == 0 {
		return 0, false
	}
	i := sort.Search(len(dp.days), func(i int) bool { return dp.days[i] > day })
	if i == 0 {
		if dp.days[0]-day <= maxPriceGapDays {
			return dp.closes[0], true
		}
		return 0, false
	}
	return dp.closes[i-1], true
}

type dsPairKey struct{ acc, asset uint }

type dsPairTimeline struct {
	days    []int64   // 정렬된 거래일
	cumNet  []float64 // len = n+1, 앞 i건 순증감(매수 +, 매도 -)
	fwdQty  []float64 // len = n+1, 정방향 평균단가법 수량
	fwdCost []float64 // len = n+1, 정방향 평균단가법 원가 (KRW)
	total   float64
}

func fxOrNow(fxAt func(time.Time) float64, fxNow float64, t time.Time) float64 {
	if fxAt != nil {
		if v := fxAt(t); finite(v) && v > 0 {
			return v
		}
	}
	return fxNow
}

func buildPairTimeline(txns []dsTxn, currency string, fxAt func(time.Time) float64, fxNow float64) *dsPairTimeline {
	sorted := append([]dsTxn(nil), txns...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Date.Before(sorted[j].Date) })
	tl := &dsPairTimeline{cumNet: []float64{0}, fwdQty: []float64{0}, fwdCost: []float64{0}}
	var qty, cost, net float64
	for _, tx := range sorted {
		if !finite(tx.Qty) || tx.Qty <= 0 {
			continue
		}
		switch tx.Type {
		case models.TransactionTypeBuy:
			fx := 1.0
			if currency != "KRW" {
				fx = fxOrNow(fxAt, fxNow, tx.Date)
			}
			c := (tx.Qty*tx.Price + tx.Fee) * fx
			if finite(c) {
				qty += tx.Qty
				cost += c
			}
			net += tx.Qty
		case models.TransactionTypeSell:
			if qty > 0 {
				sq := math.Min(tx.Qty, qty)
				cost -= cost * sq / qty
				qty -= sq
				if qty < 1e-9 {
					qty, cost = 0, 0
				}
			}
			net -= tx.Qty
		default:
			continue
		}
		tl.days = append(tl.days, kstDay(tx.Date))
		tl.cumNet = append(tl.cumNet, net)
		tl.fwdQty = append(tl.fwdQty, qty)
		tl.fwdCost = append(tl.fwdCost, cost)
	}
	tl.total = net
	return tl
}

// estimateDailySnapshots 는 dates(YYYY-MM-DD, KST) 각각의 일말 기준 총자산을 추정한다.
// 수량: 현재 수량에서 해당일 이후 거래를 역산 (거래 없는 보유분은 기간 내내 현재 수량 보유로 가정).
// 평가: 일봉 종가(휴일은 직전 종가) × 환율. 원가: 정방향 평균단가 KRW 재생 + 모자란 수량은 현재 평단×당일 환율.
// 가격이 없는 종목은 그날 제외. 보유 종목이 하나도 없는 날짜는 결과에서 빠진다.
func estimateDailySnapshots(dates []string, positions []dsPos, txns []dsTxn, divs []dsDiv,
	prices map[string]*dailyPrices, fxAt func(time.Time) float64, fxNow float64,
) ([]models.DailyAssetSnapshot, []models.DailyPositionSnapshot) {

	txByPair := map[dsPairKey][]dsTxn{}
	for _, t := range txns {
		k := dsPairKey{t.AccountID, t.AssetID}
		txByPair[k] = append(txByPair[k], t)
	}
	timelines := make([]*dsPairTimeline, len(positions))
	for i, p := range positions {
		cur := currencyFor(p.Ticker, "")
		if dp := prices[p.Ticker]; dp != nil {
			cur = dp.Currency
		}
		timelines[i] = buildPairTimeline(txByPair[dsPairKey{p.AccountID, p.AssetID}], cur, fxAt, fxNow)
	}

	// 누적 배당 (KRW, 지급일 환율)
	type divPt struct {
		day int64
		cum float64
	}
	sortedDivs := append([]dsDiv(nil), divs...)
	sort.SliceStable(sortedDivs, func(i, j int) bool { return sortedDivs[i].Date.Before(sortedDivs[j].Date) })
	divCum := make([]divPt, 0, len(sortedDivs))
	var run float64
	for _, d := range sortedDivs {
		v := d.Net
		if strings.ToUpper(strings.TrimSpace(d.Currency)) != "KRW" {
			v *= fxOrNow(fxAt, fxNow, d.Date)
		}
		if finite(v) {
			run += v
		}
		divCum = append(divCum, divPt{kstDay(d.Date), run})
	}

	assets := make([]models.DailyAssetSnapshot, 0, len(dates))
	var posRows []models.DailyPositionSnapshot
	for _, ds := range dates {
		dt, err := parseKSTDate(ds)
		if err != nil {
			continue
		}
		day := kstDay(dt)
		fxD := fxOrNow(fxAt, fxNow, dt)
		row := models.DailyAssetSnapshot{Date: ds, UsdKrw: fxD, Estimated: true, Source: "estimate"}
		n := 0
		for i, p := range positions {
			dp := prices[p.Ticker]
			price, ok := dp.at(day)
			if !ok {
				continue
			}
			tl := timelines[i]
			idx := sort.Search(len(tl.days), func(j int) bool { return tl.days[j] > day }) // 해당일까지 거래 수
			qty := p.CurrentQty - (tl.total - tl.cumNet[idx])
			if qty < 1e-9 {
				continue
			}
			fx := 1.0
			if dp.Currency != "KRW" {
				fx = fxD
			}
			value := qty * price * fx
			var cost float64
			if fq := tl.fwdQty[idx]; fq > 1e-9 {
				covered := math.Min(qty, fq)
				cost = tl.fwdCost[idx]*covered/fq + (qty-covered)*p.AvgPrice*fx
			} else {
				cost = qty * p.AvgPrice * fx
			}
			if !finite(value) || !finite(cost) {
				continue
			}
			row.TotalKRW += value
			row.CostKRW += cost
			if p.Restricted {
				row.RestrictedKRW += value
			} else {
				row.LiquidKRW += value
			}
			n++
			posRows = append(posRows, models.DailyPositionSnapshot{
				Date: ds, AccountID: p.AccountID, AssetID: p.AssetID, Quantity: qty, Price: price,
				Currency: dp.Currency, FxRate: fx, ValueKRW: value, CostKRW: cost, Estimated: true,
			})
		}
		if n == 0 {
			continue
		}
		j := sort.Search(len(divCum), func(j int) bool { return divCum[j].day > day })
		if j > 0 {
			row.DividendsCumKRW = divCum[j-1].cum
		}
		assets = append(assets, row)
	}
	return assets, posRows
}
