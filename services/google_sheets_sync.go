package services

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"stock-manager/models"
)

const (
	googleSheetsScope = "https://www.googleapis.com/auth/spreadsheets"
	defaultTokenURI   = "https://oauth2.googleapis.com/token"
)

type googleServiceAccountCredential struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

type googleTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	TokenType   string `json:"token_type"`
}

type googleSheetsValueResponse struct {
	Range  string          `json:"range"`
	Values [][]interface{} `json:"values"`
}

type sheetRowCandidate struct {
	RowIndex    int
	Score       int
	CurrentCell float64
}

type sheetSnapshot struct {
	Rows       [][]interface{}
	BrokerCol  int
	AccountCol int
	TargetCol  int
	TickerCol  int
	MonthCols  map[int]int
}

type GoogleSheetsDividendSync struct {
	spreadsheetID string
	worksheet     string
	credentials   googleServiceAccountCredential
	httpClient    *http.Client

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time
}

func NewGoogleSheetsDividendSyncFromEnv() (*GoogleSheetsDividendSync, error) {
	if !envBool("GOOGLE_SHEETS_ENABLED") {
		return nil, nil
	}

	spreadsheetID := strings.TrimSpace(os.Getenv("GOOGLE_SHEETS_SPREADSHEET_ID"))
	if spreadsheetID == "" {
		return nil, errors.New("GOOGLE_SHEETS_SPREADSHEET_ID is required when GOOGLE_SHEETS_ENABLED=true")
	}

	worksheet := strings.TrimSpace(os.Getenv("GOOGLE_SHEETS_WORKSHEET"))
	if worksheet == "" {
		worksheet = strconv.Itoa(time.Now().Year())
	}

	credentials, err := loadGoogleServiceAccountCredential()
	if err != nil {
		return nil, err
	}

	return &GoogleSheetsDividendSync{
		spreadsheetID: spreadsheetID,
		worksheet:     worksheet,
		credentials:   credentials,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}, nil
}

func (s *GoogleSheetsDividendSync) ApplyDelta(account models.Account, asset models.Asset, paymentDate time.Time, delta float64) error {
	if s == nil || delta == 0 {
		return nil
	}

	month := int(paymentDate.Month())
	if month < 1 || month > 12 {
		return fmt.Errorf("invalid payment month: %d", month)
	}

	snapshot, err := s.readSheetSnapshot()
	if err != nil {
		return err
	}

	monthCol, ok := snapshot.MonthCols[month]
	if !ok || monthCol < 0 {
		return fmt.Errorf("month column not found: %d월", month)
	}

	candidate, err := snapshot.findRowCandidate(account, asset, monthCol)
	if err != nil {
		return err
	}

	updatedValue := round2(candidate.CurrentCell + delta)
	if updatedValue < 0 && math.Abs(updatedValue) < 0.01 {
		updatedValue = 0
	}

	cell := fmt.Sprintf("%s%d", columnNumberToLetters(monthCol+1), candidate.RowIndex)
	targetRange := fmt.Sprintf("%s!%s", quoteSheetName(s.worksheet), cell)
	return s.updateSingleCell(targetRange, updatedValue)
}

func (s *GoogleSheetsDividendSync) readSheetSnapshot() (*sheetSnapshot, error) {
	readRange := fmt.Sprintf("%s!A:V", quoteSheetName(s.worksheet))
	resBody, err := s.getSheetValues(readRange)
	if err != nil {
		return nil, err
	}

	if len(resBody.Values) == 0 {
		return nil, errors.New("worksheet has no rows")
	}

	header := resBody.Values[0]
	brokerCol := findHeaderIndex(header, []string{"증권사"})
	accountCol := findHeaderIndex(header, []string{"계좌"})
	targetCol := findHeaderIndex(header, []string{"대상"})
	tickerCol := findHeaderIndex(header, []string{"티커"})

	if tickerCol < 0 {
		return nil, errors.New("header '티커' not found")
	}

	monthCols := map[int]int{}
	for month := 1; month <= 12; month++ {
		label := fmt.Sprintf("%d월", month)
		col := findHeaderIndex(header, []string{label})
		if col < 0 {
			col = 10 + (month - 1) // fallback: K~V
		}
		monthCols[month] = col
	}

	return &sheetSnapshot{
		Rows:       resBody.Values,
		BrokerCol:  brokerCol,
		AccountCol: accountCol,
		TargetCol:  targetCol,
		TickerCol:  tickerCol,
		MonthCols:  monthCols,
	}, nil
}

func (s *sheetSnapshot) findRowCandidate(account models.Account, asset models.Asset, monthCol int) (*sheetRowCandidate, error) {
	if len(s.Rows) <= 1 {
		return nil, errors.New("worksheet has no data rows")
	}

	targetTickers := buildTickerMatchValues(asset.Ticker)
	if len(targetTickers) == 0 {
		return nil, errors.New("asset ticker is empty")
	}

	aliases := buildAccountAliases(account)
	targetLabel := expectedTargetLabel(account)
	var tickerMatches []sheetRowCandidate

	for idx := 1; idx < len(s.Rows); idx++ {
		row := s.Rows[idx]
		rowTicker := strings.ToUpper(strings.TrimSpace(cellText(row, s.TickerCol)))
		if rowTicker == "" || !tickerMatches(rowTicker, targetTickers) {
			continue
		}

		score := 0
		if s.AccountCol >= 0 {
			accountValue := normalizeCellValue(s.effectiveCellText(idx, s.AccountCol))
			if accountValue != "" && aliasMatch(accountValue, aliases) {
				score += 2
			}
		}
		if s.BrokerCol >= 0 {
			brokerValue := normalizeCellValue(s.effectiveCellText(idx, s.BrokerCol))
			if brokerValue != "" && aliasMatch(brokerValue, aliases) {
				score += 1
			}
		}
		if targetLabel != "" && s.TargetCol >= 0 {
			rowTarget := normalizeCellValue(s.effectiveCellText(idx, s.TargetCol))
			if rowTarget == normalizeCellValue(targetLabel) {
				score += 2
			}
		}

		tickerMatches = append(tickerMatches, sheetRowCandidate{
			RowIndex:    idx + 1,
			Score:       score,
			CurrentCell: cellNumber(row, monthCol),
		})
	}

	if len(tickerMatches) == 0 {
		return nil, fmt.Errorf("row not found for ticker=%s", targetTicker)
	}
	if len(tickerMatches) == 1 {
		return &tickerMatches[0], nil
	}

	maxScore := -1
	maxScoreCount := 0
	bestIdx := -1
	for i, c := range tickerMatches {
		if c.Score > maxScore {
			maxScore = c.Score
			maxScoreCount = 1
			bestIdx = i
			continue
		}
		if c.Score == maxScore {
			maxScoreCount++
		}
	}

	if maxScore > 0 && maxScoreCount == 1 {
		return &tickerMatches[bestIdx], nil
	}

	return nil, fmt.Errorf("ambiguous rows for ticker=%s (matches=%d)", targetTickers[0], len(tickerMatches))
}

func (s *sheetSnapshot) effectiveCellText(rowIndex int, col int) string {
	if col < 0 || rowIndex <= 0 || rowIndex >= len(s.Rows) {
		return ""
	}

	for i := rowIndex; i >= 1; i-- {
		value := cellText(s.Rows[i], col)
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}

func (s *GoogleSheetsDividendSync) getSheetValues(readRange string) (*googleSheetsValueResponse, error) {
	q := url.Values{}
	q.Set("majorDimension", "ROWS")
	q.Set("valueRenderOption", "UNFORMATTED_VALUE")
	q.Set("dateTimeRenderOption", "SERIAL_NUMBER")

	path := "/values/" + url.PathEscape(readRange)
	resBody, err := s.doSheetsRequest(http.MethodGet, path, q, nil)
	if err != nil {
		return nil, err
	}

	var parsed googleSheetsValueResponse
	if err := json.Unmarshal(resBody, &parsed); err != nil {
		return nil, fmt.Errorf("failed to parse sheet values response: %w", err)
	}
	return &parsed, nil
}

func (s *GoogleSheetsDividendSync) updateSingleCell(cellRange string, value float64) error {
	payload := map[string]interface{}{
		"range":          cellRange,
		"majorDimension": "ROWS",
		"values":         [][]interface{}{{value}},
	}

	rawBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal sheet update payload: %w", err)
	}

	q := url.Values{}
	q.Set("valueInputOption", "USER_ENTERED")
	q.Set("includeValuesInResponse", "false")

	path := "/values/" + url.PathEscape(cellRange)
	_, err = s.doSheetsRequest(http.MethodPut, path, q, rawBody)
	if err != nil {
		return err
	}
	return nil
}

func (s *GoogleSheetsDividendSync) doSheetsRequest(method, path string, query url.Values, body []byte) ([]byte, error) {
	accessToken, err := s.getAccessToken()
	if err != nil {
		return nil, err
	}

	endpoint := fmt.Sprintf("https://sheets.googleapis.com/v4/spreadsheets/%s%s", url.PathEscape(s.spreadsheetID), path)
	if encoded := query.Encode(); encoded != "" {
		endpoint += "?" + encoded
	}

	req, err := http.NewRequest(method, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create sheets request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sheets request failed: %w", err)
	}
	defer resp.Body.Close()

	resBody, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, fmt.Errorf("failed to read sheets response: %w", readErr)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("sheets api error: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(resBody)))
	}
	return resBody, nil
}

func (s *GoogleSheetsDividendSync) getAccessToken() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.accessToken != "" && time.Now().Before(s.tokenExpiry.Add(-1*time.Minute)) {
		return s.accessToken, nil
	}

	tokenRes, err := s.fetchAccessToken()
	if err != nil {
		return "", err
	}

	s.accessToken = tokenRes.AccessToken
	expiresIn := tokenRes.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	s.tokenExpiry = time.Now().Add(time.Duration(expiresIn) * time.Second)
	return s.accessToken, nil
}

func (s *GoogleSheetsDividendSync) fetchAccessToken() (*googleTokenResponse, error) {
	jwtAssertion, err := s.createJWTAssertion()
	if err != nil {
		return nil, err
	}

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", jwtAssertion)

	req, err := http.NewRequest(http.MethodPost, s.credentials.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create oauth token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oauth token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, fmt.Errorf("failed to read oauth token response: %w", readErr)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("oauth token error: status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var tokenRes googleTokenResponse
	if err := json.Unmarshal(body, &tokenRes); err != nil {
		return nil, fmt.Errorf("failed to parse oauth token response: %w", err)
	}
	if tokenRes.AccessToken == "" {
		return nil, errors.New("oauth token response missing access_token")
	}

	return &tokenRes, nil
}

func (s *GoogleSheetsDividendSync) createJWTAssertion() (string, error) {
	privateKey, err := parseRSAPrivateKey(s.credentials.PrivateKey)
	if err != nil {
		return "", fmt.Errorf("failed to parse private key: %w", err)
	}

	now := time.Now()
	header := map[string]string{
		"alg": "RS256",
		"typ": "JWT",
	}
	claims := map[string]interface{}{
		"iss":   s.credentials.ClientEmail,
		"scope": googleSheetsScope,
		"aud":   s.credentials.TokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(1 * time.Hour).Unix(),
	}

	headerJSON, _ := json.Marshal(header)
	claimsJSON, _ := json.Marshal(claims)

	unsigned := base64.RawURLEncoding.EncodeToString(headerJSON) + "." + base64.RawURLEncoding.EncodeToString(claimsJSON)
	hash := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, hash[:])
	if err != nil {
		return "", fmt.Errorf("failed to sign jwt: %w", err)
	}

	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func parseRSAPrivateKey(rawKey string) (*rsa.PrivateKey, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(rawKey), `\n`, "\n")
	block, _ := pem.Decode([]byte(normalized))
	if block == nil {
		return nil, errors.New("invalid PEM private key")
	}

	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}

	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}

	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("private key is not RSA")
	}
	return rsaKey, nil
}

func loadGoogleServiceAccountCredential() (googleServiceAccountCredential, error) {
	rawJSON := strings.TrimSpace(os.Getenv("GOOGLE_SHEETS_CREDENTIALS_JSON"))
	credentialFile := strings.TrimSpace(os.Getenv("GOOGLE_SHEETS_CREDENTIALS_FILE"))

	if rawJSON == "" && credentialFile == "" {
		return googleServiceAccountCredential{}, errors.New("set GOOGLE_SHEETS_CREDENTIALS_FILE or GOOGLE_SHEETS_CREDENTIALS_JSON")
	}

	if rawJSON == "" {
		data, err := os.ReadFile(credentialFile)
		if err != nil {
			return googleServiceAccountCredential{}, fmt.Errorf("failed to read credentials file: %w", err)
		}
		rawJSON = string(data)
	}

	var credential googleServiceAccountCredential
	if err := json.Unmarshal([]byte(rawJSON), &credential); err != nil {
		return googleServiceAccountCredential{}, fmt.Errorf("failed to parse service account credentials: %w", err)
	}

	// Common misconfiguration: OAuth client secret JSON (installed/web) instead of service account JSON.
	var generic map[string]interface{}
	if err := json.Unmarshal([]byte(rawJSON), &generic); err == nil {
		if _, hasInstalled := generic["installed"]; hasInstalled {
			return googleServiceAccountCredential{}, errors.New("invalid credentials json: got OAuth client secret (installed), need service account key json")
		}
		if _, hasWeb := generic["web"]; hasWeb {
			return googleServiceAccountCredential{}, errors.New("invalid credentials json: got OAuth client secret (web), need service account key json")
		}
	}

	credential.ClientEmail = strings.TrimSpace(credential.ClientEmail)
	credential.PrivateKey = strings.TrimSpace(credential.PrivateKey)
	credential.TokenURI = strings.TrimSpace(credential.TokenURI)

	if credential.ClientEmail == "" || credential.PrivateKey == "" {
		return googleServiceAccountCredential{}, errors.New("credentials missing client_email/private_key (service account key required)")
	}
	if credential.TokenURI == "" {
		credential.TokenURI = defaultTokenURI
	}

	return credential, nil
}

func envBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "t", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func findHeaderIndex(header []interface{}, names []string) int {
	lookup := make(map[string]struct{}, len(names))
	for _, name := range names {
		lookup[normalizeCellValue(name)] = struct{}{}
	}
	for i, cell := range header {
		if _, ok := lookup[normalizeCellValue(interfaceToString(cell))]; ok {
			return i
		}
	}
	return -1
}

func buildAccountAliases(account models.Account) []string {
	rawAliases := []string{
		account.Name,
		account.Broker,
		account.AccountNumber,
	}

	extra := []string{}
	for _, alias := range rawAliases {
		alias = strings.TrimSpace(alias)
		if alias == "" {
			continue
		}

		if idx := strings.Index(alias, "("); idx >= 0 {
			extra = append(extra, strings.TrimSpace(alias[:idx]))
			if right := strings.Index(alias[idx+1:], ")"); right >= 0 {
				extra = append(extra, strings.TrimSpace(alias[idx+1:idx+1+right]))
			}
		}
	}
	rawAliases = append(rawAliases, extra...)

	seen := map[string]struct{}{}
	result := []string{}
	for _, alias := range rawAliases {
		normalized := normalizeCellValue(alias)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}

func aliasMatch(target string, aliases []string) bool {
	target = normalizeCellValue(target)
	if target == "" {
		return false
	}
	for _, alias := range aliases {
		if alias == "" {
			continue
		}
		if target == alias {
			return true
		}
		if runeLen(alias) >= 4 && strings.Contains(target, alias) {
			return true
		}
		if runeLen(target) >= 4 && strings.Contains(alias, target) {
			return true
		}
	}
	return false
}

func normalizeCellValue(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		" ", "",
		"\t", "",
		"-", "",
		"_", "",
		"/", "",
		"\\", "",
		"(", "",
		")", "",
		"[", "",
		"]", "",
	)
	return replacer.Replace(value)
}

func normalizeTickerText(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		" ", "",
		"\t", "",
		"-", "",
		"_", "",
		"/", "",
		"\\", "",
	)
	return replacer.Replace(value)
}

func stripTickerSuffix(ticker string) string {
	ticker = normalizeTickerText(ticker)
	if ticker == "" {
		return ""
	}

	switch {
	case strings.HasSuffix(ticker, ".KS"):
		return strings.TrimSuffix(ticker, ".KS")
	case strings.HasSuffix(ticker, ".KQ"):
		return strings.TrimSuffix(ticker, ".KQ")
	default:
		return ticker
	}
}

func buildTickerMatchValues(ticker string) []string {
	cleaned := normalizeTickerText(ticker)
	if cleaned == "" {
		return nil
	}

	seen := map[string]struct{}{}
	result := []string{}
	candidates := []string{cleaned}
	if stripped := stripTickerSuffix(cleaned); stripped != "" && stripped != cleaned {
		candidates = append(candidates, stripped)
	}

	for _, candidate := range candidates {
		normalized := strings.ToLower(normalizeCellValue(candidate))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}

	return result
}

func tickerMatches(rowTicker string, targetTickers []string) bool {
	row := strings.ToLower(normalizeTickerText(rowTicker))
	if row == "" {
		return false
	}

	rowBase := strings.ToLower(normalizeCellValue(stripTickerSuffix(row)))
	for _, target := range targetTickers {
		if target == "" {
			continue
		}
		if row == target || rowBase == target {
			return true
		}
	}

	return false
}

func cellText(row []interface{}, col int) string {
	if col < 0 || col >= len(row) {
		return ""
	}
	return strings.TrimSpace(interfaceToString(row[col]))
}

func cellNumber(row []interface{}, col int) float64 {
	if col < 0 || col >= len(row) {
		return 0
	}
	return parseFloat(row[col])
}

func interfaceToString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case json.Number:
		return t.String()
	default:
		return fmt.Sprintf("%v", t)
	}
}

func parseFloat(v interface{}) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		cleaned := strings.ReplaceAll(strings.TrimSpace(t), ",", "")
		if cleaned == "" {
			return 0
		}
		f, err := strconv.ParseFloat(cleaned, 64)
		if err != nil {
			return 0
		}
		return f
	default:
		return 0
	}
}

func quoteSheetName(name string) string {
	safe := strings.ReplaceAll(name, "'", "''")
	return "'" + safe + "'"
}

func columnNumberToLetters(col int) string {
	if col <= 0 {
		return ""
	}
	letters := ""
	for col > 0 {
		col--
		letters = string(rune('A'+(col%26))) + letters
		col /= 26
	}
	return letters
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func runeLen(s string) int {
	return len([]rune(s))
}

func expectedTargetLabel(account models.Account) string {
	switch account.MarketType {
	case models.MarketTypeDomestic:
		return "국내"
	case models.MarketTypeInternational:
		return "해외"
	default:
		return ""
	}
}
