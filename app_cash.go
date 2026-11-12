package main

import "stock-manager/services"

// 예수금 — 프론트엔드 바인딩 (REST 는 httpapi/cash.go)

func (a *App) GetCashBalances() (interface{}, error) {
	res, fx, err := a.cashService.GetBalances()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"balances": res, "usd_krw": fx}, nil
}

func (a *App) GetAccountCash(accountID uint) (interface{}, error) {
	return a.cashService.GetSummary(accountID)
}

func (a *App) CreateCashEntry(accountID uint, req services.CashEntryRequest) (interface{}, error) {
	return a.cashService.CreateEntry(accountID, req)
}

func (a *App) CreateCashExchange(accountID uint, req services.CashExchangeRequest) (interface{}, error) {
	res, err := a.cashService.CreateExchange(accountID, req)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"entries": res}, nil
}

func (a *App) ReconcileCash(accountID uint, req services.CashReconcileRequest) (interface{}, error) {
	res, err := a.cashService.Reconcile(accountID, req)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"entry": res}, nil
}

func (a *App) DeleteCashEntry(id uint) error {
	return a.cashService.DeleteEntry(id)
}
