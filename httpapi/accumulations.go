package httpapi

import (
	"errors"
	"net/http"

	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

func accumulationErrorStatus(err error) int {
	var invalid *services.PlanInputError
	if errors.As(err, &invalid) {
		return http.StatusBadRequest
	}
	if errors.Is(err, services.ErrPlanNotFound) {
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}

// 주식 모으기: 계획 CRUD, 회차 조회·수정, 자동 기록 실행
func registerAccumulationRoutes(api *gin.RouterGroup, s *Services) {
	fail := func(c *gin.Context, err error) {
		c.JSON(accumulationErrorStatus(err), gin.H{"error": err.Error()})
	}

	api.GET("/accumulations", func(c *gin.Context) {
		res, err := s.Accumulation.ListPlans()
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"plans": res})
	})

	api.POST("/accumulations", func(c *gin.Context) {
		var req services.AccumulationPlanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Accumulation.CreatePlan(req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	// 장이 끝난 거래일의 회차를 채운다 (화면을 열 때 호출)
	api.POST("/accumulations/run", func(c *gin.Context) {
		res, err := s.Accumulation.RunDue()
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.PUT("/accumulations/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var req services.AccumulationPlanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Accumulation.UpdatePlan(id, req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.DELETE("/accumulations/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		if err := s.Accumulation.DeletePlan(id); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	api.GET("/accumulations/:id/fills", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		res, err := s.Accumulation.GetFills(id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"fills": res})
	})

	api.PUT("/accumulation-fills/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var req struct {
			Quantity float64 `json:"quantity"`
			Amount   float64 `json:"amount"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := s.Accumulation.UpdateFill(id, req.Quantity, req.Amount); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	api.DELETE("/accumulation-fills/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		if err := s.Accumulation.DeleteFill(id); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}
