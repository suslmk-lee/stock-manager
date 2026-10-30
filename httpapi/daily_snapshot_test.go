package httpapi

import (
	"testing"

	"stock-manager/models"
	"stock-manager/services"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestDailySnapshotRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Account{}, &models.Asset{}, &models.Holding{}, &models.Transaction{},
		&models.Dividend{}, &models.DailyAssetSnapshot{}, &models.DailyPositionSnapshot{}); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	api := r.Group("/api")
	registerUtilityRoutes(api, &Services{DailySnap: services.NewDailySnapshotService(db, nil)})

	if code, _ := call(r, "POST", "/api/snapshots/daily/capture?source=evil", nil); code != 400 {
		t.Fatalf("code=%d", code)
	}
	code, body := call(r, "POST", "/api/snapshots/daily/capture?source=cron", nil)
	if code != 200 || body["snapshot"] == nil {
		t.Fatalf("code=%d body=%v", code, body)
	}
	code, body = call(r, "GET", "/api/snapshots/daily?range=1y&interval=auto", nil)
	pts, _ := body["points"].([]interface{})
	if code != 200 || len(pts) != 1 || body["interval"] != "week" {
		t.Fatalf("code=%d body=%v", code, body)
	}
	if code, _ := call(r, "GET", "/api/snapshots/daily?range=bad", nil); code != 400 {
		t.Fatalf("code=%d", code)
	}
}
