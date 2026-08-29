package httpapi

import (
	"net/http"
	"strconv"

	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

func registerDividendRoutes(api *gin.RouterGroup, s *Services) {
	dividends := api.Group("/dividends")
	{
		dividends.POST("", func(c *gin.Context) {
			var req struct {
				AccountID  uint    `json:"account_id"`
				AssetID    uint    `json:"asset_id"`
				Date       string  `json:"date"`
				Amount     float64 `json:"amount"`
				Tax        float64 `json:"tax"`
				Currency   string  `json:"currency"`
				IsReceived bool    `json:"is_received"`
				Notes      string  `json:"notes"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			parsedDate, err := parseDate(req.Date)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format"})
				return
			}
			res, err := s.Dividend.CreateDividend(services.CreateDividendRequest{
				AccountID:  req.AccountID,
				AssetID:    req.AssetID,
				Date:       parsedDate,
				Amount:     req.Amount,
				Tax:        req.Tax,
				Currency:   req.Currency,
				IsReceived: req.IsReceived,
				Notes:      req.Notes,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		dividends.PUT("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			var req struct {
				AccountID  uint    `json:"account_id"`
				AssetID    uint    `json:"asset_id"`
				Date       string  `json:"date"`
				Amount     float64 `json:"amount"`
				Tax        float64 `json:"tax"`
				Currency   string  `json:"currency"`
				IsReceived bool    `json:"is_received"`
				Notes      string  `json:"notes"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			parsedDate, err := parseDate(req.Date)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date format"})
				return
			}
			res, err := s.Dividend.UpdateDividend(uint(id), services.CreateDividendRequest{
				AccountID:  req.AccountID,
				AssetID:    req.AssetID,
				Date:       parsedDate,
				Amount:     req.Amount,
				Tax:        req.Tax,
				Currency:   req.Currency,
				IsReceived: req.IsReceived,
				Notes:      req.Notes,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		dividends.DELETE("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			if err := s.Dividend.DeleteDividend(uint(id)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "success"})
		})

		dividends.GET("/monthly", func(c *gin.Context) {
			startDate := c.Query("startDate")
			endDate := c.Query("endDate")
			start, err := parseDate(startDate)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid startDate"})
				return
			}
			end, err := parseDate(endDate)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid endDate"})
				return
			}
			res, err := s.Dividend.GetMonthlyDividends(start, end)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		dividends.GET("/monthly/account/:accountId", func(c *gin.Context) {
			accountId, _ := strconv.ParseUint(c.Param("accountId"), 10, 32)
			startDate := c.Query("startDate")
			endDate := c.Query("endDate")
			start, err := parseDate(startDate)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid startDate"})
				return
			}
			end, err := parseDate(endDate)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid endDate"})
				return
			}
			res, err := s.Dividend.GetMonthlyDividendsByAccount(uint(accountId), start, end)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		dividends.GET("/stats", func(c *gin.Context) {
			res, err := s.Dividend.GetDividendStats()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		dividends.GET("/all", func(c *gin.Context) {
			res, err := s.Dividend.GetAllDividends()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})
	}
}
