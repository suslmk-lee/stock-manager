package httpapi

import (
	"net/http"
	"strconv"

	"stock-manager/models"
	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

func registerAssetRoutes(api *gin.RouterGroup, s *Services) {
	assets := api.Group("/assets")
	{
		assets.GET("", func(c *gin.Context) {
			res, err := s.Asset.GetAllAssets()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		assets.GET("/ticker/:ticker", func(c *gin.Context) {
			ticker := c.Param("ticker")
			res, err := s.Asset.GetAssetByTicker(ticker)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		assets.POST("", func(c *gin.Context) {
			var req struct {
				Ticker       string  `json:"ticker"`
				Name         string  `json:"name"`
				Type         string  `json:"type"`
				Sector       string  `json:"sector"`
				LogoURL      string  `json:"logo_url"`
				AccountID    uint    `json:"account_id"`
				Quantity     float64 `json:"quantity"`
				AveragePrice float64 `json:"average_price"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			res, err := s.Asset.CreateAsset(services.CreateAssetRequest{
				Ticker:       req.Ticker,
				Name:         req.Name,
				Type:         models.AssetType(req.Type),
				Sector:       req.Sector,
				LogoURL:      req.LogoURL,
				AccountID:    req.AccountID,
				Quantity:     req.Quantity,
				AveragePrice: req.AveragePrice,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		assets.PUT("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			var req struct {
				Name    string `json:"name"`
				Type    string `json:"type"`
				Sector  string `json:"sector"`
				LogoURL string `json:"logo_url"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			res, err := s.Asset.UpdateAsset(uint(id), services.UpdateAssetRequest{
				Name:    req.Name,
				Type:    models.AssetType(req.Type),
				Sector:  req.Sector,
				LogoURL: req.LogoURL,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		assets.DELETE("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			if err := s.Asset.DeleteAsset(uint(id)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "success"})
		})

		assets.GET("/:id/transactions", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := s.Transaction.GetTransactionsByAsset(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})
	}
}
