package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 오늘 살 종목 Top 3
func registerTodayRoutes(api *gin.RouterGroup, s *Services) {
	api.GET("/today-picks", func(c *gin.Context) {
		if s.Today == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "오늘 살 종목을 계산할 수 없습니다"})
			return
		}
		res, err := s.Today.GetTodayPicks()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})
}
