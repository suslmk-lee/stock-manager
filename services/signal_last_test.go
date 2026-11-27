package services

import "testing"

// 마지막으로 만든 리포트를 기억해 두고 (매매 신호 화면이 먼저 보여 준다), 새로 만들면 바꾼다. 실패한 것(nil)은 기억하지 않는다.
func TestSignalsLast(t *testing.T) {
	s := NewSignalService(nil, nil, nil)
	if s.GetSignalsLast() != nil {
		t.Fatal("처음엔 없어야 한다")
	}
	a := &SignalReport{GeneratedAt: "2026-11-27T10:00:00+09:00"}
	s.rememberReport(a)
	s.rememberReport(nil)
	if s.GetSignalsLast() != a {
		t.Fatal("마지막 리포트를 기억하지 않음")
	}
	b := &SignalReport{GeneratedAt: "2026-11-27T10:05:00+09:00"}
	s.rememberReport(b)
	if s.GetSignalsLast() != b {
		t.Fatal("새 리포트로 바꾸지 않음")
	}
}
