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

// CheckBuyCash: 이 매수를 기록하면 그날 예수금이 모자라는지 (매수 기록 창에서 입금도 같이 기록할 때)
func (a *App) CheckBuyCash(accountID uint, req services.BuyCashRequest) (*services.BuyCashCheck, error) {
	return a.cashService.CheckBuy(accountID, req)
}

func (a *App) DeleteCashEntry(id uint) error {
	return a.cashService.DeleteEntry(id)
}
