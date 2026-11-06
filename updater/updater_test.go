package updater

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParse(t *testing.T) {
	cases := []struct {
		in    string
		valid bool
		v     [4]int
	}{
		{"v1.2.3", true, [4]int{1, 2, 3, 0}},
		{"1.2.3", true, [4]int{1, 2, 3, 0}},
		{"v1.0.0-171-g2074a0c", true, [4]int{1, 0, 0, 171}},
		{"v1.0.0-171-g2074a0c-dirty", true, [4]int{1, 0, 0, 171}},
		{"v2.10.4-dirty", true, [4]int{2, 10, 4, 0}},
		{"dev", false, [4]int{}},
		{"2074a0c", false, [4]int{}},
		{"", false, [4]int{}},
	}
	for _, c := range cases {
		got := Parse(c.in)
		if got.Valid != c.valid || [4]int{got.Major, got.Minor, got.Patch, got.Ahead} != c.v {
			t.Errorf("Parse(%q) = %+v", c.in, got)
		}
	}
}

func TestNewer(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"v1.1.0", "v1.0.0", true},
		{"v1.0.1", "v1.0.0-171-gabc1234", true},
		{"v1.0.0", "v1.0.0-171-gabc1234", false}, // 같은 태그 위 개발 빌드가 더 새것
		{"v1.0.0", "v1.0.0", false},
		{"v1.9.9", "v1.10.0", false},
		{"v2.0.0", "v1.99.99", true},
		{"v1.1.0", "dev", false},
	}
	for _, c := range cases {
		if got := Newer(Parse(c.latest), Parse(c.current)); got != c.want {
			t.Errorf("Newer(%s, %s) = %v, want %v", c.latest, c.current, got, c.want)
		}
	}
}

func TestPickAsset(t *testing.T) {
	assets := []Asset{{Name: "notes.txt"}, {Name: "StockManager-v1.1.0-arm64.dmg"}, {Name: "StockManager-v1.1.0-universal.dmg"}}
	if a := PickAsset(assets, "darwin", "arm64"); a == nil || a.Name != "StockManager-v1.1.0-universal.dmg" {
		t.Fatalf("universal 을 먼저 골라야 한다: %+v", a)
	}
	if a := PickAsset(assets[:2], "darwin", "arm64"); a == nil || a.Name != "StockManager-v1.1.0-arm64.dmg" {
		t.Fatalf("아키텍처 DMG 를 골라야 한다: %+v", a)
	}
	if a := PickAsset(assets[:2], "darwin", "amd64"); a != nil {
		t.Fatalf("Intel 맥에 arm64 전용 DMG 를 고르면 안 된다: %+v", a)
	}
	if a := PickAsset(assets, "windows", "amd64"); a != nil {
		t.Fatalf("Windows 는 자동 설치 파일이 없다: %+v", a)
	}
}

func TestCheck(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/"+Repo+"/releases/latest" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(`{"tag_name":"v1.2.0","body":"변경 사항","html_url":"https://github.com/x/y/releases/tag/v1.2.0",
		  "published_at":"2026-11-06T10:00:00Z","assets":[{"name":"StockManager-v1.2.0-universal.dmg","browser_download_url":"https://example/dmg","size":123}]}`))
	}))
	defer srv.Close()

	u := New("v1.1.0")
	u.APIBase, u.GOOS, u.GOARCH = srv.URL, "darwin", "arm64"
	res, err := u.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.Supported || !res.Available || !res.CanInstall || res.Latest != "v1.2.0" || res.AssetSize != 123 {
		t.Fatalf("unexpected: %+v", res)
	}

	u2 := New("v1.2.0-3-gabc1234")
	u2.APIBase, u2.GOOS = srv.URL, "darwin"
	if res, _ := u2.Check(context.Background()); res.Available {
		t.Fatalf("같은 버전 위 개발 빌드에는 업데이트가 없어야 한다: %+v", res)
	}

	u3 := New("v1.1.0")
	u3.APIBase, u3.GOOS = srv.URL, "windows"
	if res, _ := u3.Check(context.Background()); !res.Available || res.CanInstall || res.Reason == "" {
		t.Fatalf("Windows 는 새 버전은 알리되 자동 설치는 못 해야 한다: %+v", res)
	}

	dev := New("dev")
	if res, _ := dev.Check(context.Background()); res.Supported {
		t.Fatalf("개발 빌드는 확인하지 않아야 한다: %+v", res)
	}
}

func TestCheckNoReleases(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	u := New("v1.0.0")
	u.APIBase = srv.URL
	res, err := u.Check(context.Background())
	if err != nil || res.Available || !res.Supported {
		t.Fatalf("릴리스가 없으면 업데이트 없음: %+v %v", res, err)
	}
}

func TestShQuote(t *testing.T) {
	if got := shQuote("/Applications/Stock Manager.app"); got != `'/Applications/Stock Manager.app'` {
		t.Fatal(got)
	}
	if got := shQuote("it's"); got != `'it'\''s'` {
		t.Fatal(got)
	}
}
