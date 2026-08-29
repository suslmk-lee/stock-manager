package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"stock-manager/database"
	"stock-manager/httpapi"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// 클라우드(Fly.io) 독립 API 서버.
// 라우트 정의는 데스크톱 내장 서버(server.go)와 httpapi 패키지를 공유하며,
// 이 파일은 클라우드에만 필요한 설정(API Key 인증, CORS 허용 목록, /health)만 담당한다.

var svc *httpapi.Services

func main() {
	godotenv.Load()

	if err := database.InitDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer database.CloseDB()

	svc = httpapi.NewServices()

	// 앱 시작 시 이번 달 스냅샷 자동 기록 (비동기)
	svc.Snapshot.EnsureCurrentMonthSnapshotAsync()

	if os.Getenv("GIN_MODE") == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := setupRouter()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting API server on :%s...\n", port)
	if err := r.Run("0.0.0.0:" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func setupRouter() *gin.Engine {
	r := gin.Default()

	corsConfig := cors.DefaultConfig()
	allowedOrigins := os.Getenv("CORS_ORIGINS")
	if allowedOrigins != "" {
		corsConfig.AllowOrigins = strings.Split(allowedOrigins, ",")
	} else {
		corsConfig.AllowAllOrigins = true
	}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(corsConfig))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group("/api")
	api.Use(apiKeyAuthMiddleware())
	api.Use(httpapi.NormalizeJSONKeys())
	httpapi.RegisterRoutes(api, svc)

	return r
}

func apiKeyAuthMiddleware() gin.HandlerFunc {
	expectedKey := strings.TrimSpace(os.Getenv("API_KEY"))
	if expectedKey == "" {
		log.Println("WARNING: API_KEY is not set; /api endpoints are publicly accessible")
		return func(c *gin.Context) {
			c.Next()
		}
	}

	return func(c *gin.Context) {
		authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
		providedKey := ""

		if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
			providedKey = strings.TrimSpace(authHeader[7:])
		}
		if providedKey == "" {
			providedKey = strings.TrimSpace(c.GetHeader("X-API-Key"))
		}

		if providedKey == "" || providedKey != expectedKey {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		c.Next()
	}
}
