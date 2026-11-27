package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"stock-manager/database"
	"stock-manager/httpapi"
	"stock-manager/services"

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

	// 일별 총자산: 오늘 실측 보장 + 2년 추정 백필 (비동기)
	svc.DailySnap.EnsureTodayAsync()
	svc.DailySnap.BackfillAsync(services.DefaultBackfillDays)

	// 주식 모으기 자동 기록 (데스크톱 앱과 같은 DB — 같은 날은 한 건만 남는다)
	go svc.Accumulation.RunEvery(context.Background(), 4*time.Hour)

	// 부담금 배분(퇴직연금) 자동 기록 (같은 회차는 한 번만 남는다)
	go svc.Contribution.RunEvery(context.Background(), 4*time.Hour)

	// 사기 좋은 가격: 보유 종목 가격대를 날짜별로 계산해 둔다 (앱과 같은 DB — 새 기록이 있으면 건너뜀, 30일 지난 기록은 지움)
	go svc.PriceZone.RunEvery(context.Background(), time.Minute, time.Hour)

	// 오늘 살 종목: 한 번 계산해 둔다 (웹에서 처음 열 때 기다리지 않게)
	go svc.Today.WarmAfter(context.Background(), 45*time.Second)

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
	return apiKeyAuth(strings.TrimSpace(os.Getenv("API_KEY")), strings.TrimSpace(os.Getenv("API_KEY_READONLY")))
}

// apiKeyAuth — fullKey(API_KEY)는 모든 요청을, readOnlyKey(API_KEY_READONLY)는 GET·HEAD 만 허용한다.
// fullKey 가 비어 있으면 지금처럼 공개로 둔다(읽기 전용 키만 있는 설정도 쓰기까지 공개이므로 경고한다).
func apiKeyAuth(fullKey, readOnlyKey string) gin.HandlerFunc {
	if fullKey == "" {
		if readOnlyKey != "" {
			log.Println("WARNING: API_KEY_READONLY is set but API_KEY is not; /api endpoints (including writes) are publicly accessible")
		} else {
			log.Println("WARNING: API_KEY is not set; /api endpoints are publicly accessible")
		}
		return func(c *gin.Context) {
			c.Next()
		}
	}

	return func(c *gin.Context) {
		provided := providedAPIKey(c)
		switch {
		case keyMatches(provided, fullKey):
			c.Next()
		case readOnlyKey != "" && keyMatches(provided, readOnlyKey):
			if m := c.Request.Method; m != http.MethodGet && m != http.MethodHead {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "read-only key"})
				return
			}
			c.Next()
		default:
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		}
	}
}

// providedAPIKey — Authorization: Bearer <키>, 없으면 X-API-Key
func providedAPIKey(c *gin.Context) string {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		if k := strings.TrimSpace(authHeader[7:]); k != "" {
			return k
		}
	}
	return strings.TrimSpace(c.GetHeader("X-API-Key"))
}

// keyMatches — 길이가 달라도 시간이 새지 않게 해시를 상수 시간으로 비교한다
func keyMatches(provided, expected string) bool {
	if provided == "" || expected == "" {
		return false
	}
	a, b := sha256.Sum256([]byte(provided)), sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}
