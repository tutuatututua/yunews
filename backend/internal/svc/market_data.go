package svc

import (
	"fmt"
	"sync"
	"time"

	"yunews/backend/internal/repo"
)

// CloseBar wraps a market close price for a single date.
type CloseBar = repo.CloseBar

// marketDataCache caches daily close series by (symbol, start, end) with TTL.
type marketDataCache struct {
	mu      sync.Mutex
	store   map[string]cacheEntry
	ttl     time.Duration
	maxSize int
}

type cacheEntry struct {
	data      []CloseBar
	storedAt  time.Time
}

func newMarketDataCache(ttl time.Duration, maxSize int) *marketDataCache {
	return &marketDataCache{
		store:   map[string]cacheEntry{},
		ttl:     ttl,
		maxSize: maxSize,
	}
}

func (c *marketDataCache) get(key string) ([]CloseBar, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.store[key]
	if !ok {
		return nil, false
	}
	if time.Since(e.storedAt) > c.ttl {
		delete(c.store, key)
		return nil, false
	}
	return e.data, true
}

func (c *marketDataCache) set(key string, data []CloseBar) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.store) >= c.maxSize {
		// Evict the oldest entry
		oldest := ""
		var oldestTime time.Time
		for k, e := range c.store {
			if oldest == "" || e.storedAt.Before(oldestTime) {
				oldest = k
				oldestTime = e.storedAt
			}
		}
		if oldest != "" {
			delete(c.store, oldest)
		}
	}
	c.store[key] = cacheEntry{data: data, storedAt: time.Now()}
}

// MarketDataService fetches daily close prices with in-memory TTL caching.
type MarketDataService struct {
	repo  *repo.MarketDataRepository
	cache *marketDataCache
}

// NewMarketDataService creates a new MarketDataService.
func NewMarketDataService(r *repo.MarketDataRepository) *MarketDataService {
	return &MarketDataService{
		repo:  r,
		cache: newMarketDataCache(time.Hour, 128),
	}
}

// FetchDailyCloseSeries returns daily close prices for symbol between start (inclusive) and end (inclusive).
func (s *MarketDataService) FetchDailyCloseSeries(symbol string, start, end time.Time) ([]CloseBar, error) {
	endExclusive := end.AddDate(0, 0, 1)

	cacheKey := fmt.Sprintf("%s|%s|%s", symbol, start.Format("2006-01-02"), endExclusive.Format("2006-01-02"))
	if cached, ok := s.cache.get(cacheKey); ok {
		return cached, nil
	}

	data, err := s.repo.FetchDailyCloseSeries(symbol, start, endExclusive)
	if err != nil {
		return nil, err
	}

	s.cache.set(cacheKey, data)
	return data, nil
}
