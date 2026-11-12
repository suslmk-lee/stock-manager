package services

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 앱 잠금 — 데스크톱 앱을 켤 때 6자리 PIN을 묻는다. PIN은 PC마다 따로다.
//
//   - 기록은 이 PC의 설정 폴더(lock.json)에만 둔다. 공유 DB 에는 남기지 않는다.
//   - PIN·복구 코드는 PBKDF2-SHA256 해시로만 저장한다.
//   - '이 PC 기억하기'를 켜면 해제할 때까지 이 PC 에서는 PIN을 묻지 않는다.
//   - 연속으로 5번 틀리면 30초, 그 뒤로 틀릴 때마다 1분·5분·15분·30분·1시간을 기다려야 한다.
//   - 화면 잠금이지 데이터 암호화가 아니다 (PC 파일을 지울 수 있는 사람은 lock.json 을 지워 PIN을 새로 만들 수 있다).

const (
	lockFileName     = "lock.json"
	lockPINLength    = 6
	lockFreeAttempts = 5 // 기다리지 않고 틀릴 수 있는 횟수
	lockDefaultIter  = 600_000
	recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 헷갈리는 0·O·1·I 빼고
)

// 5번째로 틀린 뒤부터 기다리는 시간 (마지막 값이 계속 쓰인다)
var lockWaits = []time.Duration{30 * time.Second, time.Minute, 5 * time.Minute, 15 * time.Minute, 30 * time.Minute, time.Hour}

// 잠금 상태
const (
	LockStateSetup    = "setup"    // PIN을 아직 만들지 않음 (처음 실행)
	LockStateLocked   = "locked"   // PIN을 입력해야 함
	LockStateUnlocked = "unlocked" // 열림
)

// LockInputError 는 사용자가 고칠 수 있는 입력 오류 (형식·틀린 PIN 등)
type LockInputError struct{ msg string }

func (e *LockInputError) Error() string { return e.msg }

func lockErr(format string, a ...any) error { return &LockInputError{fmt.Sprintf(format, a...)} }

// ErrLockNotUnlocked 는 잠긴 상태에서 설정을 바꾸려 할 때
var ErrLockNotUnlocked = errors.New("먼저 잠금을 풀어 주세요")

type lockRecord struct {
	Version      int       `json:"version"`
	PINHash      string    `json:"pin_hash"`
	RecoveryHash string    `json:"recovery_hash"`
	Trusted      bool      `json:"trusted"` // 이 PC 기억하기
	TrustedAt    time.Time `json:"trusted_at,omitempty"`
	Failed       int       `json:"failed"` // 연속으로 틀린 횟수
	LockedUntil  time.Time `json:"locked_until,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// LockStatus 는 화면에 넘기는 잠금 상태
type LockStatus struct {
	State   string `json:"state"`   // setup | locked | unlocked
	Trusted bool   `json:"trusted"` // 이 PC 기억하기
	Device  string `json:"device"`  // 이 PC 이름
	// 기다려야 하면 남은 초와 풀리는 시각
	RetryAfter  int    `json:"retry_after,omitempty"`
	LockedUntil string `json:"locked_until,omitempty"`
	// 기다리지 않고 더 틀릴 수 있는 횟수 (틀린 적이 있을 때만)
	Remaining int `json:"remaining,omitempty"`
	// 방금 시도가 실패한 이유 (PIN 틀림 등)
	Error string `json:"error,omitempty"`
}

type LockService struct {
	mu       sync.Mutex
	dir      string
	unlocked bool

	// 시험용 주입
	now      func() time.Time
	iter     int
	hostname func() (string, error)
}

// NewLockService: dir 은 이 PC의 앱 설정 폴더 (예: ~/Library/Application Support/StockManager). 만들 때는 파일을 건드리지 않는다.
func NewLockService(dir string) *LockService {
	return &LockService{dir: dir, now: time.Now, iter: lockDefaultIter, hostname: os.Hostname}
}

// DefaultLockDir: 사용자 설정 폴더 아래 StockManager
func DefaultLockDir() string {
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "StockManager")
	}
	return "."
}

func (s *LockService) path() string { return filepath.Join(s.dir, lockFileName) }

func (s *LockService) device() string {
	h, err := s.hostname()
	if err != nil || h == "" {
		return "이 PC"
	}
	return strings.TrimSuffix(h, ".local")
}

// load: 파일이 없으면 (nil, nil). 깨진 파일은 옆에 남겨 두고 처음 실행처럼 다룬다.
func (s *LockService) load() (*lockRecord, error) {
	b, err := os.ReadFile(s.path())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var r lockRecord
	if err := json.Unmarshal(b, &r); err != nil || r.PINHash == "" {
		_ = os.Rename(s.path(), s.path()+".broken")
		return nil, nil
	}
	return &r, nil
}

// save: 임시 파일에 쓰고 바꿔 끼운다 (본인만 읽기·쓰기)
func (s *LockService) save(r *lockRecord) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	r.Version = 1
	r.UpdatedAt = s.now().UTC()
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, ".lock-*.json")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	return os.Rename(name, s.path())
}

// ───────────────────────── 해시 ─────────────────────────

func (s *LockService) hash(secret string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, secret, salt, s.iter, 32)
	if err != nil {
		return "", err
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", s.iter, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

func verifyHash(stored, secret string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter <= 0 {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[2])
	want, err2 := enc.DecodeString(parts[3])
	if err1 != nil || err2 != nil || len(want) == 0 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, secret, salt, iter, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

// ───────────────────────── PIN · 복구 코드 형식 ─────────────────────────

// checkPIN: 숫자 6자리, 같은 숫자만·이어지는 숫자(123456, 987654)는 안 된다
func checkPIN(pin string) error {
	if len(pin) != lockPINLength {
		return lockErr("PIN은 숫자 %d자리여야 합니다", lockPINLength)
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return lockErr("PIN은 숫자 %d자리여야 합니다", lockPINLength)
		}
	}
	same, up, down := true, true, true
	for i := 1; i < len(pin); i++ {
		d := int(pin[i]) - int(pin[i-1])
		same = same && d == 0
		up = up && (d == 1 || d == -9)
		down = down && (d == -1 || d == 9)
	}
	if same || up || down {
		return lockErr("같은 숫자만이나 이어지는 숫자(123456 등)는 쓸 수 없습니다")
	}
	return nil
}

func newRecoveryCode() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	var sb strings.Builder
	for i, v := range b {
		if i > 0 && i%4 == 0 {
			sb.WriteByte('-')
		}
		sb.WriteByte(recoveryAlphabet[int(v)%len(recoveryAlphabet)])
	}
	return sb.String(), nil
}

// normRecovery: 대시·공백을 빼고 대문자로
func normRecovery(code string) string {
	var sb strings.Builder
	for _, c := range strings.ToUpper(code) {
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			sb.WriteRune(c)
		}
	}
	return sb.String()
}

// ───────────────────────── 상태 ─────────────────────────

func (s *LockService) statusOf(r *lockRecord) LockStatus {
	st := LockStatus{Device: s.device()}
	switch {
	case r == nil:
		st.State = LockStateSetup
		return st
	case s.unlocked:
		st.State = LockStateUnlocked
	default:
		st.State = LockStateLocked
	}
	st.Trusted = r.Trusted
	if st.State == LockStateLocked {
		now := s.now()
		if r.LockedUntil.After(now) {
			st.RetryAfter = int(r.LockedUntil.Sub(now).Seconds() + 0.999)
			st.LockedUntil = r.LockedUntil.UTC().Format(time.RFC3339)
		}
		if r.Failed > 0 && r.Failed < lockFreeAttempts {
			st.Remaining = lockFreeAttempts - r.Failed
		}
	}
	return st
}

// Status: 앱을 켤 때 부른다. 이 PC를 기억해 두었으면 바로 연다.
func (s *LockService) Status() (LockStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.load()
	if err != nil {
		return LockStatus{}, err
	}
	if r != nil && r.Trusted {
		s.unlocked = true
	}
	return s.statusOf(r), nil
}

// Setup: 처음 실행 — PIN을 만들고 연다. 복구 코드를 한 번만 돌려준다.
func (s *LockService) Setup(pin string, remember bool) (string, LockStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.load()
	if err != nil {
		return "", LockStatus{}, err
	}
	if r != nil {
		return "", LockStatus{}, lockErr("이 PC 에는 이미 PIN이 있습니다")
	}
	if err := checkPIN(pin); err != nil {
		return "", LockStatus{}, err
	}
	code, err := newRecoveryCode()
	if err != nil {
		return "", LockStatus{}, err
	}
	ph, err := s.hash(pin)
	if err != nil {
		return "", LockStatus{}, err
	}
	rh, err := s.hash(normRecovery(code))
	if err != nil {
		return "", LockStatus{}, err
	}
	now := s.now().UTC()
	r = &lockRecord{PINHash: ph, RecoveryHash: rh, Trusted: remember, CreatedAt: now}
	if remember {
		r.TrustedAt = now
	}
	if err := s.save(r); err != nil {
		return "", LockStatus{}, err
	}
	s.unlocked = true
	return code, s.statusOf(r), nil
}

// attempt: 기다리는 중이면 거절, 맞으면 틀린 횟수를 지우고, 틀리면 늘린다. 맞았는지와 상태를 돌려준다.
func (s *LockService) attempt(r *lockRecord, ok func() bool, wrongMsg string) (bool, LockStatus, error) {
	now := s.now()
	if r.LockedUntil.After(now) {
		st := s.statusOf(r)
		st.Error = fmt.Sprintf("너무 많이 틀렸습니다. %s 뒤에 다시 해 주세요", waitText(st.RetryAfter))
		return false, st, nil
	}
	if ok() {
		r.Failed = 0
		r.LockedUntil = time.Time{}
		return true, LockStatus{}, nil
	}
	r.Failed++
	if r.Failed >= lockFreeAttempts {
		i := r.Failed - lockFreeAttempts
		if i >= len(lockWaits) {
			i = len(lockWaits) - 1
		}
		r.LockedUntil = now.Add(lockWaits[i]).UTC()
	}
	if err := s.save(r); err != nil {
		return false, LockStatus{}, err
	}
	st := s.statusOf(r)
	switch {
	case st.RetryAfter > 0:
		st.Error = fmt.Sprintf("%s. %s 뒤에 다시 해 주세요", wrongMsg, waitText(st.RetryAfter))
	case st.Remaining > 0:
		st.Error = fmt.Sprintf("%s (%d번 더 틀리면 잠시 기다려야 합니다)", wrongMsg, st.Remaining)
	default:
		st.Error = wrongMsg
	}
	return false, st, nil
}

func waitText(sec int) string {
	switch {
	case sec >= 3600:
		return fmt.Sprintf("%d시간", (sec+3599)/3600)
	case sec >= 60:
		return fmt.Sprintf("%d분", (sec+59)/60)
	default:
		return fmt.Sprintf("%d초", sec)
	}
}

// Unlock: PIN으로 연다. 틀리면 State=locked 에 Error 를 담아 돌려준다.
func (s *LockService) Unlock(pin string, remember bool) (LockStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.load()
	if err != nil {
		return LockStatus{}, err
	}
	if r == nil {
		return s.statusOf(nil), nil
	}
	if s.unlocked {
		return s.statusOf(r), nil
	}
	if len(pin) != lockPINLength {
		st := s.statusOf(r)
		st.Error = fmt.Sprintf("PIN은 숫자 %d자리입니다", lockPINLength)
		return st, nil
	}
	ok, st, err := s.attempt(r, func() bool { return verifyHash(r.PINHash, pin) }, "PIN이 맞지 않습니다")
	if err != nil || !ok {
		return st, err
	}
	if remember && !r.Trusted {
		r.Trusted, r.TrustedAt = true, s.now().UTC()
	}
	if err := s.save(r); err != nil {
		return LockStatus{}, err
	}
	s.unlocked = true
	return s.statusOf(r), nil
}

// Recover: PIN을 잊었을 때 — 복구 코드가 맞으면 새 PIN으로 바꾸고 연다. 복구 코드는 계속 쓸 수 있다.
func (s *LockService) Recover(code, newPIN string, remember bool) (LockStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.load()
	if err != nil {
		return LockStatus{}, err
	}
	if r == nil {
		return s.statusOf(nil), nil
	}
	if err := checkPIN(newPIN); err != nil {
		st := s.statusOf(r)
		st.Error = err.Error()
		return st, nil
	}
	norm := normRecovery(code)
	ok, st, err := s.attempt(r, func() bool { return norm != "" && verifyHash(r.RecoveryHash, norm) }, "복구 코드가 맞지 않습니다")
	if err != nil || !ok {
		return st, err
	}
	ph, err := s.hash(newPIN)
	if err != nil {
		return LockStatus{}, err
	}
	r.PINHash = ph
	if remember && !r.Trusted {
		r.Trusted, r.TrustedAt = true, s.now().UTC()
	}
	if err := s.save(r); err != nil {
		return LockStatus{}, err
	}
	s.unlocked = true
	return s.statusOf(r), nil
}

// unlockedRecord: 설정을 바꾸기 전에 — 열린 상태여야 한다
func (s *LockService) unlockedRecord() (*lockRecord, error) {
	r, err := s.load()
	if err != nil {
		return nil, err
	}
	if r == nil || !s.unlocked {
		return nil, ErrLockNotUnlocked
	}
	return r, nil
}

// ChangePIN: 지금 PIN을 확인하고 새 PIN으로 바꾼다 (틀린 횟수 제한을 같이 쓴다)
func (s *LockService) ChangePIN(current, newPIN string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.unlockedRecord()
	if err != nil {
		return err
	}
	if err := checkPIN(newPIN); err != nil {
		return err
	}
	if current == newPIN {
		return lockErr("새 PIN이 지금 PIN 과 같습니다")
	}
	ok, st, err := s.attempt(r, func() bool { return verifyHash(r.PINHash, current) }, "지금 PIN이 맞지 않습니다")
	if err != nil {
		return err
	}
	if !ok {
		return &LockInputError{st.Error}
	}
	ph, err := s.hash(newPIN)
	if err != nil {
		return err
	}
	r.PINHash = ph
	return s.save(r)
}

// SetTrusted: 이 PC 기억하기 켜고 끄기
func (s *LockService) SetTrusted(trusted bool) (LockStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.unlockedRecord()
	if err != nil {
		return LockStatus{}, err
	}
	r.Trusted = trusted
	if trusted {
		r.TrustedAt = s.now().UTC()
	} else {
		r.TrustedAt = time.Time{}
	}
	if err := s.save(r); err != nil {
		return LockStatus{}, err
	}
	return s.statusOf(r), nil
}

// NewRecoveryCode: PIN을 확인하고 복구 코드를 새로 만든다 (이전 코드는 못 쓰게 된다)
func (s *LockService) NewRecoveryCode(pin string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.unlockedRecord()
	if err != nil {
		return "", err
	}
	ok, st, err := s.attempt(r, func() bool { return verifyHash(r.PINHash, pin) }, "PIN이 맞지 않습니다")
	if err != nil {
		return "", err
	}
	if !ok {
		return "", &LockInputError{st.Error}
	}
	code, err := newRecoveryCode()
	if err != nil {
		return "", err
	}
	rh, err := s.hash(normRecovery(code))
	if err != nil {
		return "", err
	}
	r.RecoveryHash = rh
	if err := s.save(r); err != nil {
		return "", err
	}
	return code, nil
}
