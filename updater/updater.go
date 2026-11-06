// Package updater 는 GitHub Releases 의 최신 버전을 확인하고 (macOS 에서는) 앱을 내려받아 교체한다.
package updater

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Repo 는 릴리스를 올리는 GitHub 저장소다 (태그 v1.2.3 → Actions 가 DMG 를 만들어 Release 에 첨부).
const Repo = "suslmk-lee/stock-manager"

// ErrUnsupported 는 이 운영체제에서 자동 설치를 할 수 없을 때 돌려준다.
var ErrUnsupported = errors.New("이 운영체제는 자동 설치를 지원하지 않습니다")

// Version 은 "v1.2.3", "v1.2.3-5-gabc1234", "v1.2.3-5-gabc1234-dirty" 같은 git describe 형식을 읽은 값이다.
type Version struct {
	Major, Minor, Patch int
	Ahead               int // 태그 이후 커밋 수 (릴리스 빌드는 0)
	Valid               bool
}

var versionRe = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-(\d+)-g[0-9a-f]+)?(?:-dirty)?$`)

// Parse 는 버전 문자열을 읽는다. 형식이 다르면 Valid=false (예: 개발 빌드 "dev").
func Parse(s string) Version {
	m := versionRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return Version{}
	}
	n := func(x string) int {
		v, _ := strconv.Atoi(x)
		return v
	}
	return Version{Major: n(m[1]), Minor: n(m[2]), Patch: n(m[3]), Ahead: n(m[4]), Valid: true}
}

// Newer 는 latest 릴리스가 current 보다 새 버전인지 본다.
// 같은 태그 위의 개발 빌드(v1.2.3-5-g…)는 그 릴리스보다 새것으로 본다.
func Newer(latest, current Version) bool {
	if !latest.Valid || !current.Valid {
		return false
	}
	a := [3]int{latest.Major, latest.Minor, latest.Patch}
	b := [3]int{current.Major, current.Minor, current.Patch}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

type Asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

type Release struct {
	Tag         string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []Asset   `json:"assets"`
}

// PickAsset 은 이 컴퓨터에 맞는 설치 파일을 고른다. macOS 만: .dmg 중 universal → 아키텍처 이름 순.
func PickAsset(assets []Asset, goos, goarch string) *Asset {
	if goos != "darwin" {
		return nil
	}
	archNames := map[string][]string{"arm64": {"arm64"}, "amd64": {"amd64", "x86_64", "intel"}}[goarch]
	var dmgs []Asset
	for _, a := range assets {
		if strings.HasSuffix(strings.ToLower(a.Name), ".dmg") {
			dmgs = append(dmgs, a)
		}
	}
	for _, want := range append([]string{"universal"}, archNames...) {
		for i := range dmgs {
			if strings.Contains(strings.ToLower(dmgs[i].Name), want) {
				return &dmgs[i]
			}
		}
	}
	return nil
}

// CheckResult 는 프론트엔드에 넘기는 확인 결과다.
type CheckResult struct {
	Supported   bool      `json:"supported"` // 버전을 알 수 있는 빌드인지 (개발 빌드는 false)
	Current     string    `json:"current"`
	Latest      string    `json:"latest,omitempty"`
	Available   bool      `json:"available"`
	CanInstall  bool      `json:"can_install"` // 앱 안에서 바로 설치할 수 있는지 (macOS + DMG 있음)
	Notes       string    `json:"notes,omitempty"`
	URL         string    `json:"url,omitempty"`
	PublishedAt string    `json:"published_at,omitempty"`
	AssetName   string    `json:"asset_name,omitempty"`
	AssetSize   int64     `json:"asset_size,omitempty"`
	Reason      string    `json:"reason,omitempty"`
	CheckedAt   time.Time `json:"checked_at"`
}

// Progress 는 설치 진행 상황이다 (phase: download | extract | verify | restart).
type Progress struct {
	Phase   string  `json:"phase"`
	Percent float64 `json:"percent"`
}

type Updater struct {
	Current string
	Client  *http.Client
	APIBase string
	GOOS    string
	GOARCH  string

	mu   sync.Mutex
	last *Release
}

func New(current string) *Updater {
	return &Updater{
		Current: current,
		Client:  &http.Client{Timeout: 20 * time.Second},
		APIBase: "https://api.github.com",
		GOOS:    runtime.GOOS,
		GOARCH:  runtime.GOARCH,
	}
}

// Latest 는 최신 정식 릴리스를 가져온다 (초안·사전 릴리스 제외). 릴리스가 하나도 없으면 nil.
func (u *Updater) Latest(ctx context.Context) (*Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/repos/%s/releases/latest", u.APIBase, Repo), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "stock-manager-updater")
	resp, err := u.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("릴리스 정보를 가져오지 못했습니다: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("릴리스 정보를 가져오지 못했습니다 (HTTP %d)", resp.StatusCode)
	}
	var rel Release
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("릴리스 정보를 읽지 못했습니다: %w", err)
	}
	return &rel, nil
}

// Check 는 새 버전이 있는지 확인한다.
func (u *Updater) Check(ctx context.Context) (*CheckResult, error) {
	res := &CheckResult{Current: u.Current, CheckedAt: time.Now()}
	cur := Parse(u.Current)
	if !cur.Valid {
		res.Reason = "개발 빌드라 업데이트를 확인하지 않습니다"
		return res, nil
	}
	res.Supported = true

	rel, err := u.Latest(ctx)
	if err != nil {
		return nil, err
	}
	u.mu.Lock()
	u.last = rel
	u.mu.Unlock()
	if rel == nil {
		return res, nil
	}

	res.Latest = rel.Tag
	res.Notes = rel.Body
	res.URL = rel.HTMLURL
	if !rel.PublishedAt.IsZero() {
		res.PublishedAt = rel.PublishedAt.Format(time.RFC3339)
	}
	res.Available = Newer(Parse(rel.Tag), cur)
	if !res.Available {
		return res, nil
	}
	if a := PickAsset(rel.Assets, u.GOOS, u.GOARCH); a != nil {
		res.CanInstall = true
		res.AssetName = a.Name
		res.AssetSize = a.Size
	} else if u.GOOS == "darwin" {
		res.Reason = "이 릴리스에 macOS 설치 파일(DMG)이 없습니다"
	} else {
		res.Reason = ErrUnsupported.Error() + ". 릴리스 페이지에서 내려받으세요"
	}
	return res, nil
}

// shQuote 는 sh 에 그대로 넣을 수 있게 작은따옴표로 감싼다.
func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// pending 은 설치할 릴리스와 파일을 고른다 (최근 확인 결과가 없으면 다시 확인).
func (u *Updater) pending(ctx context.Context) (*Release, *Asset, error) {
	u.mu.Lock()
	rel := u.last
	u.mu.Unlock()
	if rel == nil {
		r, err := u.Latest(ctx)
		if err != nil {
			return nil, nil, err
		}
		rel = r
	}
	if rel == nil || !Newer(Parse(rel.Tag), Parse(u.Current)) {
		return nil, nil, errors.New("설치할 새 버전이 없습니다")
	}
	a := PickAsset(rel.Assets, u.GOOS, u.GOARCH)
	if a == nil {
		return nil, nil, ErrUnsupported
	}
	return rel, a, nil
}
