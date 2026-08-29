package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func registerUtilityRoutes(api *gin.RouterGroup, s *Services) {
	api.GET("/ticker/info", func(c *gin.Context) {
		ticker := c.Query("ticker")
		res, err := s.Ticker.GetTickerInfo(ticker)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/ticker/search", func(c *gin.Context) {
		query := c.Query("query")
		res, err := s.Ticker.SearchTicker(query)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/ticker/price", func(c *gin.Context) {
		ticker := c.Query("ticker")
		res, err := s.Ticker.GetCurrentPrice(ticker)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/ticker/prices", func(c *gin.Context) {
		tickersParam := c.Query("tickers")
		if tickersParam == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tickers parameter is required"})
			return
		}
		tickers := strings.Split(tickersParam, ",")
		res := s.Ticker.GetCurrentPrices(tickers)
		c.JSON(http.StatusOK, res)
	})

	api.GET("/ticker/history", func(c *gin.Context) {
		ticker := c.Query("ticker")
		res, err := s.Ticker.GetPriceHistory(ticker, c.Query("range"), c.Query("interval"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/exchange-rate/usd-krw", func(c *gin.Context) {
		res, err := s.ExchangeRate.GetUSDToKRW()
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
		res, err := s.ExchangeRate.ConvertToKRW(amount, currency)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	// ==========================================
	// Portfolio Snapshots
	// ==========================================
	api.POST("/snapshots/ensure", func(c *gin.Context) {
		created, err := s.Snapshot.EnsureCurrentMonthSnapshot()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"created": created})
	})

	api.GET("/snapshots/account/:id", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		res, err := s.Snapshot.GetSnapshotsByAccount(uint(id))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/snapshots/account/:id/monthly", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		res, err := s.Snapshot.GetMonthlyTotalByAccount(uint(id))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/snapshots/asset/:id", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		res, err := s.Snapshot.GetSnapshotsByAsset(uint(id))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	// ==========================================
	// Realized P&L
	// ==========================================
	api.GET("/realized-pnl", func(c *gin.Context) {
		res, err := s.RealizedPnL.GetAll()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/realized-pnl/account/:id", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		res, err := s.RealizedPnL.GetByAccount(uint(id))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/realized-pnl/asset/:id", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		res, err := s.RealizedPnL.GetByAsset(uint(id))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/realized-pnl/summary", func(c *gin.Context) {
		res, err := s.RealizedPnL.GetSummary()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})
}
