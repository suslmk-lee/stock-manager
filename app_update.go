package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"stock-manager/updater"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// appVersion 은 빌드 때 scripts/build-dmg.sh 가 -ldflags "-X main.appVersion=v1.2.3" 으로 넣는다.
// 그냥 wails dev/build 로 만든 빌드는 "dev" 라 업데이트 확인을 하지 않는다.
var appVersion = "dev"

// GetAppVersion 은 앱 버전(git describe 형식)을 돌려준다.
func (a *App) GetAppVersion() string {
	return appVersion
}

// CheckForUpdate 는 GitHub Releases 에서 새 버전이 있는지 확인한다.
func (a *App) CheckForUpdate() (*updater.CheckResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return a.updater.Check(ctx)
}

// InstallUpdate 는 새 버전을 내려받아 설치 준비를 마친 뒤 앱을 종료한다.
// 종료되면 대기 중인 스크립트가 앱을 새 버전으로 바꾸고 다시 연다. 진행 상황은 "update:progress" 이벤트로 알린다.
func (a *App) InstallUpdate() error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	progress := func(p updater.Progress) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "update:progress", p)
		}
	}
	if err := a.updater.Install(ctx, os.Getpid(), progress); err != nil {
		return err
	}
	go func() {
		time.Sleep(500 * time.Millisecond)
		runtime.Quit(a.ctx)
	}()
	return nil
}

// OpenReleasePage 는 릴리스 페이지를 기본 브라우저로 연다 (이 저장소의 GitHub 주소만 허용).
func (a *App) OpenReleasePage(url string) error {
	if !strings.HasPrefix(url, "https://github.com/"+updater.Repo+"/") {
		return errors.New("허용되지 않은 주소입니다")
	}
	runtime.BrowserOpenURL(a.ctx, url)
	return nil
}
