package main

import (
	"log"

	"stock-manager/httpapi"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// StartAPIServer 는 Wails 데스크톱 앱에 내장된 REST API 서버를 기동한다.
// 모바일 브라우저가 데스크톱에 직접 붙을 때 쓰이며, 라우트 정의는
// 클라우드 서버(cmd/server)와 httpapi 패키지를 공유한다.
func StartAPIServer(app *App) {
	r := gin.Default()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(config))

	api := r.Group("/api")
	api.Use(httpapi.NormalizeJSONKeys())
	httpapi.RegisterRoutes(api, app.apiServices())

	log.Println("Starting API server on :8080...")
	if err := r.Run("0.0.0.0:8080"); err != nil {
		log.Printf("Failed to start API server: %v", err)
	}
}
