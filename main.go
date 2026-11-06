package main

import (
	"embed"
	"log"
	"stock-manager/database"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
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

	// 백그라운드에서 API 서버 실행
	if !bindingsMode {
		go StartAPIServer(app)
	}

	err := wails.Run(&options.App{
		Title:  "Stock Manager",
		// 기본 창: 사이드바 + 목록 + 상세 3단 배치를 기준으로 1440×900
		Width:  1440,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// 기본 테마 배경색 — 첫 화면이 그려지기 전 깜빡임을 줄인다 (이후 프론트엔드가 테마에 맞게 제목 표시줄 색을 바꾼다)
		BackgroundColour: &options.RGBA{R: 6, G: 6, B: 7, A: 1},
		Windows: &windows.Options{
			Theme: windows.Dark,
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
