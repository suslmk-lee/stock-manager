package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"stock-manager/models"
	"stock-manager/services"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func profileTestRouter(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.SignalRule{}, &models.SignalProfile{}, &models.AssetSignalProfile{},
		&models.ProfileSuggestion{}, &models.Asset{}, &models.Holding{}, &models.SignalEvent{}); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	s := &Services{Signal: services.NewSignalService(db, nil, nil)}
	api := r.Group("/api")
	registerSignalRoutes(api, s)
	registerSignalProfileRoutes(api, s)
	return r, db
}

func call(r *gin.Engine, method, path string, body interface{}) (int, map[string]interface{}) {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestSignalProfileRoutes(t *testing.T) {
	r, db := profileTestRouter(t)
	a := models.Asset{Ticker: "AAA", Name: "A", Type: models.AssetTypeStock}
	db.Create(&a)

	code, res := call(r, "GET", "/api/signal-profiles", nil)
	profiles, _ := res["profiles"].([]interface{})
	if code != 200 || len(profiles) != 2 {
		t.Fatalf("%d %v", code, res)
	}
	first := profiles[0].(map[string]interface{})
	if first["key"] != "default" || first["built_in"] != true || first["rule"] == nil || first["asset_count"] == nil {
		t.Fatalf("%v", first)
	}
	rule := first["rule"].(map[string]interface{})
	if rule["crash_pct"] != float64(-40) || rule["take_profit_enabled"] != true {
		t.Fatalf("%v", rule)
	}

	code, res = call(r, "POST", "/api/signal-profiles", map[string]interface{}{"name": "내 것", "kind": "standard"})
	if code != 200 {
		t.Fatalf("%d %v", code, res)
	}
	id := int(res["id"].(float64))
	if code, _ = call(r, "POST", "/api/signal-profiles", map[string]interface{}{"name": "", "kind": "standard"}); code != 400 {
		t.Errorf("empty name %d", code)
	}
	if code, _ = call(r, "PUT", "/api/signal-profiles/999", map[string]interface{}{"name": "x"}); code != 404 {
		t.Errorf("missing %d", code)
	}
	if code, _ = call(r, "PUT", "/api/signal-profiles/1", map[string]interface{}{"name": "renamed"}); code != 400 {
		t.Errorf("builtin rename %d", code)
	}
	if code, _ = call(r, "DELETE", "/api/signal-profiles/1", nil); code != 400 {
		t.Errorf("builtin delete %d", code)
	}
	if code, _ = call(r, "POST", "/api/signal-profiles/1/reset", nil); code != 200 {
		t.Errorf("reset %d", code)
	}
	code, res = call(r, "PUT", "/api/signal-profiles/"+itoa(id)+"/assets", map[string]interface{}{"asset_ids": []uint{a.ID}})
	if as, _ := res["assignments"].([]interface{}); code != 200 || len(as) != 1 {
		t.Fatalf("%d %v", code, res)
	}
	if code, _ = call(r, "POST", "/api/signal-profiles/suggestions/"+itoa(int(a.ID))+"/dismiss", nil); code != 200 {
		t.Errorf("dismiss %d", code)
	}
	if code, _ = call(r, "POST", "/api/signal-profiles/suggestions/999/dismiss", nil); code != 404 {
		t.Errorf("dismiss missing %d", code)
	}
	if code, _ = call(r, "DELETE", "/api/signal-profiles/"+itoa(id), nil); code != 200 {
		t.Errorf("delete %d", code)
	}

	// 레거시 default 규칙 엔드포인트
	code, res = call(r, "GET", "/api/signal-rules", nil)
	def, _ := res["default"].(map[string]interface{})
	if code != 200 || def["asset_id"] != float64(0) || def["rule_version"] != float64(models.SignalRuleVersion) || def["crash_pct"] != float64(-40) {
		t.Fatalf("%d %v", code, res)
	}
	def["take_profit_pct"] = 61
	if code, _ = call(r, "PUT", "/api/signal-rules/default", def); code != 200 {
		t.Fatalf("put default %d", code)
	}
	_, res = call(r, "GET", "/api/signal-profiles", nil)
	got := res["profiles"].([]interface{})[0].(map[string]interface{})["rule"].(map[string]interface{})
	if got["take_profit_pct"] != float64(61) {
		t.Errorf("default profile not updated: %v", got)
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
