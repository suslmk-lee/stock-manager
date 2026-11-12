package httpapi

import (
	"errors"
	"net/http"

	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

func cashErrorStatus(err error) int {
	var invalid *services.CashInputError
	if errors.As(err, &invalid) {
		return http.StatusBadRequest
	}
	if errors.Is(err, services.ErrCashNotFound) {
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}

// 예수금: 계좌별 잔액·흐름, 입금·출금·이자, 환전, 잔액 맞추기, 기록 지우기
func registerCashRoutes(api *gin.RouterGroup, s *Services) {
	fail := func(c *gin.Context, err error) {
		c.JSON(cashErrorStatus(err), gin.H{"error": err.Error()})
	}

	api.GET("/cash/balances", func(c *gin.Context) {
		res, fx, err := s.Cash.GetBalances()
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"balances": res, "usd_krw": fx})
	})

	api.GET("/accounts/:id/cash", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		res, err := s.Cash.GetSummary(id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.POST("/accounts/:id/cash", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var req services.CashEntryRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Cash.CreateEntry(id, req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.POST("/accounts/:id/cash/exchange", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var req services.CashExchangeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Cash.CreateExchange(id, req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"entries": res})
	})

	api.POST("/accounts/:id/cash/reconcile", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var req services.CashReconcileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Cash.Reconcile(id, req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"entry": res})
	})

	api.DELETE("/cash-entries/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		if err := s.Cash.DeleteEntry(id); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}
