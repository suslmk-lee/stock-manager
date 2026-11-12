package main

import "testing"

// 내장 API 서버는 이 PC 에서 띄운 화면만 받는다
func TestIsLocalOrigin(t *testing.T) {
	for _, ok := range []string{"http://localhost", "http://localhost:5173", "http://127.0.0.1:5200"} {
		if !isLocalOrigin(ok) {
			t.Errorf("%s 는 받아야 한다", ok)
		}
	}
	for _, bad := range []string{"", "https://evil.example", "http://localhost.evil.example", "http://127.0.0.1.nip.io:80", "http://192.168.0.10:5173", "null"} {
		if isLocalOrigin(bad) {
			t.Errorf("%s 는 받으면 안 된다", bad)
		}
	}
}
