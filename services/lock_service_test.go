package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type lockClock struct{ t time.Time }

func (c *lockClock) now() time.Time { return c.t }

func newTestLock(t *testing.T, dir string, clock *lockClock) *LockService {
	t.Helper()
	s := NewLockService(dir)
	s.iter = 1000 // 시험은 빠르게
	s.now = clock.now
	s.hostname = func() (string, error) { return "Test-MacBook.local", nil }
	return s
}

// 처음 실행: PIN 이 없으면 setup, 만들면 열리고 복구 코드를 준다. 파일은 본인만 읽을 수 있다.
func TestLockSetupAndRestart(t *testing.T) {
	dir := t.TempDir()
	clock := &lockClock{time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)}
	s := newTestLock(t, dir, clock)

	st, err := s.Status()
	if err != nil || st.State != LockStateSetup || st.Device != "Test-MacBook" {
		t.Fatalf("status = %+v %v", st, err)
	}
	if _, _, err := s.Setup("123456", false); err == nil {
		t.Fatal("이어지는 숫자는 거절해야 한다")
	}
	if _, _, err := s.Setup("12a456", false); err == nil {
		t.Fatal("숫자가 아니면 거절해야 한다")
	}
	code, st, err := s.Setup("482913", false)
	if err != nil || st.State != LockStateUnlocked || len(code) != 14 || strings.Count(code, "-") != 2 {
		t.Fatalf("setup = %q %+v %v", code, st, err)
	}
	if _, _, err := s.Setup("482913", false); err == nil {
		t.Fatal("PIN 이 있는데 다시 만들 수 없어야 한다")
	}
	info, err := os.Stat(filepath.Join(dir, lockFileName))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("lock.json perm = %v %v", info.Mode().Perm(), err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, lockFileName))
	if strings.Contains(string(b), "482913") || strings.Contains(string(b), strings.ReplaceAll(code, "-", "")) {
		t.Fatal("PIN·복구 코드를 그대로 저장하면 안 된다")
	}

	// 앱을 다시 켜면 (새 서비스) 잠겨 있다
	s2 := newTestLock(t, dir, clock)
	if st, _ := s2.Status(); st.State != LockStateLocked || st.Trusted {
		t.Fatalf("restart = %+v", st)
	}
	if st, _ := s2.Unlock("482913", false); st.State != LockStateUnlocked || st.Error != "" {
		t.Fatalf("unlock = %+v", st)
	}
}

// 이 PC 기억하기: 다음 실행부터 바로 열리고, 해제하면 다시 묻는다
func TestLockRememberDevice(t *testing.T) {
	dir := t.TempDir()
	clock := &lockClock{time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)}
	s := newTestLock(t, dir, clock)
	if _, _, err := s.Setup("482913", false); err != nil {
		t.Fatal(err)
	}

	s2 := newTestLock(t, dir, clock)
	if st, _ := s2.Unlock("482913", true); st.State != LockStateUnlocked || !st.Trusted {
		t.Fatalf("unlock remember = %+v", st)
	}
	s3 := newTestLock(t, dir, clock)
	if st, _ := s3.Status(); st.State != LockStateUnlocked || !st.Trusted {
		t.Fatalf("trusted restart = %+v", st)
	}
	if st, err := s3.SetTrusted(false); err != nil || st.Trusted {
		t.Fatalf("forget = %+v %v", st, err)
	}
	s4 := newTestLock(t, dir, clock)
	if st, _ := s4.Status(); st.State != LockStateLocked {
		t.Fatalf("after forget = %+v", st)
	}
	// 잠긴 상태에서는 기억하기를 켤 수 없다
	if _, err := s4.SetTrusted(true); err != ErrLockNotUnlocked {
		t.Fatalf("set trusted while locked = %v", err)
	}
}

// 5번 틀리면 30초, 그 뒤로 1분… 기다리는 동안은 맞는 PIN 도 받지 않는다. 맞으면 횟수가 지워진다.
func TestLockLockout(t *testing.T) {
	dir := t.TempDir()
	clock := &lockClock{time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)}
	s := newTestLock(t, dir, clock)
	s.Setup("482913", false)
	s = newTestLock(t, dir, clock)
	s.Status()

	for i := 1; i <= 4; i++ {
		st, _ := s.Unlock("000001", false)
		if st.State != LockStateLocked || st.Remaining != 5-i || st.RetryAfter != 0 || st.Error == "" {
			t.Fatalf("wrong %d = %+v", i, st)
		}
	}
	st, _ := s.Unlock("000001", false)
	if st.RetryAfter != 30 || !strings.Contains(st.Error, "30초") {
		t.Fatalf("5th wrong = %+v", st)
	}
	if st, _ := s.Unlock("482913", false); st.State == LockStateUnlocked || !strings.Contains(st.Error, "뒤에") {
		t.Fatalf("기다리는 동안 맞는 PIN 도 받으면 안 된다: %+v", st)
	}
	// 다시 켜도 기다림은 이어진다
	s = newTestLock(t, dir, clock)
	if st, _ := s.Status(); st.RetryAfter != 30 {
		t.Fatalf("restart during lockout = %+v", st)
	}
	clock.t = clock.t.Add(31 * time.Second)
	if st, _ := s.Unlock("000001", false); st.RetryAfter != 60 {
		t.Fatalf("6th wrong = %+v", st)
	}
	clock.t = clock.t.Add(61 * time.Second)
	if st, _ := s.Unlock("482913", false); st.State != LockStateUnlocked {
		t.Fatalf("unlock after wait = %+v", st)
	}
	s = newTestLock(t, dir, clock)
	if st, _ := s.Unlock("000001", false); st.Remaining != 4 {
		t.Fatalf("성공하면 틀린 횟수가 지워져야 한다: %+v", st)
	}
}

// PIN 을 잊었을 때: 복구 코드(대시·소문자 상관없이)로 새 PIN, PIN 바꾸기, 복구 코드 새로 만들기
func TestLockRecoverAndChange(t *testing.T) {
	dir := t.TempDir()
	clock := &lockClock{time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)}
	s := newTestLock(t, dir, clock)
	code, _, err := s.Setup("482913", false)
	if err != nil {
		t.Fatal(err)
	}
	s = newTestLock(t, dir, clock)
	if st, _ := s.Recover("AAAA-BBBB-CCCC", "730164", false); st.State != LockStateLocked || !strings.Contains(st.Error, "복구 코드") {
		t.Fatalf("wrong code = %+v", st)
	}
	typed := strings.ToLower(strings.ReplaceAll(code, "-", " "))
	if st, _ := s.Recover(typed, "730164", true); st.State != LockStateUnlocked || !st.Trusted {
		t.Fatalf("recover = %+v", st)
	}
	if err := s.ChangePIN("482913", "559201"); err == nil {
		t.Fatal("옛 PIN 으로 바꿀 수 없어야 한다")
	}
	if err := s.ChangePIN("730164", "559201"); err != nil {
		t.Fatal(err)
	}
	newCode, err := s.NewRecoveryCode("559201")
	if err != nil || newCode == code {
		t.Fatalf("new code = %q %v", newCode, err)
	}
	// 복구할 때 기억하기를 켰으므로 끄고 다시 켠다
	if _, err := s.SetTrusted(false); err != nil {
		t.Fatal(err)
	}
	s = newTestLock(t, dir, clock)
	if st, _ := s.Recover(code, "662810", false); st.State == LockStateUnlocked {
		t.Fatal("이전 복구 코드는 못 써야 한다")
	}
	if st, _ := s.Unlock("559201", false); st.State != LockStateUnlocked {
		t.Fatalf("new pin = %+v", st)
	}
}

// 깨진 lock.json 은 옆에 남기고 처음 실행처럼
func TestLockBrokenFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, lockFileName), []byte("{not json"), 0o600)
	s := newTestLock(t, dir, &lockClock{time.Now()})
	if st, _ := s.Status(); st.State != LockStateSetup {
		t.Fatalf("broken = %+v", st)
	}
	if _, err := os.Stat(filepath.Join(dir, lockFileName+".broken")); err != nil {
		t.Fatal("깨진 파일을 남겨 두어야 한다")
	}
}

func TestCheckPIN(t *testing.T) {
	for _, bad := range []string{"", "12345", "1234567", "111111", "123456", "654321", "890123", "12 456"} {
		if checkPIN(bad) == nil {
			t.Errorf("%q 는 거절해야 한다", bad)
		}
	}
	for _, good := range []string{"482913", "000100", "135790", "112233"} {
		if err := checkPIN(good); err != nil {
			t.Errorf("%q: %v", good, err)
		}
	}
}
