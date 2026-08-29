package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func registerHoldingRoutes(api *gin.RouterGroup, s *Services) {
	holdings := api.Group("/holdings")
	{
		holdings.GET("", func(c *gin.Context) {
			res, err := s.Holding.GetAllHoldings()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		holdings.GET("/sector/:sector", func(c *gin.Context) {
			sector := c.Param("sector")
			res, err := s.Holding.GetHoldingsBySector(sector)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		holdings.POST("", func(c *gin.Context) {
			var req struct {
				AccountID    uint    `json:"account_id"`
				AssetID      uint    `json:"asset_id"`
				Quantity     float64 `json:"quantity"`
				AveragePrice float64 `json:"average_price"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			res, err := s.Holding.CreateHolding(req.AccountID, req.AssetID, req.Quantity, req.AveragePrice)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		holdings.PUT("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			var req struct {
				Quantity     float64 `json:"quantity"`
				AveragePrice float64 `json:"average_price"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			res, err := s.Holding.UpdateHolding(uint(id), req.Quantity, req.AveragePrice)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		holdings.DELETE("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			if err := s.Holding.DeleteHolding(uint(id)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "success"})
		})
	}
}
