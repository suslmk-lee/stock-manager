package main

import "stock-manager/services"

// GetTodayPicks: 오늘 살 종목 Top 3 (가격 매력 · 매매 신호 · 배당 점수 · 비중 · 예수금)
func (a *App) GetTodayPicks() (*services.TodayPicks, error) {
	return a.todayService.GetTodayPicks()
}

// GetPriceZones: 보유 종목의 사기 좋은 가격 (가장 최근 계산, 가격 매력 높은 순)
func (a *App) GetPriceZones() (*services.PriceZoneList, error) {
	return a.zoneService.GetLatest()
}

// GetPriceZone: 한 종목의 사기 좋은 가격과 최근 30일 기록
func (a *App) GetPriceZone(assetID uint) (*services.PriceZoneDetail, error) {
	return a.zoneService.GetAsset(assetID)
}
