package httpapi

import (
	"net/http"
	"strconv"

	"stock-manager/models"

	"github.com/gin-gonic/gin"
)

func registerSignalEventRoutes(api *gin.RouterGroup, s *Services) {
	api.GET("/signal-events", func(c *gin.Context) {
		limit := 50
		if v := c.Query("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
				return
			}
			limit = n
		}
		unreadOnly := c.Query("unread_only") == "true"
		events, unread, err := s.Signal.GetSignalEvents(limit, unreadOnly)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"events": events, "unread_count": unread})
	})

	api.POST("/signal-events/read", func(c *gin.Context) {
		var body struct {
			IDs []uint `json:"ids"`
			All bool   `json:"all"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		unread, err := s.Signal.MarkSignalEventsRead(body.IDs, body.All)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"unread_count": unread})
	})

	api.GET("/signal-events/unread-count", func(c *gin.Context) {
		unread, err := s.Signal.GetUnreadSignalCount()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"unread_count": unread})
	})

	api.POST("/signals/check", func(c *gin.Context) {
		events, unread, err := s.Signal.CheckSignals()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"new_events": events, "unread_count": unread})
	})

	api.GET("/notification-settings", func(c *gin.Context) {
		res, err := s.Signal.GetNotificationSettings()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})

	api.PUT("/notification-settings", func(c *gin.Context) {
		var in models.NotificationSetting
		if err := c.ShouldBindJSON(&in); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		res, err := s.Signal.SaveNotificationSettings(in)
		if err != nil {
			c.JSON(signalErrorStatus(err), gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	})
}
