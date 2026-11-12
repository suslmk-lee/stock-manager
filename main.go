package main

import (
	"embed"
	"log"
	"stock-manager/database"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// 바인딩 생성(wails build / generate module) 중에는 실제 DB·API 서버를 건드리지 않는다
	if !bindingsMode {
		if err := database.InitDB(); err != nil {
			log.Fatal("Failed to initialize database:", err)
		}
		defer database.CloseDB()
	}

	app := NewApp()

	// 개발용 내장 API 서버 (STOCK_MANAGER_LOCAL_API=1 일 때만, 이 PC 안에서만)
	if !bindingsMode {
		go StartAPIServer(app)
	}

	err := wails.Run(&options.App{
		Title: "Stock Manager",
		// 기본 창: 사이드바 + 목록 + 상세 3단 배치가 넉넉하게 1600×1000 (화면보다 크면 macOS 가 화면에 맞춘다)
		Width:  1600,
		Height: 1000,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// 기본 테마 배경색 — 첫 화면이 그려지기 전 깜빡임을 줄인다 (이후 프론트엔드가 테마에 맞게 제목 표시줄 색을 바꾼다)
		BackgroundColour: &options.RGBA{R: 6, G: 6, B: 7, A: 1},
		Windows: &windows.Options{
			Theme: windows.Dark,
		},
		// macOS: 제목 표시줄을 투명하게 숨기고 화면을 창 맨 위까지 그린다 → 제목 표시줄 자리도 앱 테마 색.
		// 창 단추(빨강·노랑·초록)는 왼쪽 위 사이드바 첫 줄에 놓이고, 그 줄과 상단 바를 잡고 끌어 창을 옮긴다 (--wails-draggable)
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		log.Fatal("Error:", err)
	}
}
