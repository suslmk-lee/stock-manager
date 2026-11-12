//go:build windows

package updater

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"syscall"
)

const (
	createNewProcessGroup = 0x00000200
	detachedProcess       = 0x00000008
)

var unsafeNameRe = regexp.MustCompile(`[^A-Za-z0-9._-]`)

// Install 은 새 버전 exe 를 내려받아 확인한 뒤 지금 exe 와 바꿔 놓고, 이 프로세스(pid)가 끝나면
// 새 exe 를 다시 실행하는 도우미를 띄운다. 호출한 쪽은 nil 을 받으면 앱을 종료해야 한다.
func (u *Updater) Install(ctx context.Context, pid int, progress func(Progress)) error {
	if progress == nil {
		progress = func(Progress) {}
	}
	target, err := os.Executable()
	if err != nil {
		return err
	}
	if p, err := filepath.EvalSymlinks(target); err == nil {
		target = p
	}
	dir := filepath.Dir(target)
	if err := checkWritable(dir); err != nil {
		return err
	}
	rel, asset, err := u.pending(ctx)
	if err != nil {
		return err
	}

	// 1) 같은 드라이브에 내려받기 (이름 바꾸기가 한 번에 끝나도록)
	tmp := filepath.Join(dir, fmt.Sprintf("%s.update-%s.tmp", filepath.Base(target), unsafeNameRe.ReplaceAllString(rel.Tag, "_")))
	ok := false
	defer func() {
		if !ok {
			os.Remove(tmp)
		}
	}()
	if err := u.download(ctx, asset, tmp, func(p float64) { progress(Progress{Phase: "download", Percent: p}) }); err != nil {
		return err
	}

	// 2) 확인: 크기·MZ 헤더·(있으면) SHA-256
	progress(Progress{Phase: "verify", Percent: 100})
	sha := ""
	if cs := PickChecksum(rel.Assets, asset.Name); cs != nil {
		body, err := u.fetchText(ctx, cs.URL)
		if err != nil {
			return err
		}
		if sha, err = parseChecksum(body, asset.Name); err != nil {
			return err
		}
	}
	if err := verifyDownloaded(tmp, asset.Size, sha); err != nil {
		return err
	}

	// 3) 바꿔치기: 지금 exe → .old, 새 exe → 지금 이름
	if err := swapExecutable(target, tmp); err != nil {
		return err
	}
	ok = true // tmp 는 target 이 되었다

	// 4) 이 앱이 끝나면 새 exe 를 여는 도우미
	script := fmt.Sprintf("Wait-Process -Id %d -Timeout 60 -ErrorAction SilentlyContinue; Start-Process -FilePath %s", pid, psQuote(target))
	cmd := exec.Command("powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNewProcessGroup | detachedProcess}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("새 버전은 설치했지만 자동으로 다시 열지 못했습니다. 프로그램을 직접 다시 실행하세요: %w", err)
	}
	progress(Progress{Phase: "restart", Percent: 100})
	return nil
}

// fetchText 는 작은 텍스트 파일(체크섬)을 내려받는다.
func (u *Updater) fetchText(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "stock-manager-updater")
	resp, err := u.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("체크섬을 내려받지 못했습니다: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("체크섬을 내려받지 못했습니다 (HTTP %d)", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return string(b), err
}

func checkWritable(dir string) error {
	f, err := os.CreateTemp(dir, ".stockmanager-update-*")
	if err != nil {
		return fmt.Errorf("%s 폴더에 쓸 권한이 없어 자동 설치를 할 수 없습니다. 릴리스 페이지에서 내려받으세요", dir)
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

// CleanupOld 는 지난 업데이트가 남긴 <exe>.old 와 *.update-*.tmp 를 지운다 (앱 시작 때 한 번, 실패는 무시).
func CleanupOld() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	cleanupOldFiles(exe)
}
