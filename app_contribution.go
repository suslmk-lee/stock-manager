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
