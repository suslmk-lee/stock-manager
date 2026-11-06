//go:build darwin

package updater

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// Install 은 새 버전 DMG 를 내려받아 앱을 꺼낸 뒤, 이 프로세스(pid)가 끝나면 지금 앱 번들을
// 새 것으로 바꾸고 다시 여는 스크립트를 띄운다. 호출한 쪽은 nil 을 받으면 앱을 종료해야 한다.
func (u *Updater) Install(ctx context.Context, pid int, progress func(Progress)) error {
	if progress == nil {
		progress = func(Progress) {}
	}
	target, err := currentBundle()
	if err != nil {
		return err
	}
	if err := checkWritable(filepath.Dir(target)); err != nil {
		return err
	}
	rel, asset, err := u.pending(ctx)
	if err != nil {
		return err
	}

	work, err := os.MkdirTemp("", "stockmanager-update-")
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			os.RemoveAll(work)
		}
	}()

	// 1) 내려받기
	dmg := filepath.Join(work, "update.dmg")
	if err := u.download(ctx, asset, dmg, func(p float64) { progress(Progress{Phase: "download", Percent: p}) }); err != nil {
		return err
	}

	// 2) DMG 를 열어 앱 꺼내기
	progress(Progress{Phase: "extract", Percent: 100})
	mnt := filepath.Join(work, "mnt")
	if err := os.MkdirAll(mnt, 0o755); err != nil {
		return err
	}
	if out, err := exec.CommandContext(ctx, "hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-noverify", "-mountpoint", mnt, dmg).CombinedOutput(); err != nil {
		return fmt.Errorf("설치 파일을 열지 못했습니다: %v %s", err, strings.TrimSpace(string(out)))
	}
	staged := filepath.Join(work, "app", filepath.Base(target))
	copyErr := func() error {
		src, err := findApp(mnt)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(staged), 0o755); err != nil {
			return err
		}
		if out, err := exec.CommandContext(ctx, "ditto", src, staged).CombinedOutput(); err != nil {
			return fmt.Errorf("앱을 꺼내지 못했습니다: %v %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}()
	_ = exec.Command("hdiutil", "detach", "-quiet", "-force", mnt).Run()
	if copyErr != nil {
		return copyErr
	}

	// 3) 꺼낸 앱의 서명 확인 (깨진 파일이면 교체하지 않는다)
	progress(Progress{Phase: "verify", Percent: 100})
	if out, err := exec.CommandContext(ctx, "codesign", "--verify", "--deep", "--strict", staged).CombinedOutput(); err != nil {
		return fmt.Errorf("새 버전(%s) 앱 서명 확인에 실패했습니다: %s", rel.Tag, strings.TrimSpace(string(out)))
	}

	// 4) 이 앱이 끝나면 교체하고 다시 여는 스크립트를 띄운다
	script := filepath.Join(work, "swap.sh")
	body := fmt.Sprintf(swapScript, pid, shQuote(target), shQuote(staged), shQuote(work))
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		return err
	}
	logf, _ := os.Create(filepath.Join(os.TempDir(), "stockmanager-update.log"))
	cmd := exec.Command("/bin/sh", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if logf != nil {
		cmd.Stdout, cmd.Stderr = logf, logf
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("업데이트를 시작하지 못했습니다: %w", err)
	}
	progress(Progress{Phase: "restart", Percent: 100})
	ok = true // 작업 폴더는 스크립트가 끝나고 지운다
	return nil
}

// 지금 앱이 끝나기를 기다린 뒤 번들을 바꾸고 다시 연다. 복사에 실패하면 원래 앱을 되돌린다.
const swapScript = `#!/bin/sh
PID=%d
TARGET=%s
NEW=%s
WORK=%s
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt 300 ]; then echo "앱이 종료되지 않아 업데이트를 취소합니다"; exit 1; fi
  sleep 0.2
done
BACKUP="$TARGET.update-old"
rm -rf "$BACKUP"
if mv "$TARGET" "$BACKUP"; then
  if ditto "$NEW" "$TARGET"; then
    rm -rf "$BACKUP"
  else
    echo "새 버전 복사 실패, 원래 앱으로 되돌립니다"
    rm -rf "$TARGET"
    mv "$BACKUP" "$TARGET"
  fi
fi
open "$TARGET"
rm -rf "$WORK"
`

func (u *Updater) download(ctx context.Context, a *Asset, dst string, onPct func(float64)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "stock-manager-updater")
	client := &http.Client{} // 내려받기는 오래 걸릴 수 있어 전체 시간 제한을 두지 않는다 (ctx 로 취소)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("새 버전을 내려받지 못했습니다: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("새 버전을 내려받지 못했습니다 (HTTP %d)", resp.StatusCode)
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	total := resp.ContentLength
	if total <= 0 {
		total = a.Size
	}
	var done int64
	last := -1.0
	buf := make([]byte, 256*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			done += int64(n)
			if total > 0 {
				p := float64(done) * 100 / float64(total)
				if p-last >= 2 || p >= 100 {
					last = p
					onPct(p)
				}
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return fmt.Errorf("내려받는 중 끊겼습니다: %w", rerr)
		}
	}
	if a.Size > 0 && done != a.Size {
		return fmt.Errorf("내려받은 파일 크기가 다릅니다 (%d / %d)", done, a.Size)
	}
	return nil
}

// currentBundle 은 실행 중인 앱 번들(.app) 경로를 찾는다.
func currentBundle() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	if strings.Contains(exe, "/AppTranslocation/") {
		return "", errors.New("앱이 임시 위치에서 실행 중입니다. 응용 프로그램 폴더로 옮긴 뒤 다시 실행하세요")
	}
	i := strings.LastIndex(exe, ".app/Contents/MacOS/")
	if i < 0 {
		return "", errors.New("앱 번들(.app)에서 실행 중이 아니라 자동 설치를 할 수 없습니다")
	}
	return exe[:i+len(".app")], nil
}

func checkWritable(dir string) error {
	f, err := os.CreateTemp(dir, ".stockmanager-update-*")
	if err != nil {
		return fmt.Errorf("%s 폴더에 쓸 권한이 없어 자동 설치를 할 수 없습니다. DMG 로 직접 설치하세요", dir)
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

func findApp(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if e.IsDir() && strings.HasSuffix(e.Name(), ".app") {
			return filepath.Join(dir, e.Name()), nil
		}
	}
	return "", errors.New("설치 파일 안에서 앱을 찾지 못했습니다")
}
