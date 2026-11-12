package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPickAssetWindows(t *testing.T) {
	assets := []Asset{
		{Name: "StockManager-v1.2.0-universal.dmg"},
		{Name: "StockManager-v1.2.0-windows-amd64.exe.sha256"},
		{Name: "StockManager-v1.2.0-windows-arm64.exe"},
		{Name: "StockManager-v1.2.0-Windows-AMD64.EXE"},
		{Name: "setup-amd64.exe"},
	}
	if a := PickAsset(assets, "windows", "amd64"); a == nil || a.Name != "StockManager-v1.2.0-Windows-AMD64.EXE" {
		t.Fatalf("amd64 exe: %+v", a)
	}
	if a := PickAsset(assets, "windows", "arm64"); a == nil || a.Name != "StockManager-v1.2.0-windows-arm64.exe" {
		t.Fatalf("arm64 exe: %+v", a)
	}
	if a := PickAsset(assets[:2], "windows", "amd64"); a != nil {
		t.Fatalf("exe 가 없으면 nil: %+v", a)
	}
	if a := PickAsset([]Asset{{Name: "SM-windows-x64.exe"}}, "windows", "amd64"); a == nil {
		t.Fatal("x64 이름도 받아야 한다")
	}
	if a := PickAsset(assets, "linux", "amd64"); a != nil {
		t.Fatalf("linux 는 없다: %+v", a)
	}
	if a := PickAsset(assets, "darwin", "arm64"); a == nil || !strings.HasSuffix(a.Name, ".dmg") {
		t.Fatalf("darwin 은 dmg: %+v", a)
	}
}

func TestPickChecksum(t *testing.T) {
	exe := "SM-windows-amd64.exe"
	assets := []Asset{{Name: "SHA256SUMS"}, {Name: exe + ".sha256"}}
	if a := PickChecksum(assets, exe); a == nil || a.Name != exe+".sha256" {
		t.Fatalf("개별 파일 우선: %+v", a)
	}
	if a := PickChecksum(assets[:1], exe); a == nil || a.Name != "SHA256SUMS" {
		t.Fatalf("SHA256SUMS: %+v", a)
	}
	if a := PickChecksum([]Asset{{Name: exe}}, exe); a != nil {
		t.Fatalf("없으면 nil: %+v", a)
	}
}

func TestParseChecksum(t *testing.T) {
	h := strings.Repeat("ab", 32)
	cases := []struct {
		name, in string
		ok       bool
	}{
		{"형식", h + "  a.exe\n", true},
		{"바이너리 표시", h + " *a.exe\n", true},
		{"대문자", strings.ToUpper(h) + "  a.exe", true},
		{"여러 줄", strings.Repeat("cd", 32) + "  b.exe\r\n" + h + "  a.exe\r\n", true},
		{"해시만", h + "\n", true},
		{"다른 파일", h + "  b.exe\n", false},
		{"해시 아님", "zzz  a.exe\n", false},
		{"빈 파일", "", false},
	}
	for _, c := range cases {
		got, err := parseChecksum(c.in, "a.exe")
		if (err == nil) != c.ok || (c.ok && got != h) {
			t.Errorf("%s: got %q err %v", c.name, got, err)
		}
	}
}

func writeFile(t *testing.T, p string, b []byte) {
	t.Helper()
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyDownloaded(t *testing.T) {
	dir := t.TempDir()
	body := append([]byte("MZ"), []byte("fake-exe-body")...)
	sum := sha256.Sum256(body)
	good := hex.EncodeToString(sum[:])
	p := filepath.Join(dir, "a.exe")
	writeFile(t, p, body)

	if err := verifyDownloaded(p, int64(len(body)), good); err != nil {
		t.Fatal(err)
	}
	if err := verifyDownloaded(p, int64(len(body)), strings.ToUpper(good)); err != nil {
		t.Fatalf("대문자 해시: %v", err)
	}
	if err := verifyDownloaded(p, int64(len(body)), ""); err != nil {
		t.Fatalf("체크섬 없이: %v", err)
	}
	if err := verifyDownloaded(p, int64(len(body))+1, good); err == nil {
		t.Fatal("크기 불일치는 실패해야 한다")
	}
	if err := verifyDownloaded(p, int64(len(body)), strings.Repeat("0", 64)); err == nil {
		t.Fatal("해시 불일치는 실패해야 한다")
	}
	bad := filepath.Join(dir, "b.exe")
	writeFile(t, bad, []byte("<html>not found</html>"))
	if err := verifyDownloaded(bad, 0, ""); err == nil {
		t.Fatal("MZ 가 아니면 실패해야 한다")
	}
	if err := verifyDownloaded(filepath.Join(dir, "none.exe"), 0, ""); err == nil {
		t.Fatal("없는 파일은 실패해야 한다")
	}
}

func TestSwapExecutable(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	nw := filepath.Join(dir, "app.exe.update-v2.tmp")
	writeFile(t, target, []byte("old"))
	writeFile(t, nw, []byte("new"))
	writeFile(t, target+".old", []byte("stale"))

	if err := swapExecutable(target, nw); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(target); string(b) != "new" {
		t.Fatalf("target = %q", b)
	}
	if b, _ := os.ReadFile(target + ".old"); string(b) != "old" {
		t.Fatalf(".old = %q", b)
	}
	if _, err := os.Stat(nw); !os.IsNotExist(err) {
		t.Fatal("tmp 가 남아 있다")
	}
}

func TestSwapExecutableRollback(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "app.exe")
	writeFile(t, target, []byte("old"))

	if err := swapExecutable(target, filepath.Join(dir, "missing.tmp")); err == nil {
		t.Fatal("새 파일이 없으면 실패해야 한다")
	}
	if b, _ := os.ReadFile(target); string(b) != "old" {
		t.Fatalf("원래 파일이 복구되어야 한다: %q", b)
	}
	if _, err := os.Stat(target + ".old"); !os.IsNotExist(err) {
		t.Fatal(".old 가 남아 있다")
	}
}

func TestCleanupOldFiles(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "app.exe")
	other := filepath.Join(dir, "keep.txt")
	writeFile(t, exe, []byte("x"))
	writeFile(t, exe+".old", []byte("x"))
	writeFile(t, exe+".update-v1.2.0.tmp", []byte("x"))
	writeFile(t, other, []byte("x"))
	cleanupOldFiles(exe)
	for _, p := range []string{exe + ".old", exe + ".update-v1.2.0.tmp"} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s 가 남아 있다", p)
		}
	}
	for _, p := range []string{exe, other} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s 는 남아야 한다", p)
		}
	}
}

func TestPsQuote(t *testing.T) {
	if got := psQuote(`C:\Users\O'Neil\a.exe`); got != `'C:\Users\O''Neil\a.exe'` {
		t.Fatal(got)
	}
}

func TestCheckWindowsReason(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"tag_name":"v1.2.0","assets":[{"name":"StockManager-v1.2.0-universal.dmg","browser_download_url":"https://example/dmg","size":1}]}`))
	}))
	defer srv.Close()
	u := New("v1.1.0")
	u.APIBase, u.GOOS, u.GOARCH = srv.URL, "windows", "amd64"
	res, err := u.Check(context.Background())
	if err != nil || !res.Available || res.CanInstall || res.Reason != "이 릴리스에 Windows 실행 파일이 없습니다" {
		t.Fatalf("%+v %v", res, err)
	}

	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"tag_name":"v1.2.0","assets":[{"name":"StockManager-v1.2.0-windows-amd64.exe","browser_download_url":"https://example/exe","size":9}]}`))
	}))
	defer srv2.Close()
	u.APIBase = srv2.URL
	res, _ = u.Check(context.Background())
	if !res.CanInstall || res.AssetName != "StockManager-v1.2.0-windows-amd64.exe" || res.Reason != "" {
		t.Fatalf("%+v", res)
	}
}
