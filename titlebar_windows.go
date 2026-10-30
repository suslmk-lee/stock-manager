//go:build windows

package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// 창 제목 표시줄 색을 앱 테마에 맞춘다 (Windows 11 의 DWM 캡션 색 API).
// Windows 10 에서는 캡션 색 지정이 안 되므로 어두운/밝은 제목 표시줄만 맞춘다.

const (
	dwmwaUseImmersiveDarkMode = 20
	dwmwaBorderColor          = 34
	dwmwaCaptionColor         = 35
	dwmwaTextColor            = 36
)

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	dwmapi                       = windows.NewLazySystemDLL("dwmapi.dll")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procGetWindow                = user32.NewProc("GetWindow")
	procDwmSetWindowAttribute    = dwmapi.NewProc("DwmSetWindowAttribute")
)

const gwOwner = 4

// mainWindow 는 이 프로세스의 보이는 최상위 창(소유자 없음)을 찾는다.
func mainWindow() uintptr {
	pid := uint32(os.Getpid())
	var found uintptr
	cb := windows.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var wpid uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&wpid)))
		if wpid != pid {
			return 1
		}
		if visible, _, _ := procIsWindowVisible.Call(hwnd); visible == 0 {
			return 1
		}
		if owner, _, _ := procGetWindow.Call(hwnd, gwOwner); owner != 0 {
			return 1
		}
		found = hwnd
		return 0 // 찾았으면 중단
	})
	procEnumWindows.Call(cb, 0)
	return found
}

// "#RRGGBB" → COLORREF (0x00BBGGRR)
func colorRef(hex string) (uint32, error) {
	h := strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(h) != 6 {
		return 0, fmt.Errorf("invalid color %q", hex)
	}
	v, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid color %q", hex)
	}
	r, g, b := uint32(v>>16)&0xff, uint32(v>>8)&0xff, uint32(v)&0xff
	return b<<16 | g<<8 | r, nil
}

func setDwmAttr(hwnd uintptr, attr uint32, value uint32) error {
	if err := procDwmSetWindowAttribute.Find(); err != nil {
		return err
	}
	hr, _, _ := procDwmSetWindowAttribute.Call(hwnd, uintptr(attr), uintptr(unsafe.Pointer(&value)), unsafe.Sizeof(value))
	if hr != 0 {
		return fmt.Errorf("DwmSetWindowAttribute(%d) failed: 0x%x", attr, hr)
	}
	return nil
}

// SetTitleBarColors 는 제목 표시줄 배경·글자·테두리 색과 어두운 모드 여부를 설정한다 (프론트엔드가 테마 변경 시 호출).
func (a *App) SetTitleBarColors(background, text string, dark bool) error {
	hwnd := mainWindow()
	if hwnd == 0 {
		return fmt.Errorf("main window not found")
	}
	darkFlag := uint32(0)
	if dark {
		darkFlag = 1
	}
	// 최소화/최대화/닫기 버튼 색이 배경에 맞도록 먼저 어두운 모드를 맞춘다 (Windows 10 은 여기까지만 적용)
	_ = setDwmAttr(hwnd, dwmwaUseImmersiveDarkMode, darkFlag)

	bg, err := colorRef(background)
	if err != nil {
		return err
	}
	fg, err := colorRef(text)
	if err != nil {
		return err
	}
	// Windows 11 22000 미만에서는 실패한다 → 어두운 모드만 적용된 상태로 둔다
	if err := setDwmAttr(hwnd, dwmwaCaptionColor, bg); err != nil {
		return nil
	}
	_ = setDwmAttr(hwnd, dwmwaTextColor, fg)
	_ = setDwmAttr(hwnd, dwmwaBorderColor, bg)
	return nil
}
