package main

import (
	"stock-manager/models"
	"stock-manager/services"
)

// 부담금 배분(퇴직연금 DC 등)과 펀드 — Wails 바인딩

func (a *App) GetContributionPlans() ([]services.ContributionPlanView, error) {
	return a.contributionService.ListPlans()
}

func (a *App) CreateContributionPlan(req services.ContributionPlanRequest) (*models.ContributionPlan, error) {
	return a.contributionService.CreatePlan(req)
}

func (a *App) UpdateContributionPlan(id uint, req services.ContributionPlanRequest) (*models.ContributionPlan, error) {
	return a.contributionService.UpdatePlan(id, req)
}

func (a *App) DeleteContributionPlan(id uint) error {
	return a.contributionService.DeletePlan(id)
}

func (a *App) GetContributionRounds(id uint) ([]services.ContributionRound, error) {
	return a.contributionService.GetRounds(id)
}

func (a *App) DeleteContributionRound(id uint, date string) error {
	return a.contributionService.DeleteRound(id, date)
}

func (a *App) RunContributions() (*services.ContributionRunResult, error) {
	return a.contributionService.RunDue()
}

// SyncContributionCash: 은행 앱의 현금성자산에 맞춘다 (늘어난 차이는 이자). rate 가 음수면 금리는 그대로.
func (a *App) SyncContributionCash(id uint, balance float64, date string, rate float64) (*services.ContributionCashSync, error) {
	return a.contributionService.SyncCash(id, balance, date, rate)
}

// RecordContributionBuy: 현금성자산으로 따로 산 상품 (ETF 수량·체결가, 펀드 금액)
func (a *App) RecordContributionBuy(id uint, req services.ContributionBuyRequest) (*models.Transaction, error) {
	return a.contributionService.RecordBuy(id, req)
}

func (a *App) CreateFund(name, code string) (*models.Asset, error) {
	return a.fundService.CreateFund(name, code)
}

func (a *App) GetFundPrices(assetID uint) ([]models.FundPrice, error) {
	return a.fundService.Prices(assetID)
}

func (a *App) ReconcileFund(accountID, assetID uint, value float64, date string) (*models.FundPrice, error) {
	return a.fundService.Reconcile(accountID, assetID, value, date)
}

func (a *App) DeleteFundPrice(id uint) error {
	return a.fundService.DeletePrice(id)
}
