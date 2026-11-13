package httpapi

import (
	"net/http"

	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

// 부담금 배분(퇴직연금 DC 등)과 펀드(기준가·평가금액 맞추기)
func registerContributionRoutes(api *gin.RouterGroup, s *Services) {
	fail := func(c *gin.Context, err error) {
		c.JSON(accumulationErrorStatus(err), gin.H{"error": err.Error()})
	}

	api.GET("/contribution-plans", func(c *gin.Context) {
		res, err := s.Contribution.ListPlans()
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"plans": res})
	})

	api.POST("/contribution-plans", func(c *gin.Context) {
		var req services.ContributionPlanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Contribution.CreatePlan(req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	// 지난 납입일 회차를 채운다 (화면을 열 때 호출)
	api.POST("/contribution-plans/run", func(c *gin.Context) {
		res, err := s.Contribution.RunDue()
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.PUT("/contribution-plans/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var req services.ContributionPlanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Contribution.UpdatePlan(id, req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.DELETE("/contribution-plans/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		if err := s.Contribution.DeletePlan(id); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	api.GET("/contribution-plans/:id/rounds", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		res, err := s.Contribution.GetRounds(id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"rounds": res})
	})

	api.DELETE("/contribution-plans/:id/rounds/:date", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		if err := s.Contribution.DeleteRound(id, c.Param("date")); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// 펀드
	api.POST("/funds", func(c *gin.Context) {
		var req struct {
			Name string `json:"name"`
			Code string `json:"code"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Fund.CreateFund(req.Name, req.Code)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/funds/:id/prices", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		res, err := s.Fund.Prices(id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"prices": res})
	})

	// 은행 앱의 평가금액으로 그날 기준가를 맞춘다
	api.POST("/funds/:id/reconcile", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var req struct {
			AccountID uint    `json:"account_id"`
			Value     float64 `json:"value"`
			Date      string  `json:"date"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Fund.Reconcile(req.AccountID, id, req.Value, req.Date)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.DELETE("/fund-prices/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		if err := s.Fund.DeletePrice(id); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}
