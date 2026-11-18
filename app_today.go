package main

import "stock-manager/services"

// GetTodayPicks: 오늘 살 종목 Top 3 (매매 신호 · 배당 점수 · 비중 · 예수금)
func (a *App) GetTodayPicks() (*services.TodayPicks, error) {
	return a.todayService.GetTodayPicks()
}
