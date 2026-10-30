package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"stock-manager/models"
	"stock-manager/services"

	"github.com/gin-gonic/gin"
)

func signalErrorStatus(err error) int {
	var invalid *services.ErrInvalidSignalRule
	if errors.As(err, &invalid) {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func registerSignalRoutes(api *gin.RouterGroup, s *Services) {
	api.GET("/signal-rules", func(c *gin.Context) {
		res, err := s.Signal.GetSignalRules()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.PUT("/signal-rules/default", func(c *gin.Context) {
		var rule models.SignalRule
		if err := c.ShouldBindJSON(&rule); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Signal.SaveDefaultRule(rule)
		if err != nil {
			c.JSON(signalErrorStatus(err), gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.PUT("/signal-rules/asset/:assetId", func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("assetId"), 10, 32)
		if err != nil || id == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid asset id"})
			return
		}
		var rule models.SignalRule
		if err := c.ShouldBindJSON(&rule); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Signal.SaveAssetRule(uint(id), rule)
		if err != nil {
			c.JSON(signalErrorStatus(err), gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.DELETE("/signal-rules/asset/:assetId", func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("assetId"), 10, 32)
		if err != nil || id == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid asset id"})
			return
		}
		if err := s.Signal.DeleteAssetRule(uint(id)); err != nil {
			c.JSON(signalErrorStatus(err), gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "success"})
	})

	api.GET("/signals", func(c *gin.Context) {
		res, err := s.Signal.GetSignals()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})
}
