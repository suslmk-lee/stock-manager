package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
)

// NormalizeJSONKeys 는 요청 본문의 camelCase 키를 snake_case 로 정규화한다.
// 프론트엔드가 두 표기를 섞어 보내도 핸들러의 json 태그와 맞도록 흡수하는 역할이다.
func NormalizeJSONKeys() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch:
		default:
			c.Next()
			return
		}

		contentType := strings.ToLower(strings.TrimSpace(c.GetHeader("Content-Type")))
		if contentType == "" || !strings.Contains(contentType, "application/json") {
			c.Next()
			return
		}

		rawBody, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.Next()
			return
		}

		if len(bytes.TrimSpace(rawBody)) == 0 {
			c.Request.Body = io.NopCloser(bytes.NewReader(rawBody))
			c.Next()
			return
		}

		normalizedBody, err := normalizeJSONBodyKeys(rawBody)
		if err != nil {
			// JSON 파싱 실패 시 원본 바디를 복원해 기존 바인딩/에러 흐름을 유지
			c.Request.Body = io.NopCloser(bytes.NewReader(rawBody))
			c.Next()
			return
		}

		c.Request.Body = io.NopCloser(bytes.NewReader(normalizedBody))
		c.Next()
	}
}

func normalizeJSONBodyKeys(body []byte) ([]byte, error) {
	var payload interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	normalized := normalizeJSONValueKeys(payload)
	return json.Marshal(normalized)
}

func normalizeJSONValueKeys(value interface{}) interface{} {
	switch v := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(v))
		for key, item := range v {
			out[toSnakeCaseKey(key)] = normalizeJSONValueKeys(item)
		}
		return out
	case []interface{}:
		for i := range v {
			v[i] = normalizeJSONValueKeys(v[i])
		}
		return v
	default:
		return value
	}
}

func toSnakeCaseKey(input string) string {
	if input == "" {
		return input
	}

	runes := []rune(input)
	var b strings.Builder
	b.Grow(len(input) + 4)

	for i, r := range runes {
		if unicode.IsUpper(r) {
			if i > 0 {
				prev := runes[i-1]
				hasNext := i+1 < len(runes)
				var next rune
				if hasNext {
					next = runes[i+1]
				}

				if unicode.IsLower(prev) || (unicode.IsUpper(prev) && hasNext && unicode.IsLower(next)) {
					b.WriteRune('_')
				}
			}
			b.WriteRune(unicode.ToLower(r))
			continue
		}

		b.WriteRune(r)
	}

	return b.String()
}
