package httpapi

import (
	"net/http"
	"strconv"

	"stock-manager/models"
	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

func registerAccountRoutes(api *gin.RouterGroup, s *Services) {
	accounts := api.Group("/accounts")
	{
		accounts.GET("", func(c *gin.Context) {
			res, err := s.Account.GetAllAccounts()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.GET("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := s.Account.GetAccount(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.POST("", func(c *gin.Context) {
			var req struct {
				Name          string `json:"name"`
				Broker        string `json:"broker"`
				AccountNumber string `json:"account_number"`
				MarketType    string `json:"market_type"`
				Currency      string `json:"currency"`
				Description   string `json:"description"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			res, err := s.Account.CreateAccount(services.CreateAccountRequest{
				Name:          req.Name,
				Broker:        req.Broker,
				AccountNumber: req.AccountNumber,
				MarketType:    models.MarketType(req.MarketType),
				Currency:      req.Currency,
				Description:   req.Description,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.PUT("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			var req struct {
				Name          string `json:"name"`
				Broker        string `json:"broker"`
				AccountNumber string `json:"account_number"`
				MarketType    string `json:"market_type"`
				Currency      string `json:"currency"`
				Description   string `json:"description"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			res, err := s.Account.UpdateAccount(uint(id), services.UpdateAccountRequest{
				Name:          req.Name,
				Broker:        req.Broker,
				AccountNumber: req.AccountNumber,
				MarketType:    models.MarketType(req.MarketType),
				Currency:      req.Currency,
				Description:   req.Description,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.DELETE("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			if err := s.Account.DeleteAccount(uint(id)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "success"})
		})

		accounts.GET("/:id/dividends", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := s.Dividend.GetDividendsByAccount(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.GET("/:id/holdings", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := s.Holding.GetHoldingsByAccount(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.GET("/:id/transactions", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := s.Transaction.GetTransactionsByAccount(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})
	}
}
