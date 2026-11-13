package httpapi

import (
	"errors"
	"net/http"

	"stock-manager/models"
	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

// 배당 점수: 보유 종목 월별 순위(매달 1일 기준), 종목 상세, 다시 계산, 배점 설정
func registerDividendScoreRoutes(api *gin.RouterGroup, s *Services) {
	fail := func(c *gin.Context, err error) {
		status := http.StatusInternalServerError
		var invalid *services.ErrDivScoreInput
		if errors.As(err, &invalid) {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
	}

	api.GET("/dividend-score", func(c *gin.Context) {
		res, err := s.DividendScore.GetRanking(c.Query("month"))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/dividend-score/assets/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		res, err := s.DividendScore.GetDetail(id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.POST("/dividend-score/recompute", func(c *gin.Context) {
		var req struct {
			Month string `json:"month"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := s.DividendScore.Recompute(req.Month); err != nil {
			fail(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})

	api.GET("/dividend-score/settings", func(c *gin.Context) {
		res, err := s.DividendScore.GetSettings()
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.PUT("/dividend-score/settings", func(c *gin.Context) {
		var req models.DividendScoreSetting
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.DividendScore.UpdateSettings(req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})
}
