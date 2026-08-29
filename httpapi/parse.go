package httpapi

import (
	"errors"
	"time"
)

// parseDate 는 프론트엔드가 보내는 여러 날짜 표기를 허용한다.
func parseDate(dateStr string) (time.Time, error) {
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, dateStr); err == nil {
			return t, nil
		}
	}
	return time.Time{}, errors.New("invalid date format")
}
