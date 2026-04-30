package services

import (
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	logoCacheTTL         = 24 * time.Hour
	logoNegativeCacheTTL = 6 * time.Hour
	fmpLogoBaseURL       = "https://financialmodelingprep.com/image-stock/"
)

type logoCacheEntry struct {
	logoURL   string
	found     bool
	expiresAt time.Time
}

var (
	logoCacheMu sync.RWMutex
	logoCache   = map[string]logoCacheEntry{}
	logoClient  = &http.Client{Timeout: 4 * time.Second}
)

func ResolveAssetLogoURL(ticker string) string {
	normalized := strings.ToUpper(strings.TrimSpace(ticker))
	if normalized == "" {
		return ""
	}

	if cached, ok := getCachedLogo(normalized); ok {
		if cached.found {
			return cached.logoURL
		}
		return ""
	}

	candidates := buildLogoCandidates(normalized)
	for _, candidate := range candidates {
		logoURL := fmpLogoBaseURL + url.PathEscape(candidate) + ".png"
		if isReachableLogo(logoURL) {
			setCachedLogo(normalized, logoCacheEntry{
				logoURL:   logoURL,
				found:     true,
				expiresAt: time.Now().Add(logoCacheTTL),
			})
			return logoURL
		}
	}

	setCachedLogo(normalized, logoCacheEntry{found: false, expiresAt: time.Now().Add(logoNegativeCacheTTL)})
	return ""
}

func buildLogoCandidates(ticker string) []string {
	seen := map[string]struct{}{}
	appendCandidate := func(result []string, value string) []string {
		value = strings.ToUpper(strings.TrimSpace(value))
		if value == "" {
			return result
		}
		if _, exists := seen[value]; exists {
			return result
		}
		seen[value] = struct{}{}
		return append(result, value)
	}

	result := []string{}
	result = appendCandidate(result, ticker)
	result = appendCandidate(result, strings.TrimSuffix(ticker, ".KS"))
	result = appendCandidate(result, strings.TrimSuffix(ticker, ".KQ"))
	result = appendCandidate(result, strings.ReplaceAll(ticker, ":", "."))
	result = appendCandidate(result, strings.ReplaceAll(ticker, ":", ""))
	return result
}

func isReachableLogo(logoURL string) bool {
	req, err := http.NewRequest(http.MethodHead, logoURL, nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", "stock-manager/1.0")

	resp, err := logoClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	return strings.Contains(contentType, "image")
}

func getCachedLogo(ticker string) (logoCacheEntry, bool) {
	logoCacheMu.RLock()
	entry, ok := logoCache[ticker]
	logoCacheMu.RUnlock()
	if !ok {
		return logoCacheEntry{}, false
	}
	if time.Now().After(entry.expiresAt) {
		logoCacheMu.Lock()
		delete(logoCache, ticker)
		logoCacheMu.Unlock()
		return logoCacheEntry{}, false
	}
	return entry, true
}

func setCachedLogo(ticker string, entry logoCacheEntry) {
	logoCacheMu.Lock()
	logoCache[ticker] = entry
	logoCacheMu.Unlock()
}
