package main

import (
	"log"
	"os"
	"strings"

	"stock-manager/httpapi"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// localAPIEnv 가 1(또는 true)일 때만 내장 REST API 서버를 띄운다 (.env 에 적어도 된다).
const localAPIEnv = "STOCK_MANAGER_LOCAL_API"

// StartAPIServer 는 데스크톱 앱에 내장된 개발용 REST API 서버다. 기본으로는 띄우지 않는다.
//
// 앱 화면은 Wails 바인딩으로 Go 를 직접 부르고, 모바일·웹은 클라우드 서버(cmd/server, API Key 인증)에 붙으므로
// 이 서버가 필요 없다. 이 서버에는 인증이 없어서, 예전처럼 0.0.0.0 에 열어 두면 같은 네트워크의 다른 기기나
// 브라우저에서 연 아무 웹사이트가 데이터를 읽고 고칠 수 있었다 (앱 잠금도 건너뛴다).
// 웹 화면을 이 PC의 데이터로 개발할 때만 켜고, 그때도 이 PC 안(127.0.0.1)과 localhost 화면에서만 받는다.
func StartAPIServer(app *App) {
	if v := strings.ToLower(strings.TrimSpace(os.Getenv(localAPIEnv))); v != "1" && v != "true" {
		return
	}
	r := gin.Default()

	config := cors.DefaultConfig()
	config.AllowOriginFunc = isLocalOrigin
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(config))

	api := r.Group("/api")
	api.Use(httpapi.NormalizeJSONKeys())
	httpapi.RegisterRoutes(api, app.apiServices())

	log.Println("Starting local dev API server on 127.0.0.1:8080...")
	if err := r.Run("127.0.0.1:8080"); err != nil {
		log.Printf("Failed to start API server: %v", err)
	}
}

// isLocalOrigin: 이 PC에서 띄운 화면(vite 등)만 — localhost.example.com 같은 주소는 받지 않는다
func isLocalOrigin(origin string) bool {
	for _, host := range []string{"http://localhost", "http://127.0.0.1"} {
		if origin == host || strings.HasPrefix(origin, host+":") {
			return true
		}
	}
	return false
}
