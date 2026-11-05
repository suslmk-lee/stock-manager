package services

import (
	"fmt"
	"log"
	"math"
	"strings"

	"stock-manager/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UpsertFundamentalSnapshots 는 (날짜, 종목) 기준으로 펀더멘털 스냅샷을 멱등하게 저장한다.
// 값이 하나도 없는 종목(ETF·조회 불가)은 저장하지 않는다.
func UpsertFundamentalSnapshots(db *gorm.DB, date string, tickers map[uint]string, funds map[string]*Fundamentals) error {
	rows := make([]models.FundamentalSnapshot, 0, len(tickers))
	for assetID, tk := range tickers {
		f := funds[strings.ToUpper(strings.TrimSpace(tk))]
		if f.IsEmpty() {
			continue
		}
		rows = append(rows, models.FundamentalSnapshot{
			Date: date, AssetID: assetID, Ticker: strings.ToUpper(tk),
			PER: f.PER, ForwardPER: f.ForwardPER, PBR: f.PBR, EPS: f.EPS, BPS: f.BPS, Source: f.Source,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "date"}, {Name: "asset_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"ticker", "per", "forward_per", "pbr", "eps", "bps", "source", "updated_at"}),
	}).CreateInBatches(&rows, 100).Error
}

// SetFundamentals 는 펀더멘털 서비스를 주입한다 (nil 이면 PER/PBR 지표 없음).
func (s *SignalService) SetFundamentals(f *FundamentalsService) { s.fund = f }

// SetFundamentals 는 펀더멘털 서비스를 주입한다 (nil 이면 일별 펀더멘털 저장 안 함).
func (s *DailySnapshotService) SetFundamentals(f *FundamentalsService) { s.fund = f }

// persistFundamentals 는 신호 리포트에 쓴 펀더멘털을 오늘 날짜로 저장한다 (best effort, 실패는 로그만).
func (s *SignalService) persistFundamentals(date string, tickers map[uint]string, funds map[string]*Fundamentals) {
	defer s.fundPersist.Done()
	if err := UpsertFundamentalSnapshots(s.db, date, tickers, funds); err != nil {
		log.Printf("[Fundamentals] 신호 리포트 저장 실패: %v", err)
	}
}

// captureFundamentals 는 일별 캡처 직후 보유 종목의 펀더멘털을 조회해 저장한다 (best effort).
func (s *DailySnapshotService) captureFundamentals(date string, holdings []models.Holding) {
	if s.fund == nil {
		return
	}
	tickers := map[uint]string{}
	var list []string
	for _, h := range holdings {
		if t := strings.ToUpper(strings.TrimSpace(h.Asset.Ticker)); t != "" {
			tickers[h.AssetID] = t
			list = append(list, t)
		}
	}
	if len(list) == 0 {
		return
	}
	if err := UpsertFundamentalSnapshots(s.db, date, tickers, s.fund.GetMany(list)); err != nil {
		log.Printf("[DailySnapshot] 펀더멘털 저장 실패: %v", err)
	}
}

// validateOscFundamentalRules 는 10단계(RSI/MFI/PER/PBR) 규칙을 검증하고 비어 있는 값(0)을 기본값으로 채운다.
func validateOscFundamentalRules(r *models.SignalRuleConfig) error {
	def := models.DefaultSignalRuleConfig()
	for k, p := range map[string]*float64{
		"rsi_buy_level": &r.RsiBuyLevel, "rsi_sell_level": &r.RsiSellLevel,
		"mfi_buy_level": &r.MfiBuyLevel, "mfi_sell_level": &r.MfiSellLevel,
		"per_buy_max": &r.PerBuyMax, "per_sell_min": &r.PerSellMin,
		"pbr_buy_max": &r.PbrBuyMax, "pbr_sell_min": &r.PbrSellMin,
	} {
		if math.IsNaN(*p) || math.IsInf(*p, 0) {
			return &ErrInvalidSignalRule{fmt.Sprintf("%s must be a finite number", k)}
		}
	}
	for _, c := range []struct {
		name string
		v    *int
		def  int
		min  int
		max  int
	}{
		{"rsi_period", &r.RsiPeriod, def.RsiPeriod, 2, oscMaxPeriod},
		{"mfi_period", &r.MfiPeriod, def.MfiPeriod, 2, oscMaxPeriod},
		{"osc_lookback_days", &r.OscLookbackDays, def.OscLookbackDays, 1, oscMaxLookback},
	} {
		if *c.v == 0 {
			*c.v = c.def
		}
		if *c.v < c.min || *c.v > c.max {
			return &ErrInvalidSignalRule{fmt.Sprintf("%s must be %d..%d", c.name, c.min, c.max)}
		}
	}
	for _, c := range []struct {
		name string
		v    *float64
		def  float64
	}{
		{"rsi_buy_level", &r.RsiBuyLevel, def.RsiBuyLevel}, {"rsi_sell_level", &r.RsiSellLevel, def.RsiSellLevel},
		{"mfi_buy_level", &r.MfiBuyLevel, def.MfiBuyLevel}, {"mfi_sell_level", &r.MfiSellLevel, def.MfiSellLevel},
	} {
		if *c.v == 0 {
			*c.v = c.def
		}
		if *c.v < 1 || *c.v > 99 {
			return &ErrInvalidSignalRule{c.name + " must be 1..99"}
		}
	}
	if r.RsiBuyEnabled && r.RsiSellEnabled && r.RsiSellLevel <= r.RsiBuyLevel {
		return &ErrInvalidSignalRule{"rsi_sell_level must be > rsi_buy_level"}
	}
	if r.MfiBuyEnabled && r.MfiSellEnabled && r.MfiSellLevel <= r.MfiBuyLevel {
		return &ErrInvalidSignalRule{"mfi_sell_level must be > mfi_buy_level"}
	}
	for _, c := range []struct {
		name string
		v    *float64
		def  float64
	}{
		{"per_buy_max", &r.PerBuyMax, def.PerBuyMax}, {"per_sell_min", &r.PerSellMin, def.PerSellMin},
		{"pbr_buy_max", &r.PbrBuyMax, def.PbrBuyMax}, {"pbr_sell_min", &r.PbrSellMin, def.PbrSellMin},
	} {
		if *c.v == 0 {
			*c.v = c.def
		}
		if *c.v < 0 {
			return &ErrInvalidSignalRule{c.name + " must be > 0"}
		}
	}
	return nil
}
