package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// 오늘 살 종목 Top 3 · 사기 좋은 가격
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

	api.GET("/price-zones", func(c *gin.Context) {
		if s.PriceZone == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "사기 좋은 가격을 계산할 수 없습니다"})
			return
		}
		res, err := s.PriceZone.GetLatest()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/price-zones/:assetId", func(c *gin.Context) {
		if s.PriceZone == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "사기 좋은 가격을 계산할 수 없습니다"})
			return
		}
		id, err := strconv.ParseUint(c.Param("assetId"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "잘못된 종목"})
			return
		}
		res, err := s.PriceZone.GetAsset(uint(id))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})
}
