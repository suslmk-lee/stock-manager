package services

import (
	"fmt"
	"math"
	"strings"
	"time"

	"stock-manager/models"

	"gorm.io/gorm"
)

// 대시보드 요약 — 개인 대시보드가 30분마다 한 번 부르는 것 (HTTP 전용, GET /api/dashboard/summary).
// 한 칸이 실패해도 나머지는 돌려준다 (그 칸은 null, errors[칸] 에 이유).
//
//   - portfolio  일별 총자산(최근 1개월)에서 실측(estimated=false) 마지막 두 점 — 오늘 점이 아직 없을 수 있다(last_real_date)
//   - dividends  오늘 받은 배당 · 이번 달 · 올해 받은 배당(세후 = 기록 금액 − 세금 — 예수금·배당 화면과 같다, 원화는 지금 환율)
//     · 앞으로 30일 예정 배당(예정 배당 API 와 같은 계산)
//   - signals    읽지 않은 신호 수 (신호를 새로 계산하지 않는다)
//
// 시세를 새로 받지 않는다 — 환율은 일별 총자산에 저장된 마지막 실측 환율. 예정 배당은 시장 배당 이력이 필요해
// (Fly 머신은 쉬다 깨면 캐시가 비어 있다) 시간 한도 안에 끝나지 않으면 그 칸만 비우고, 계산은 뒤에서 마저 해 캐시에 남긴다.

const dashboardUpcomingDays = 30

type DashboardSummary struct {
	AsOf      string              `json:"as_of"`
	Portfolio *DashboardPortfolio `json:"portfolio"`
	Dividends *DashboardDividends `json:"dividends"`
	Signals   *DashboardSignals   `json:"signals"`
	UsdKrw    *float64            `json:"usd_krw"`
	Errors    map[string]string   `json:"errors"`
}

type DashboardPortfolio struct {
	TotalKRW     float64  `json:"total_krw"` // 예수금 포함
	CostKRW      float64  `json:"cost_krw"`
	CashKRW      float64  `json:"cash_krw"`
	DayChangeKRW *float64 `json:"day_change_krw"` // 앞 실측 점 대비 (없으면 null)
	DayChangePct *float64 `json:"day_change_pct"`
	LastRealDate string   `json:"last_real_date"`
	Estimated    bool     `json:"estimated"` // 1개월 안에 실측 점이 없어 추정 점을 썼으면 true
}

type DashboardDividends struct {
	TodayReceived    []DashboardDividend `json:"today_received"`
	TodayReceivedKRW float64             `json:"today_received_krw"`
	MtdKRW           float64             `json:"mtd_krw"`
	YtdKRW           float64             `json:"ytd_krw"`
	Upcoming30dCount *int                `json:"upcoming_30d_count"` // 예정 배당을 못 구하면 null
	Upcoming30dKRW   *float64            `json:"upcoming_30d_krw"`
}

type DashboardDividend struct {
	DividendID    uint     `json:"dividend_id"`
	Ticker        string   `json:"ticker"`
	AssetName     string   `json:"asset_name"`
	AccountName   string   `json:"account_name"`
	AccountBroker string   `json:"account_broker"`
	Amount        float64  `json:"amount"` // 세후 (기록 금액 − 세금)
	Tax           float64  `json:"tax"`    // 기록된 세금
	Currency      string   `json:"currency"`
	AmountKRW     *float64 `json:"amount_krw"` // 세후 원화 — 그 통화 환율을 모르면 null
}

type DashboardSignals struct {
	UnreadCount int64 `json:"unread_count"`
}

type DashboardService struct {
	db *gorm.DB
	// 칸마다 가져오는 곳 (시험에서 바꿔 끼운다)
	series   func() (*DailySeries, error)
	upcoming func(days int, fx func(string) float64) (*UpcomingDividends, error)
	unread   func() (int64, error)
	fxNow    func(ccy string) float64 // 달러가 아닌 외화 기록(드묾)·저장된 환율이 없을 때만
	now      func() time.Time

	upcomingTimeout time.Duration
}

func NewDashboardService(db *gorm.DB, daily *DailySnapshotService, divScore *DividendScoreService, signal *SignalService, ticker *TickerService) *DashboardService {
	s := &DashboardService{db: db, now: time.Now, upcomingTimeout: 8 * time.Second}
	if daily != nil {
		s.series = func() (*DailySeries, error) { return daily.GetSeries("1m", "day") }
	}
	if divScore != nil {
		s.upcoming = divScore.GetUpcoming
	}
	if signal != nil {
		s.unread = signal.GetUnreadSignalCount
	}
	if ticker != nil {
		s.fxNow = ticker.FxRateNow
	}
	return s
}

// GetSummary: 칸마다 따로 — 실패한 칸은 null 로 두고 errors 에 남긴다
func (s *DashboardService) GetSummary() *DashboardSummary {
	now := s.now()
	out := &DashboardSummary{AsOf: now.In(kst).Format(time.RFC3339), Errors: map[string]string{}}

	// 예정 배당은 오래 걸릴 수 있어 먼저 시작한다 — 환율은 원화로 바꿀 때(마지막)에야 쓰므로 아래에서 정해질 때까지 기다린다
	var usd float64
	usdReady := make(chan struct{})
	upCh := make(chan upcomingResult, 1) // 시간 한도가 지나도 계산은 끝까지 하고(캐시) 여기 두고 끝난다
	if s.upcoming != nil {
		go func() {
			r, err := s.upcoming(dashboardUpcomingDays, func(ccy string) float64 {
				<-usdReady
				return s.rateFunc(usd)(ccy)
			})
			upCh <- upcomingResult{r, err}
		}()
	}

	if s.series == nil {
		out.Errors["portfolio"] = "일별 총자산을 쓸 수 없음"
	} else if ser, err := s.series(); err != nil {
		out.Errors["portfolio"] = err.Error()
	} else if p, fx := dashboardPortfolio(ser); p == nil {
		out.Errors["portfolio"] = "최근 1개월 일별 총자산 기록이 없음"
	} else {
		out.Portfolio, usd = p, fx
	}
	if usd <= 0 && s.fxNow != nil {
		usd = s.fxNow("USD")
	}
	if !finite(usd) || usd < 0 {
		usd = 0
	}
	if usd > 0 {
		v := usd
		out.UsdKrw = &v
	}
	close(usdReady)
	rate := s.rateFunc(usd)

	if d, err := s.dividends(now, rate); err != nil {
		out.Errors["dividends"] = err.Error()
	} else {
		out.Dividends = d
	}

	if s.unread == nil {
		out.Errors["signals"] = "신호를 쓸 수 없음"
	} else if n, err := s.unread(); err != nil {
		out.Errors["signals"] = err.Error()
	} else {
		out.Signals = &DashboardSignals{UnreadCount: n}
	}

	if s.upcoming == nil {
		out.Errors["upcoming"] = "예정 배당을 쓸 수 없음"
	} else {
		select {
		case r := <-upCh:
			switch {
			case r.err != nil:
				out.Errors["upcoming"] = r.err.Error()
			case out.Dividends != nil:
				n, krw := len(r.res.Items), r.res.TotalExpectedKRW
				out.Dividends.Upcoming30dCount, out.Dividends.Upcoming30dKRW = &n, &krw
				if len(r.res.Warnings) > 0 { // 숫자는 냈지만 일부가 빠졌을 수 있음
					out.Errors["upcoming_warnings"] = strings.Join(r.res.Warnings, " · ")
				}
			}
		case <-time.After(s.upcomingTimeout):
			out.Errors["upcoming"] = fmt.Sprintf("예정 배당 계산이 %d초 안에 끝나지 않아 뺐습니다 (시장 배당 이력을 받는 중 — 잠시 뒤 다시 부르면 캐시로 바로 나옵니다)", int(s.upcomingTimeout.Seconds()))
		}
	}
	return out
}

type upcomingResult struct {
	res *UpcomingDividends
	err error
}

// rateFunc: 통화 1단위의 원화 값 — 원화 1, 달러는 usd(저장된 실측 환율), 그 밖은 지금 시세(모르면 0)
func (s *DashboardService) rateFunc(usd float64) func(string) float64 {
	return func(ccy string) float64 {
		switch {
		case isKRW(ccy) || strings.TrimSpace(ccy) == "":
			return 1
		case isUSD(ccy):
			return usd
		case s.fxNow != nil:
			return s.fxNow(ccy)
		}
		return 0
	}
}

// dashboardPortfolio: 실측 마지막 두 점으로 전일 대비. 실측이 없으면 마지막 점(추정). 두 번째 값은 그 점의 달러 환율.
func dashboardPortfolio(ser *DailySeries) (*DashboardPortfolio, float64) {
	if ser == nil || len(ser.Points) == 0 {
		return nil, 0
	}
	var real []DailyPoint
	for _, p := range ser.Points {
		if !p.Estimated {
			real = append(real, p)
		}
	}
	last, estimated := ser.Points[len(ser.Points)-1], true
	if len(real) > 0 {
		last, estimated = real[len(real)-1], false
	}
	out := &DashboardPortfolio{
		TotalKRW: math.Round(last.TotalKRW), CostKRW: math.Round(last.CostKRW), CashKRW: math.Round(last.CashKRW),
		LastRealDate: ser.LastRealDate, Estimated: estimated,
	}
	if len(real) >= 2 {
		prev := real[len(real)-2]
		ch := math.Round(last.TotalKRW - prev.TotalKRW)
		out.DayChangeKRW = &ch
		if prev.TotalKRW > 0 {
			pct := math.Round((last.TotalKRW/prev.TotalKRW-1)*100*100) / 100
			out.DayChangePct = &pct
		}
	}
	return out, last.UsdKrw
}

// dividends: 받은 배당(is_received) — 오늘 · 이번 달 · 올해 (KST 날짜). 금액은 세후(기록 금액 − 세금 — 예수금·배당 화면과 같다), 원화는 rate.
func (s *DashboardService) dividends(now time.Time, rate func(string) float64) (*DashboardDividends, error) {
	today := todayKST(now)
	day0, _ := parseKSTDate(today)
	yearStart := time.Date(day0.Year(), 1, 1, 0, 0, 0, 0, kst)
	var recs []models.Dividend
	// 날짜를 UTC 자정·KST 자정 어느 쪽으로 저장했든 잡히게 하루씩 넓혀 읽고 KST 날짜로 거른다
	if err := s.db.Where("is_received = ? AND date >= ? AND date < ?", true, yearStart.AddDate(0, 0, -1), day0.AddDate(0, 0, 2)).Find(&recs).Error; err != nil {
		return nil, err
	}
	out := &DashboardDividends{TodayReceived: []DashboardDividend{}}
	year, month := today[:4], today[:7]
	for _, r := range recs {
		d := r.Date.In(kst).Format(dateLayout)
		if d > today || d[:4] != year {
			continue
		}
		krw, ok := dashKRW(r.Amount-r.Tax, r.Currency, rate)
		if !ok {
			continue // 환율을 모르는 통화 — 합계에서 뺀다 (오늘 목록에는 원화 없이 넣는다)
		}
		out.YtdKRW += krw
		if d[:7] == month {
			out.MtdKRW += krw
		}
	}
	var todays []models.Dividend
	for _, r := range recs {
		if r.Date.In(kst).Format(dateLayout) == today {
			todays = append(todays, r)
		}
	}
	out.YtdKRW, out.MtdKRW = math.Round(out.YtdKRW), math.Round(out.MtdKRW)
	if len(todays) == 0 {
		return out, nil
	}
	assetIDs, accIDs := []uint{}, []uint{}
	for _, r := range todays {
		assetIDs, accIDs = append(assetIDs, r.AssetID), append(accIDs, r.AccountID)
	}
	var assets []models.Asset
	var accounts []models.Account
	if err := s.db.Unscoped().Where("id IN ?", assetIDs).Find(&assets).Error; err != nil {
		return nil, err
	}
	if err := s.db.Unscoped().Where("id IN ?", accIDs).Find(&accounts).Error; err != nil {
		return nil, err
	}
	assetBy, accBy := map[uint]models.Asset{}, map[uint]models.Account{}
	for _, a := range assets {
		assetBy[a.ID] = a
	}
	for _, a := range accounts {
		accBy[a.ID] = a
	}
	for _, r := range todays {
		d := DashboardDividend{
			DividendID: r.ID, Ticker: assetBy[r.AssetID].Ticker, AssetName: assetBy[r.AssetID].Name,
			AccountName: accBy[r.AccountID].Name, AccountBroker: accBy[r.AccountID].Broker,
			Amount: math.Round((r.Amount-r.Tax)*100) / 100, Tax: r.Tax, Currency: r.Currency,
		}
		if krw, ok := dashKRW(r.Amount-r.Tax, r.Currency, rate); ok {
			v := math.Round(krw)
			d.AmountKRW = &v
			out.TodayReceivedKRW += v
		}
		out.TodayReceived = append(out.TodayReceived, d)
	}
	return out, nil
}

func dashKRW(amount float64, ccy string, rate func(string) float64) (float64, bool) {
	r := rate(ccy)
	if !finite(r) || r <= 0 || !finite(amount) {
		return 0, false
	}
	return amount * r, true
}
