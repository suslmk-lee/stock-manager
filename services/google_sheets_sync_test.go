package services

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"stock-manager/models"
)

// 접근 토큰이 거절(401 ACCESS_TOKEN_EXPIRED)되면 새로 받아 한 번 더 보낸다. 벽시계로 만료된 토큰은 다시 쓰지 않는다.
func TestSheetsTokenRefreshOn401(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	pemKey := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))

	var tokens int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/token":
			n := atomic.AddInt32(&tokens, 1)
			fmt.Fprintf(w, `{"access_token":"tok-%d","expires_in":3600,"token_type":"Bearer"}`, n)
		case strings.HasPrefix(r.URL.Path, "/v4/spreadsheets/SHEET/values/"):
			if r.Header.Get("Authorization") == "Bearer tok-1" { // 첫 토큰은 이미 만료된 것처럼
				w.WriteHeader(http.StatusUnauthorized)
				fmt.Fprint(w, `{"error":{"code":401,"status":"UNAUTHENTICATED","details":[{"reason":"ACCESS_TOKEN_EXPIRED"}]}}`)
				return
			}
			fmt.Fprint(w, `{"values":[["티커"]]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	s := &GoogleSheetsDividendSync{
		spreadsheetID: "SHEET",
		worksheet:     "2026",
		credentials:   googleServiceAccountCredential{ClientEmail: "bot@example.iam.gserviceaccount.com", PrivateKey: pemKey, TokenURI: srv.URL + "/token"},
		httpClient:    srv.Client(),
		apiBase:       srv.URL + "/v4/spreadsheets",
	}
	body, err := s.doSheetsRequest(http.MethodGet, "/values/A1", nil, nil)
	if err != nil || !strings.Contains(string(body), "티커") || atomic.LoadInt32(&tokens) != 2 {
		t.Fatalf("401 뒤 새 토큰으로 다시 보내야 한다: body=%s err=%v tokens=%d", body, err, tokens)
	}
	// 다음 요청은 캐시한 tok-2 를 그대로
	if _, err := s.doSheetsRequest(http.MethodGet, "/values/A1", nil, nil); err != nil || atomic.LoadInt32(&tokens) != 2 {
		t.Fatalf("유효한 토큰은 다시 쓴다: err=%v tokens=%d", err, tokens)
	}
	// 벽시계로 만료된 토큰은 새로 받는다
	s.mu.Lock()
	s.tokenExpiry = time.Now().Round(0).Add(-time.Minute)
	s.mu.Unlock()
	if _, err := s.doSheetsRequest(http.MethodGet, "/values/A1", nil, nil); err != nil || atomic.LoadInt32(&tokens) != 3 {
		t.Fatalf("만료된 토큰은 새로 받아야 한다: err=%v tokens=%d", err, tokens)
	}
}

// 시트 티커 맞추기: 거래소 꼬리표(.T 도쿄 등)는 떼고도 비교, 한국 6자리는 완전 일치, 미국 종류주(BRK.B)는 꼬리표 그대로
func TestSheetTickerMatches(t *testing.T) {
	cases := []struct {
		row, asset string
		want       bool
	}{
		{"2621", "2621.T", true},   // 시트에 꼬리표 없이 적은 도쿄 ETF
		{"2621.T", "2621.T", true}, // 그대로
		{"2621.t", "2621.T", true},
		{"2622", "2621.T", false},
		{"005930", "005930.KS", true},
		{"005930.KS", "005930.KS", true},
		{"005935", "005930.KS", false},
		{"0700", "0700.HK", true},
		{"SCHD", "SCHD", true},
		{"BRK.B", "BRK.B", true},
		{"BRK.A", "BRK.B", false}, // 종류가 다른 주식은 다른 줄
	}
	for _, c := range cases {
		if got := tickerMatches(c.row, buildTickerMatchValues(c.asset)); got != c.want {
			t.Errorf("시트 %q ↔ 종목 %q = %v, want %v", c.row, c.asset, got, c.want)
		}
	}
}

// 시트에 그 종목 줄이 없으면 ErrSheetRowNotFound — 배당 기록은 막지 않고 안내만 하는 경우와 구분한다
func TestSheetRowNotFound(t *testing.T) {
	snap := &sheetSnapshot{
		Rows: [][]interface{}{
			{"증권사", "계좌", "티커", "1월", "2월"},
			{"NH투자증권", "일반계좌", "SCHD", "0", "0"},
		},
		BrokerCol: 0, AccountCol: 1, TargetCol: -1, TickerCol: 2,
		MonthCols: map[int]int{1: 3, 2: 4},
	}
	acc := models.Account{Name: "일반계좌", Broker: "NH투자증권"}
	if _, err := snap.findRowCandidate(acc, models.Asset{Ticker: "2621.T"}, 4); !errors.Is(err, ErrSheetRowNotFound) {
		t.Fatalf("줄이 없으면 ErrSheetRowNotFound 여야 한다: %v", err)
	}
	snap.Rows = append(snap.Rows, []interface{}{"NH투자증권", "일반계좌", "2621", "0", "0"})
	if c, err := snap.findRowCandidate(acc, models.Asset{Ticker: "2621.T"}, 4); err != nil || c.RowIndex != 3 {
		t.Fatalf("꼬리표 없이 적은 줄을 찾아야 한다: %+v err %v", c, err)
	}
}
