package main

import "stock-manager/services"

// 주식 모으기 — 프론트엔드 바인딩 (REST 는 httpapi/accumulations.go)

func (a *App) GetAccumulationPlans() (interface{}, error) {
	plans, err := a.accumulationService.ListPlans()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"plans": plans}, nil
}

func (a *App) CreateAccumulationPlan(req services.AccumulationPlanRequest) (interface{}, error) {
	return a.accumulationService.CreatePlan(req)
}

func (a *App) UpdateAccumulationPlan(id uint, req services.AccumulationPlanRequest) (interface{}, error) {
	return a.accumulationService.UpdatePlan(id, req)
}

func (a *App) DeleteAccumulationPlan(id uint) error {
	return a.accumulationService.DeletePlan(id)
}

func (a *App) GetAccumulationFills(id uint) (interface{}, error) {
	fills, err := a.accumulationService.GetFills(id)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"fills": fills}, nil
}

func (a *App) UpdateAccumulationFill(txID uint, quantity, amount float64) error {
	return a.accumulationService.UpdateFill(txID, quantity, amount)
}

func (a *App) DeleteAccumulationFill(txID uint) error {
	return a.accumulationService.DeleteFill(txID)
}

func (a *App) RunAccumulations() (interface{}, error) {
	return a.accumulationService.RunDue()
}
