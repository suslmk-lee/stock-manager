package main

import "stock-manager/services"

// 앱 잠금 (PC마다 따로 6자리 PIN) — 화면은 이 상태가 unlocked 가 되기 전에는 데이터를 불러오지 않는다.

// GetLockStatus: 앱을 켤 때. 이 PC를 기억해 두었으면 바로 unlocked.
func (a *App) GetLockStatus() (services.LockStatus, error) {
	return a.lockService.Status()
}

// LockSetupResult: 처음 PIN을 만들 때 — 복구 코드는 이때 한 번만 보여 준다
type LockSetupResult struct {
	Status       services.LockStatus `json:"status"`
	RecoveryCode string              `json:"recovery_code"`
}

func (a *App) SetupLock(pin string, remember bool) (LockSetupResult, error) {
	code, st, err := a.lockService.Setup(pin, remember)
	if err != nil {
		return LockSetupResult{}, err
	}
	return LockSetupResult{Status: st, RecoveryCode: code}, nil
}

// UnlockApp: 틀리면 State=locked 에 Error·Remaining·RetryAfter 를 담아 돌려준다
func (a *App) UnlockApp(pin string, remember bool) (services.LockStatus, error) {
	return a.lockService.Unlock(pin, remember)
}

// RecoverLock: 복구 코드로 새 PIN을 정하고 연다
func (a *App) RecoverLock(code, newPIN string, remember bool) (services.LockStatus, error) {
	return a.lockService.Recover(code, newPIN, remember)
}

func (a *App) ChangeLockPIN(current, newPIN string) error {
	return a.lockService.ChangePIN(current, newPIN)
}

// SetLockTrusted: 이 PC 기억하기 켜고 끄기
func (a *App) SetLockTrusted(trusted bool) (services.LockStatus, error) {
	return a.lockService.SetTrusted(trusted)
}

// NewLockRecoveryCode: PIN을 확인하고 복구 코드를 새로 만든다
func (a *App) NewLockRecoveryCode(pin string) (string, error) {
	return a.lockService.NewRecoveryCode(pin)
}
