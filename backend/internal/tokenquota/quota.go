// Package tokenquota implements a sliding-window in-memory token quota per IP.
package tokenquota

import (
	"sync"
	"time"
)

// Snapshot describes the quota state for a single IP.
type Snapshot struct {
	Limit         int
	Used          int
	Remaining     int
	WindowSeconds int
}

// Quota enforces a rolling-window token budget per IP address.
type Quota struct {
	tokensPerWindow int
	windowSeconds   int64
	mu              sync.Mutex
	used            map[string][2]int64 // ip -> [windowID, count]
}

// NewQuota creates a new Quota. Pass tokensPerWindow=0 to disable.
func NewQuota(tokensPerWindow, windowSeconds int) *Quota {
	if tokensPerWindow < 0 {
		tokensPerWindow = 0
	}
	if windowSeconds <= 0 {
		windowSeconds = 86400
	}
	return &Quota{
		tokensPerWindow: tokensPerWindow,
		windowSeconds:   int64(windowSeconds),
		used:            make(map[string][2]int64),
	}
}

// Enabled returns true when the quota is active (limit > 0).
func (q *Quota) Enabled() bool { return q.tokensPerWindow > 0 }

func (q *Quota) windowID(now int64) int64 {
	return now / q.windowSeconds
}

// Snapshot returns the current quota state for ip without consuming tokens.
func (q *Quota) Snapshot(ip string) Snapshot {
	now := time.Now().Unix()
	wid := q.windowID(now)
	q.mu.Lock()
	rec := q.used[ip]
	used := 0
	if rec[0] == wid {
		used = int(rec[1])
	}
	q.mu.Unlock()
	lim := q.tokensPerWindow
	rem := 0
	if lim > 0 {
		if r := lim - used; r > 0 {
			rem = r
		}
	}
	return Snapshot{Limit: lim, Used: used, Remaining: rem, WindowSeconds: int(q.windowSeconds)}
}

// TryConsume tries to consume `tokens` from ip's quota.
// Returns nil if the quota is exceeded; otherwise returns the updated Snapshot.
func (q *Quota) TryConsume(ip string, tokens int) *Snapshot {
	if !q.Enabled() {
		s := Snapshot{WindowSeconds: int(q.windowSeconds)}
		return &s
	}
	if tokens < 0 {
		tokens = 0
	}
	now := time.Now().Unix()
	wid := q.windowID(now)
	q.mu.Lock()
	rec := q.used[ip]
	used := int64(0)
	if rec[0] == wid {
		used = rec[1]
	}
	lim := int64(q.tokensPerWindow)
	if used+int64(tokens) > lim {
		q.mu.Unlock()
		return nil
	}
	used += int64(tokens)
	q.used[ip] = [2]int64{wid, used}
	q.mu.Unlock()
	rem := int(lim - used)
	if rem < 0 {
		rem = 0
	}
	snap := &Snapshot{Limit: q.tokensPerWindow, Used: int(used), Remaining: rem, WindowSeconds: int(q.windowSeconds)}
	return snap
}

// EstimateTokens returns a rough token count for the given text (~4 chars per token).
func EstimateTokens(text string) int {
	if text == "" {
		return 0
	}
	n := (len(text) + 3) / 4
	if n < 1 {
		n = 1
	}
	return n
}

// ClientIP extracts the real client IP from the request, preferring X-Forwarded-For.
func ClientIP(xForwardedFor, remoteAddr string) string {
	if xForwardedFor != "" {
		parts := splitFirst(xForwardedFor, ",")
		if ip := trimSpace(parts); ip != "" {
			return ip
		}
	}
	if remoteAddr != "" {
		// strip port
		if idx := lastIndex(remoteAddr, ":"); idx >= 0 {
			host := remoteAddr[:idx]
			if host != "" {
				return host
			}
		}
		return remoteAddr
	}
	return "unknown"
}

func splitFirst(s, sep string) string {
	for i := 0; i < len(s); i++ {
		if string(s[i]) == sep {
			return s[:i]
		}
	}
	return s
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

func lastIndex(s, substr string) int {
	idx := -1
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			idx = i
		}
	}
	return idx
}
