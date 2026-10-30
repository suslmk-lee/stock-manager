package httpapi

import (
	"net/http"
	"strconv"

	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

func parseProfileID(c *gin.Context, name string) (uint, bool) {
	id, err := strconv.ParseUint(c.Param(name), 10, 32)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid " + name})
		return 0, false
	}
	return uint(id), true
}

func registerSignalProfileRoutes(api *gin.RouterGroup, s *Services) {
	fail := func(c *gin.Context, err error) {
		c.JSON(signalErrorStatus(err), gin.H{"error": err.Error()})
	}

	api.GET("/signal-profiles", func(c *gin.Context) {
		res, err := s.Signal.GetSignalProfiles()
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.POST("/signal-profiles", func(c *gin.Context) {
		var req services.CreateSignalProfileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Signal.CreateSignalProfile(req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.GET("/signal-profiles/candidates", func(c *gin.Context) {
		res, err := s.Signal.GetProfileCandidates()
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"candidates": res})
	})

	api.POST("/signal-profiles/suggestions/:assetId/dismiss", func(c *gin.Context) {
		id, ok := parseProfileID(c, "assetId")
		if !ok {
			return
		}
		if err := s.Signal.DismissProfileSuggestion(id); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	})

	api.PUT("/signal-profiles/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var req services.UpdateSignalProfileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Signal.UpdateSignalProfile(id, req)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.DELETE("/signal-profiles/:id", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		if err := s.Signal.DeleteSignalProfile(id); err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	})

	api.POST("/signal-profiles/:id/reset", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		res, err := s.Signal.ResetSignalProfile(id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.PUT("/signal-profiles/:id/assets", func(c *gin.Context) {
		id, ok := parseProfileID(c, "id")
		if !ok {
			return
		}
		var body struct {
			AssetIDs []uint `json:"asset_ids"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Signal.AssignSignalProfile(id, body.AssetIDs)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"assignments": res})
	})
}
