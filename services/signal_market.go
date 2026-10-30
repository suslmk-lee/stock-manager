package services

import (
	"math"
	"sort"
	"time"
)

// PriceStats holds 52-week range and moving averages in local currency (0 when unavailable).
type PriceStats struct {
	High52w, Low52w, MA50, MA200 float64
	Points                       int // number of daily closes used
}

// ComputePriceStats computes stats from daily closes (any order). High/Low use the last
// 365 days relative to now; MA50/MA200 are simple averages of the most recent closes.
func ComputePriceStats(points []PricePoint, now time.Time) PriceStats {
	valid := make([]PricePoint, 0, len(points))
	for _, p := range points {
		if p.Close > 0 && !math.IsNaN(p.Close) && !math.IsInf(p.Close, 0) {
			valid = append(valid, p)
		}
	}
	sort.Slice(valid, func(i, j int) bool { return valid[i].Time < valid[j].Time })
	var st PriceStats
	st.Points = len(valid)
	cutoff := now.Unix() - 365*86400
	first := true
	for _, p := range valid {
		if p.Time < cutoff || p.Time > now.Unix() {
			continue
		}
		if first || p.Close > st.High52w {
			st.High52w = p.Close
		}
		if first || p.Close < st.Low52w {
			st.Low52w = p.Close
		}
		first = false
	}
	avg := func(n int) float64 {
		if len(valid) < n {
			return 0
		}
		s := 0.0
		for _, p := range valid[len(valid)-n:] {
			s += p.Close
		}
		return s / float64(n)
	}
	st.MA50, st.MA200 = avg(50), avg(200)
	return st
}
