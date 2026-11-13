package main

import (
	"stock-manager/models"
	"stock-manager/services"
)

// 배당 점수: 보유 종목 월별 순위 (매달 1일 기준)

// GetDividendScore: month 는 YYYY-MM (빈칸이면 이번 달)
func (a *App) GetDividendScore(month string) (*services.DivScoreRanking, error) {
	return a.dividendScoreService.GetRanking(month)
}

func (a *App) GetDividendScoreDetail(assetID uint) (*services.DivScoreDetail, error) {
	return a.dividendScoreService.GetDetail(assetID)
}

// RecomputeDividendScore: 그달 점수를 지우고 다시 계산 (거래를 고친 뒤 등)
func (a *App) RecomputeDividendScore(month string) error {
	return a.dividendScoreService.Recompute(month)
}

func (a *App) GetDividendScoreSettings() (models.DividendScoreSetting, error) {
	return a.dividendScoreService.GetSettings()
}

func (a *App) UpdateDividendScoreSettings(setting models.DividendScoreSetting) (models.DividendScoreSetting, error) {
	return a.dividendScoreService.UpdateSettings(setting)
}
