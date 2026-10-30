package services

import (
	"fmt"
	"strings"
	"time"

	"stock-manager/models"
)

const (
	candidateMaxScore   = 6
	candidateMinScore   = 3
	candidateYieldPct   = 3.0
	candidateMinPayDays = 4
	candidateMinBuys    = 3
	candidateMaxSoldPct = 0.10
)

var candidateKeywords = []string{
	"배당", "고배당", "dividend", "div", "income", "인컴", "커버드콜", "covered call", "리츠", "reit",
}

var candidateTickers = map[string]bool{
	"SCHD": true, "JEPI": true, "JEPQ": true, "VYM": true, "DGRO": true, "HDV": true, "SPYD": true,
	"DIVO": true, "NOBL": true, "SDY": true, "VIG": true, "O": true, "QYLD": true, "XYLD": true,
}

var candidateSectorWords = []string{"real estate", "부동산", "reit", "utilities", "유틸리티"}

// CandidateReason 은 후보 판단 기준 하나의 결과다.
type CandidateReason struct {
	Code   string `json:"code"`
	Label  string `json:"label"`
	Met    bool   `json:"met"`
	Detail string `json:"detail"`
}

// DividendCandidateInput 은 후보 점수 계산에 쓰는 순수 입력이다.
type DividendCandidateInput struct {
	AssetID uint
	Ticker  string
	Name    string
	Sector  string

	CurrentYieldPct float64
	Dividends12mKRW float64     // 세후 12개월 배당
	DividendDates   []time.Time // 세전 배당 지급일 (전 계좌)
	TrendOK         bool
	TrendChangePct  float64

	Txns []SignalTxnInput
	Now  time.Time
}

// DividendCandidate 는 배당 장기보유 후보 평가 결과다.
type DividendCandidate struct {
	AssetID     uint              `json:"asset_id"`
	Ticker      string            `json:"ticker"`
	Name        string            `json:"name"`
	Score       int               `json:"score"`
	MaxScore    int               `json:"max_score"`
	IsCandidate bool              `json:"is_candidate"`
	Reasons     []CandidateReason `json:"reasons"`
	ProfileID   uint              `json:"profile_id"`
	ProfileName string            `json:"profile_name"`
	HasOverride bool              `json:"has_override"`

	priced     bool // 시세가 있어 신호 평가 가능
	unassigned bool // 배정/오버라이드 없음 (기본 프로필)
}

func candidateInputOf(in SignalAssetInput, item SignalItem, now time.Time) DividendCandidateInput {
	dates := make([]time.Time, 0, len(in.Dividends))
	for _, d := range in.Dividends {
		dates = append(dates, d.Date)
	}
	return DividendCandidateInput{
		AssetID: in.AssetID, Ticker: in.Ticker, Name: in.Name, Sector: in.Sector,
		CurrentYieldPct: item.CurrentYieldPct, Dividends12mKRW: item.Dividends12mKRW,
		DividendDates: dates, TrendOK: item.DividendTrendOK, TrendChangePct: item.DividendChangePct,
		Txns: in.Txns, Now: now,
	}
}

func containsAnyFold(s string, words []string) bool {
	s = strings.ToLower(s)
	for _, w := range words {
		if strings.Contains(s, strings.ToLower(w)) {
			return true
		}
	}
	return false
}

// ScoreDividendCandidate 는 종목이 배당 장기보유 성향인지 6개 기준(각 1점)으로 점수화한다 (순수 함수).
func ScoreDividendCandidate(in DividendCandidateInput) DividendCandidate {
	now := in.Now
	if now.IsZero() {
		now = time.Now()
	}
	reasons := make([]CandidateReason, 0, candidateMaxScore)

	// yield
	reasons = append(reasons, CandidateReason{"yield", "배당수익률 3% 이상",
		in.CurrentYieldPct >= candidateYieldPct, fmt.Sprintf("%.1f%%", in.CurrentYieldPct)})

	// frequency: 최근 365일 KST 기준 서로 다른 지급일 수
	cutoff := now.AddDate(0, 0, -365)
	days := map[string]bool{}
	for _, d := range in.DividendDates {
		if d.Before(cutoff) || d.After(now) {
			continue
		}
		days[d.In(kst).Format("2006-01-02")] = true
	}
	n := len(days)
	detail := fmt.Sprintf("연 %d회", n)
	if n >= 10 {
		detail = fmt.Sprintf("월 %d회", n)
	} else if n >= candidateMinPayDays {
		detail = fmt.Sprintf("분기 %d회", n)
	}
	reasons = append(reasons, CandidateReason{"frequency", "연 4회 이상 배당", n >= candidateMinPayDays, detail})

	// growth
	growthMet := in.TrendOK && in.TrendChangePct > 0
	growthDetail := "-"
	if in.TrendOK {
		growthDetail = fmt.Sprintf("%+.1f%%", in.TrendChangePct)
	}
	reasons = append(reasons, CandidateReason{"growth", "주당배당금 증가", growthMet, growthDetail})

	// keyword
	keyword := containsAnyFold(in.Name, candidateKeywords) || containsAnyFold(in.Ticker, candidateKeywords) ||
		candidateTickers[strings.ToUpper(strings.TrimSpace(in.Ticker))]
	kd := "-"
	if keyword {
		kd = in.Name
	}
	reasons = append(reasons, CandidateReason{"keyword", "배당형 종목명", keyword, kd})

	// sector
	sector := containsAnyFold(in.Sector, candidateSectorWords)
	sd := "-"
	if strings.TrimSpace(in.Sector) != "" {
		sd = in.Sector
	}
	reasons = append(reasons, CandidateReason{"sector", "배당 섹터", sector, sd})

	// pattern: 3회 이상 매수 + 매도 수량이 매수 수량의 10% 이하
	var buys int
	var buyQty, sellQty float64
	for _, tx := range in.Txns {
		switch tx.Type {
		case models.TransactionTypeBuy:
			buys++
			buyQty += tx.Quantity
		case models.TransactionTypeSell:
			sellQty += tx.Quantity
		}
	}
	pattern := buys >= candidateMinBuys && sellQty <= buyQty*candidateMaxSoldPct
	reasons = append(reasons, CandidateReason{"pattern", "적립식 장기보유", pattern, fmt.Sprintf("매수 %d회", buys)})

	score := 0
	for _, r := range reasons {
		if r.Met {
			score++
		}
	}
	return DividendCandidate{
		AssetID: in.AssetID, Ticker: in.Ticker, Name: in.Name,
		Score: score, MaxScore: candidateMaxScore,
		IsCandidate: score >= candidateMinScore && (in.Dividends12mKRW > 0 || keyword),
		Reasons:     reasons,
	}
}

// metReasonLabels 는 충족된 기준의 라벨/코드를 반환한다.
func metReasons(c DividendCandidate) (codes, labels []string) {
	for _, r := range c.Reasons {
		if r.Met {
			codes = append(codes, r.Code)
			labels = append(labels, r.Label)
		}
	}
	return
}
