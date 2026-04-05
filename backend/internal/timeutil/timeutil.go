// Package timeutil provides market-calendar time helpers.
package timeutil

import (
	"fmt"
	"strings"
	"time"
)

// MarketTZ is the US Eastern timezone (America/New_York), DST-aware.
var MarketTZ *time.Location

func init() {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		// Fallback: fixed UTC-5 (non-DST). In production containers the tz data is present.
		loc = time.FixedZone("EST", -5*60*60)
	}
	MarketTZ = loc
}

// MarketToday returns today's date in the US Eastern timezone.
func MarketToday() time.Time {
	now := time.Now().UTC().In(MarketTZ)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, MarketTZ)
}

// MarketDayBounds returns the UTC ISO-8601 start and end of a market calendar day.
func MarketDayBounds(day time.Time) (startISO, endISO string) {
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, MarketTZ).UTC()
	end := time.Date(day.Year(), day.Month(), day.Day(), 23, 59, 59, 0, MarketTZ).UTC()
	return start.Format(time.RFC3339), end.Format(time.RFC3339)
}

// ParseISODatetime parses common ISO-8601 datetime strings from Supabase JSON.
func ParseISODatetime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("empty datetime string")
	}
	// Supabase sometimes returns trailing Z
	if strings.HasSuffix(value, "Z") {
		value = value[:len(value)-1] + "+00:00"
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		t, err = time.Parse("2006-01-02T15:04:05.999999999-07:00", value)
		if err != nil {
			t, err = time.Parse("2006-01-02T15:04:05-07:00", value)
			if err != nil {
				t, err = time.Parse("2006-01-02T15:04:05", value)
				if err != nil {
					t, err = time.Parse("2006-01-02", value)
					if err != nil {
						return time.Time{}, fmt.Errorf("cannot parse datetime %q", value)
					}
					return t.UTC(), nil
				}
				return t.UTC(), nil
			}
		}
	}
	return t, nil
}

// DateAdd subtracts n days from t.
func DateAdd(t time.Time, days int) time.Time {
	return t.AddDate(0, 0, days)
}
