package httpapi

import (
	"net/http"
	"strconv"

	"stock-manager/models"
	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

func registerTransactionRoutes(api *gin.RouterGroup, s *Services) {
	transactions := api.Group("/transactions")
	{
		transactions.POST("", func(c *gin.Context) {
			var req struct {
				AccountID uint    `json:"account_id"`
				AssetID   uint    `json:"asset_id"`
				Type      string  `json:"type"`
				Date      string  `json:"date"`
				Price     float64 `json:"price"`
				Quantity  float64 `json:"quantity"`
				Fee       float64 `json:"fee"`
				Notes     string  `json:"notes"`
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
			res, err := s.Transaction.CreateTransaction(services.CreateTransactionRequest{
				AccountID: req.AccountID,
				AssetID:   req.AssetID,
				Type:      models.TransactionType(req.Type),
				Date:      parsedDate,
				Price:     req.Price,
				Quantity:  req.Quantity,
				Fee:       req.Fee,
				Notes:     req.Notes,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		transactions.PUT("/:id", func(c *gin.Context) {
			id, err := strconv.ParseUint(c.Param("id"), 10, 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
				return
			}
			var req struct {
				Type     string  `json:"type"`
				Date     string  `json:"date"`
				Price    float64 `json:"price"`
				Quantity float64 `json:"quantity"`
				Fee      float64 `json:"fee"`
				Notes    string  `json:"notes"`
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
			res, err := s.Transaction.UpdateTransaction(uint(id), services.CreateTransactionRequest{
				Type:     models.TransactionType(req.Type),
				Date:     parsedDate,
				Price:    req.Price,
				Quantity: req.Quantity,
				Fee:      req.Fee,
				Notes:    req.Notes,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		transactions.DELETE("/:id", func(c *gin.Context) {
			id, err := strconv.ParseUint(c.Param("id"), 10, 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
				return
			}
			if err := s.Transaction.DeleteTransaction(uint(id)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"success": true})
		})
	}
}
