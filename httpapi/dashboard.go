package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 개인 대시보드 요약 (HTTP 전용) — 계좌 총액 · 받은/예정 배당 · 읽지 않은 신호를 한 번에.
// 한 칸이 실패해도 200 으로 내고, 그 칸은 null · errors 에 이유.
func registerDashboardRoutes(api *gin.RouterGroup, s *Services) {
	api.GET("/dashboard/summary", func(c *gin.Context) {
		if s.Dashboard == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "dashboard service unavailable"})
			return
		}
		c.JSON(http.StatusOK, s.Dashboard.GetSummary())
	})
}
