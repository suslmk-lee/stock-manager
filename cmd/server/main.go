package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"

	"stock-manager/database"
	"stock-manager/models"
	"stock-manager/services"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

var (
	accountService      *services.AccountService
	assetService        *services.AssetService
	transactionService  *services.TransactionService
	holdingService      *services.HoldingService
	dividendService     *services.DividendService
	tickerService       *services.TickerService
	exchangeRateService *services.ExchangeRateService
)

func main() {
	godotenv.Load()

	if err := database.InitDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer database.CloseDB()

	initServices()

	if os.Getenv("GIN_MODE") == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := setupRouter()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting API server on :%s...\n", port)
	if err := r.Run("0.0.0.0:" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func initServices() {
	accountService = services.NewAccountService()
	assetService = services.NewAssetService()
	transactionService = services.NewTransactionService()
	holdingService = services.NewHoldingService()
	dividendService = services.NewDividendService()
	tickerService = services.NewTickerService()
	exchangeRateService = services.NewExchangeRateService()
}

func setupRouter() *gin.Engine {
	r := gin.Default()

	corsConfig := cors.DefaultConfig()
	allowedOrigins := os.Getenv("CORS_ORIGINS")
	if allowedOrigins != "" {
		corsConfig.AllowOrigins = strings.Split(allowedOrigins, ",")
	} else {
		corsConfig.AllowAllOrigins = true
	}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(corsConfig))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group("/api")
	api.Use(apiKeyAuthMiddleware())
	api.Use(normalizeJSONKeysMiddleware())
	{
		setupAccountRoutes(api)
		setupAssetRoutes(api)
		setupHoldingRoutes(api)
		setupTransactionRoutes(api)
		setupDividendRoutes(api)
		setupUtilityRoutes(api)
	}

	return r
}

func normalizeJSONKeysMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch:
		default:
			c.Next()
			return
		}

		contentType := strings.ToLower(strings.TrimSpace(c.GetHeader("Content-Type")))
		if contentType == "" || !strings.Contains(contentType, "application/json") {
			c.Next()
			return
		}

		rawBody, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.Next()
			return
		}

		if len(bytes.TrimSpace(rawBody)) == 0 {
			c.Request.Body = io.NopCloser(bytes.NewReader(rawBody))
			c.Next()
			return
		}

		normalizedBody, err := normalizeJSONBodyKeys(rawBody)
		if err != nil {
			// JSON 파싱 실패 시 원본 바디를 복원해 기존 바인딩/에러 흐름을 유지
			c.Request.Body = io.NopCloser(bytes.NewReader(rawBody))
			c.Next()
			return
		}

		c.Request.Body = io.NopCloser(bytes.NewReader(normalizedBody))
		c.Next()
	}
}

func normalizeJSONBodyKeys(body []byte) ([]byte, error) {
	var payload interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	normalized := normalizeJSONValueKeys(payload)
	return json.Marshal(normalized)
}

func normalizeJSONValueKeys(value interface{}) interface{} {
	switch v := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(v))
		for key, item := range v {
			out[toSnakeCaseKey(key)] = normalizeJSONValueKeys(item)
		}
		return out
	case []interface{}:
		for i := range v {
			v[i] = normalizeJSONValueKeys(v[i])
		}
		return v
	default:
		return value
	}
}

func toSnakeCaseKey(input string) string {
	if input == "" {
		return input
	}

	runes := []rune(input)
	var b strings.Builder
	b.Grow(len(input) + 4)

	for i, r := range runes {
		if unicode.IsUpper(r) {
			if i > 0 {
				prev := runes[i-1]
				hasNext := i+1 < len(runes)
				var next rune
				if hasNext {
					next = runes[i+1]
				}

				if unicode.IsLower(prev) || (unicode.IsUpper(prev) && hasNext && unicode.IsLower(next)) {
					b.WriteRune('_')
				}
			}
			b.WriteRune(unicode.ToLower(r))
			continue
		}

		b.WriteRune(r)
	}

	return b.String()
}

func apiKeyAuthMiddleware() gin.HandlerFunc {
	expectedKey := strings.TrimSpace(os.Getenv("API_KEY"))
	if expectedKey == "" {
		log.Println("WARNING: API_KEY is not set; /api endpoints are publicly accessible")
		return func(c *gin.Context) {
			c.Next()
		}
	}

	return func(c *gin.Context) {
		authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
		providedKey := ""

		if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
			providedKey = strings.TrimSpace(authHeader[7:])
		}
		if providedKey == "" {
			providedKey = strings.TrimSpace(c.GetHeader("X-API-Key"))
		}

		if providedKey == "" || providedKey != expectedKey {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		c.Next()
	}
}

// ==========================================
// Accounts
// ==========================================
func setupAccountRoutes(api *gin.RouterGroup) {
	accounts := api.Group("/accounts")
	{
		accounts.GET("", func(c *gin.Context) {
			res, err := accountService.GetAllAccounts()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.GET("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := accountService.GetAccount(uint(id))
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
			res, err := accountService.CreateAccount(services.CreateAccountRequest{
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
			res, err := accountService.UpdateAccount(uint(id), services.UpdateAccountRequest{
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
			if err := accountService.DeleteAccount(uint(id)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "success"})
		})

		accounts.GET("/:id/dividends", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := dividendService.GetDividendsByAccount(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.GET("/:id/holdings", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := holdingService.GetHoldingsByAccount(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		accounts.GET("/:id/transactions", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := transactionService.GetTransactionsByAccount(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})
	}
}

// ==========================================
// Assets
// ==========================================
func setupAssetRoutes(api *gin.RouterGroup) {
	assets := api.Group("/assets")
	{
		assets.GET("", func(c *gin.Context) {
			res, err := assetService.GetAllAssets()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		assets.GET("/ticker/:ticker", func(c *gin.Context) {
			ticker := c.Param("ticker")
			res, err := assetService.GetAssetByTicker(ticker)
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
			res, err := assetService.CreateAsset(services.CreateAssetRequest{
				Ticker:       req.Ticker,
				Name:         req.Name,
				Type:         models.AssetType(req.Type),
				Sector:       req.Sector,
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
				Name   string `json:"name"`
				Type   string `json:"type"`
				Sector string `json:"sector"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			res, err := assetService.UpdateAsset(uint(id), services.UpdateAssetRequest{
				Name:   req.Name,
				Type:   models.AssetType(req.Type),
				Sector: req.Sector,
			})
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		assets.DELETE("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			if err := assetService.DeleteAsset(uint(id)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "success"})
		})

		assets.GET("/:id/transactions", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			res, err := transactionService.GetTransactionsByAsset(uint(id))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})
	}
}

// ==========================================
// Holdings
// ==========================================
func setupHoldingRoutes(api *gin.RouterGroup) {
	holdings := api.Group("/holdings")
	{
		holdings.GET("", func(c *gin.Context) {
			res, err := holdingService.GetAllHoldings()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		holdings.GET("/sector/:sector", func(c *gin.Context) {
			sector := c.Param("sector")
			res, err := holdingService.GetHoldingsBySector(sector)
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
			res, err := holdingService.CreateHolding(req.AccountID, req.AssetID, req.Quantity, req.AveragePrice)
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
			res, err := holdingService.UpdateHolding(uint(id), req.Quantity, req.AveragePrice)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		holdings.DELETE("/:id", func(c *gin.Context) {
			id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
			if err := holdingService.DeleteHolding(uint(id)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "success"})
		})
	}
}

// ==========================================
// Transactions
// ==========================================
func setupTransactionRoutes(api *gin.RouterGroup) {
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
			res, err := transactionService.CreateTransaction(services.CreateTransactionRequest{
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
	}
}

// ==========================================
// Dividends
// ==========================================
func setupDividendRoutes(api *gin.RouterGroup) {
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
			res, err := dividendService.CreateDividend(services.CreateDividendRequest{
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
			res, err := dividendService.UpdateDividend(uint(id), services.CreateDividendRequest{
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
			if err := dividendService.DeleteDividend(uint(id)); err != nil {
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
			res, err := dividendService.GetMonthlyDividends(start, end)
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
			res, err := dividendService.GetMonthlyDividendsByAccount(uint(accountId), start, end)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})

		dividends.GET("/stats", func(c *gin.Context) {
			res, err := dividendService.GetDividendStats()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, res)
		})
	}
}

// ==========================================
// Ticker / Utilities
// ==========================================
func setupUtilityRoutes(api *gin.RouterGroup) {
	api.GET("/ticker/info", func(c *gin.Context) {
		ticker := c.Query("ticker")
		res, err := tickerService.GetTickerInfo(ticker)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/ticker/search", func(c *gin.Context) {
		query := c.Query("query")
		res, err := tickerService.SearchTicker(query)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/ticker/price", func(c *gin.Context) {
		ticker := c.Query("ticker")
		res, err := tickerService.GetCurrentPrice(ticker)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/exchange-rate/usd-krw", func(c *gin.Context) {
		res, err := exchangeRateService.GetUSDToKRW()
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
		res, err := exchangeRateService.ConvertToKRW(amount, currency)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})
}

func parseDate(dateStr string) (time.Time, error) {
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, dateStr); err == nil {
			return t, nil
		}
	}
	return time.Time{}, errors.New("invalid date format")
}
