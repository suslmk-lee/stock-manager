package updater

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// parseChecksum 은 체크섬 파일 내용에서 name 의 SHA-256(소문자 hex)을 찾는다.
// "<hash>  <name>", "<hash> *<name>" 형식의 여러 줄, 또는 해시만 한 줄 있는 파일을 받는다.
func parseChecksum(content, name string) (string, error) {
	var only string
	lines := 0
	sc := bufio.NewScanner(strings.NewReader(content))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		lines++
		f := strings.Fields(line)
		h := strings.ToLower(f[0])
		if !isSHA256Hex(h) {
			continue
		}
		if len(f) == 1 {
			only = h
			continue
		}
		if strings.TrimPrefix(strings.Join(f[1:], " "), "*") == name {
			return h, nil
		}
	}
	if only != "" && lines == 1 {
		return only, nil
	}
	return "", errors.New("체크섬 파일에서 " + name + " 의 값을 찾지 못했습니다")
}

func isSHA256Hex(s string) bool {
	if len(s) != 64 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}

// verifyDownloaded 는 내려받은 실행 파일을 확인한다: 크기(size>0 일 때), "MZ" 헤더, SHA-256(sha 가 비어 있지 않을 때).
func verifyDownloaded(path string, size int64, sha string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if size > 0 && st.Size() != size {
		return fmt.Errorf("내려받은 파일 크기가 다릅니다 (%d / %d)", st.Size(), size)
	}
	head := make([]byte, 2)
	if _, err := io.ReadFull(f, head); err != nil || string(head) != "MZ" {
		return errors.New("내려받은 파일이 실행 파일(exe)이 아닙니다")
	}
	if strings.TrimSpace(sha) == "" {
		return nil
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, strings.TrimSpace(sha)) {
		return errors.New("내려받은 파일의 체크섬이 릴리스와 다릅니다 (파일이 손상되었거나 변조되었을 수 있습니다)")
	}
	return nil
}

// swapExecutable 은 target 을 target+".old" 로 옮기고 newPath 를 target 자리로 옮긴다.
// 두 번째 이동이 실패하면 .old 를 되돌린다. (Windows 는 실행 중인 exe 도 이름은 바꿀 수 있다)
func swapExecutable(target, newPath string) error {
	old := target + ".old"
	_ = os.Remove(old)
	if err := os.Rename(target, old); err != nil {
		return fmt.Errorf("현재 프로그램을 옮기지 못했습니다: %w", err)
	}
	if err := os.Rename(newPath, target); err != nil {
		if rerr := os.Rename(old, target); rerr != nil {
			return fmt.Errorf("새 버전을 설치하지 못했고 원래 파일도 되돌리지 못했습니다 (%v / %v)", err, rerr)
		}
		return fmt.Errorf("새 버전을 설치하지 못했습니다: %w", err)
	}
	return nil
}

// psQuote 는 PowerShell 작은따옴표 문자열에 넣을 수 있게 감싼다.
func psQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// cleanupOldFiles 는 exe 옆의 .old 와 업데이트 중 남은 <exe 이름>.update-*.tmp 를 지운다 (실패는 무시).
func cleanupOldFiles(exe string) {
	_ = os.Remove(exe + ".old")
	if m, err := filepath.Glob(globEscape(exe) + ".update-*.tmp"); err == nil {
		for _, p := range m {
			_ = os.Remove(p)
		}
	}
}

// globEscape 는 경로의 와일드카드 문자를 이스케이프한다 (Windows 는 이스케이프가 없어 그대로 둔다).
func globEscape(p string) string {
	if os.PathSeparator == '\\' {
		return p
	}
	return strings.NewReplacer(`\`, `\\`, "*", `\*`, "?", `\?`, "[", `\[`).Replace(p)
}
