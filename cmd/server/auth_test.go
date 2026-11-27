package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 전체 키는 모두, 읽기 전용 키는 GET·HEAD 만, 그 밖의 키는 401. 키를 하나도 두지 않으면 공개.
func TestAPIKeyAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const full, ro = "full-key", "read-only-key"

	newRouter := func(fullKey, roKey string) *gin.Engine {
		r := gin.New()
		g := r.Group("/api")
		g.Use(apiKeyAuth(fullKey, roKey))
		ok := func(c *gin.Context) { c.Status(http.StatusOK) }
		for _, m := range []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodDelete} {
			g.Handle(m, "/x", ok)
		}
		return r
	}

	cases := []struct {
		name          string
		fullKey, roKy string
		header, value string
		method        string
		want          int
	}{
		{"전체 키 GET", full, ro, "Authorization", "Bearer " + full, http.MethodGet, 200},
		{"전체 키 POST", full, ro, "Authorization", "Bearer " + full, http.MethodPost, 200},
		{"전체 키 X-API-Key DELETE", full, ro, "X-API-Key", full, http.MethodDelete, 200},
		{"읽기 전용 GET", full, ro, "Authorization", "Bearer " + ro, http.MethodGet, 200},
		{"읽기 전용 HEAD", full, ro, "Authorization", "Bearer " + ro, http.MethodHead, 200},
		{"읽기 전용 X-API-Key GET", full, ro, "X-API-Key", ro, http.MethodGet, 200},
		{"읽기 전용 POST", full, ro, "Authorization", "Bearer " + ro, http.MethodPost, 403},
		{"읽기 전용 PUT", full, ro, "Authorization", "Bearer " + ro, http.MethodPut, 403},
		{"읽기 전용 DELETE", full, ro, "X-API-Key", ro, http.MethodDelete, 403},
		{"틀린 키 GET", full, ro, "Authorization", "Bearer nope", http.MethodGet, 401},
		{"틀린 키 POST", full, ro, "X-API-Key", "nope", http.MethodPost, 401},
		{"키 없음 GET", full, ro, "", "", http.MethodGet, 401},
		{"키 앞부분만", full, ro, "Authorization", "Bearer full", http.MethodGet, 401},
		{"읽기 전용 키 미설정이면 빈 키도 401", full, "", "Authorization", "Bearer ", http.MethodGet, 401},
		{"읽기 전용 키 미설정 + 그 값", full, "", "Authorization", "Bearer " + ro, http.MethodGet, 401},
		{"두 키 모두 미설정 GET", "", "", "", "", http.MethodGet, 200},
		{"두 키 모두 미설정 POST", "", "", "", "", http.MethodPost, 200},
		{"API_KEY 없이 읽기 전용만 — 공개(경고)", "", ro, "", "", http.MethodPost, 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/api/x", nil)
			if tc.header != "" {
				req.Header.Set(tc.header, tc.value)
			}
			w := httptest.NewRecorder()
			newRouter(tc.fullKey, tc.roKy).ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("%s %s: 상태 %d, 기대 %d (본문 %s)", tc.method, tc.header, w.Code, tc.want, w.Body.String())
			}
			if tc.want == 403 && w.Body.String() != `{"error":"read-only key"}` {
				t.Fatalf("403 본문 %s", w.Body.String())
			}
		})
	}
}
