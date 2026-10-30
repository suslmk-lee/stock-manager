//go:build !windows

package main

// SetTitleBarColors 는 Windows 에서만 동작한다 (다른 OS 에서는 아무것도 하지 않음).
func (a *App) SetTitleBarColors(background, text string, dark bool) error {
	return nil
}
