package main

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func StartAPIServer(app *App) {
	r := gin.Default()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(config))

	api := r.Group("/api")
	{
		// ==========================================
		// Accounts
		// ==========================================
		accounts := api.Group("/accounts")
		{
			accounts.GET("", func(c *gin.Context) {
				res, err := app.GetAllAccounts()
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			accounts.GET("/:id", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				res, err := app.GetAccount(uint(id))
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
				res, err := app.CreateAccount(req.Name, req.Broker, req.AccountNumber, req.MarketType, req.Currency, req.Description)
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
				res, err := app.UpdateAccount(uint(id), req.Name, req.Broker, req.AccountNumber, req.MarketType, req.Currency, req.Description)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			accounts.DELETE("/:id", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				if err := app.DeleteAccount(uint(id)); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, gin.H{"status": "success"})
			})

			accounts.GET("/:id/dividends", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				res, err := app.GetDividendsByAccount(uint(id))
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			accounts.GET("/:id/holdings", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				res, err := app.GetHoldingsByAccount(uint(id))
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			accounts.GET("/:id/transactions", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				res, err := app.GetTransactionsByAccount(uint(id))
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})
		}

		// ==========================================
		// Assets
		// ==========================================
		assets := api.Group("/assets")
		{
			assets.GET("", func(c *gin.Context) {
				res, err := app.GetAllAssets()
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			assets.GET("/ticker/:ticker", func(c *gin.Context) {
				ticker := c.Param("ticker")
				res, err := app.GetAssetByTicker(ticker)
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
					AccountID    uint    `json:"account_id"`
					Quantity     float64 `json:"quantity"`
					AveragePrice float64 `json:"average_price"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				res, err := app.CreateAsset(req.Ticker, req.Name, req.Type, req.Sector, req.AccountID, req.Quantity, req.AveragePrice)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			assets.PUT("/:id", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				var req struct {
					Name   string `json:"name"`
					Type   string `json:"type"`
					Sector string `json:"sector"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
					return
				}
				res, err := app.UpdateAsset(uint(id), req.Name, req.Type, req.Sector)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			assets.DELETE("/:id", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				if err := app.DeleteAsset(uint(id)); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, gin.H{"status": "success"})
			})

			assets.GET("/:id/transactions", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				res, err := app.GetTransactionsByAsset(uint(id))
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})
		}

		// ==========================================
		// Holdings
		// ==========================================
		holdings := api.Group("/holdings")
		{
			holdings.GET("", func(c *gin.Context) {
				res, err := app.GetAllHoldings()
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			holdings.GET("/sector/:sector", func(c *gin.Context) {
				sector := c.Param("sector")
				res, err := app.GetHoldingsBySector(sector)
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
				res, err := app.CreateHolding(req.AccountID, req.AssetID, req.Quantity, req.AveragePrice)
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
				res, err := app.UpdateHolding(uint(id), req.Quantity, req.AveragePrice)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			holdings.DELETE("/:id", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				if err := app.DeleteHolding(uint(id)); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, gin.H{"status": "success"})
			})
		}

		// ==========================================
		// Transactions
		// ==========================================
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
				res, err := app.CreateTransaction(req.AccountID, req.AssetID, req.Type, req.Date, req.Price, req.Quantity, req.Fee, req.Notes)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})
		}

		// ==========================================
		// Dividends
		// ==========================================
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
				res, err := app.CreateDividend(req.AccountID, req.AssetID, req.Date, req.Amount, req.Tax, req.Currency, req.IsReceived, req.Notes)
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
				res, err := app.UpdateDividend(uint(id), req.AccountID, req.AssetID, req.Date, req.Amount, req.Tax, req.Currency, req.IsReceived, req.Notes)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			dividends.DELETE("/:id", func(c *gin.Context) {
				id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
				if err := app.DeleteDividend(uint(id)); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, gin.H{"status": "success"})
			})

			dividends.GET("/monthly", func(c *gin.Context) {
				startDate := c.Query("startDate")
				endDate := c.Query("endDate")
				res, err := app.GetMonthlyDividends(startDate, endDate)
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
				res, err := app.GetMonthlyDividendsByAccount(uint(accountId), startDate, endDate)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})

			dividends.GET("/stats", func(c *gin.Context) {
				res, err := app.GetDividendStats()
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
					return
				}
				c.JSON(http.StatusOK, res)
			})
		}

		// ==========================================
		// Ticker / Utilities
		// ==========================================
		api.GET("/ticker/info", func(c *gin.Context) {
			ticker := c.Query("ticker")
			res, err := app.GetTickerInfo(ticker)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		api.GET("/ticker/search", func(c *gin.Context) {
			query := c.Query("query")
			res, err := app.SearchTicker(query)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		api.GET("/ticker/price", func(c *gin.Context) {
			ticker := c.Query("ticker")
			res, err := app.GetCurrentPrice(ticker)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		api.GET("/exchange-rate/usd-krw", func(c *gin.Context) {
			res, err := app.GetUSDToKRW()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		api.GET("/exchange-rate/convert", func(c *gin.Context) {
			amountStr := c.Query("amount")
			currency := c.Query("currency")
			amount, _ := strconv.ParseFloat(amountStr, 64)
			res, err := app.ConvertToKRW(amount, currency)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})
	}

	log.Println("Starting API server on :8080...")
	if err := r.Run("0.0.0.0:8080"); err != nil {
		log.Printf("Failed to start API server: %v", err)
	}
}
