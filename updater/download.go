package updater

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
)

// download 는 설치 파일을 dst 로 내려받는다 (진행률 콜백 + 크기 확인). macOS·Windows 공용.
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
