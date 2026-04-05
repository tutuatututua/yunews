// Package supabase provides a minimal PostgREST HTTP client for Supabase.
package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Client is a minimal Supabase PostgREST client.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewClient creates a Supabase client.
func NewClient(supabaseURL, apiKey string) *Client {
	return &Client{
		baseURL: strings.TrimRight(supabaseURL, "/"),
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) applyHeaders(req *http.Request) {
	req.Header.Set("apikey", c.apiKey)
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
}

// From returns a new QueryBuilder for the given table.
func (c *Client) From(table string) *QueryBuilder {
	return &QueryBuilder{
		client: c,
		table:  table,
	}
}

// Rpc calls a Supabase RPC function and returns the raw JSON response bytes.
func (c *Client) Rpc(fn string, params interface{}) ([]byte, error) {
	body, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("marshal rpc params: %w", err)
	}

	u := c.baseURL + "/rest/v1/rpc/" + fn
	req, err := http.NewRequestWithContext(context.Background(), "POST", u, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	c.applyHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("supabase rpc %q error %d: %s", fn, resp.StatusCode, string(data))
	}

	return data, nil
}

// Insert inserts a single row into a table. Returns an error if the HTTP call fails.
func (c *Client) Insert(table string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	u := c.baseURL + "/rest/v1/" + table
	req, err := http.NewRequestWithContext(context.Background(), "POST", u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	c.applyHeaders(req)
	req.Header.Set("Prefer", "return=minimal")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase insert %q error %d: %s", table, resp.StatusCode, string(data))
	}

	io.Copy(io.Discard, resp.Body)
	return nil
}

// ─────────────────────────────────────────────
// QueryBuilder
// ─────────────────────────────────────────────

// QueryBuilder accumulates PostgREST query parameters and executes a GET request.
type QueryBuilder struct {
	client     *Client
	table      string
	selectCols string
	filters    []string // raw PostgREST filter strings, e.g. "column=eq.value"
	orderParts []string // e.g. "column.desc"
	limitVal   int
	limitSet   bool
}

// Select sets the columns to return (PostgREST select param).
// Supports embedded resource syntax: "col1,rel(col2,col3)".
func (q *QueryBuilder) Select(columns string) *QueryBuilder {
	q.selectCols = columns
	return q
}

// Eq adds an equality filter: column=eq.value.
func (q *QueryBuilder) Eq(column, value string) *QueryBuilder {
	q.filters = append(q.filters, column+"=eq."+pgEscape(value))
	return q
}

// Gte adds a greater-than-or-equal filter.
func (q *QueryBuilder) Gte(column, value string) *QueryBuilder {
	q.filters = append(q.filters, column+"=gte."+pgEscape(value))
	return q
}

// Lte adds a less-than-or-equal filter.
func (q *QueryBuilder) Lte(column, value string) *QueryBuilder {
	q.filters = append(q.filters, column+"=lte."+pgEscape(value))
	return q
}

// Gt adds a greater-than filter.
func (q *QueryBuilder) Gt(column, value string) *QueryBuilder {
	q.filters = append(q.filters, column+"=gt."+pgEscape(value))
	return q
}

// In adds an IN filter: column=in.(v1,v2,...).
// Values should be simple identifiers (dates, tickers, IDs) with no commas inside.
func (q *QueryBuilder) In(column string, values []string) *QueryBuilder {
	if len(values) == 0 {
		return q
	}
	q.filters = append(q.filters, column+"=in.("+strings.Join(values, ",")+")")
	return q
}

// Order adds an ORDER BY clause. Set desc=true for descending order.
func (q *QueryBuilder) Order(column string, desc bool) *QueryBuilder {
	dir := "asc"
	if desc {
		dir = "desc"
	}
	q.orderParts = append(q.orderParts, column+"."+dir)
	return q
}

// Limit sets the maximum number of rows to return.
func (q *QueryBuilder) Limit(n int) *QueryBuilder {
	q.limitVal = n
	q.limitSet = true
	return q
}

// Execute performs the GET request and decodes the JSON response into dest.
// dest should be a pointer to a slice (e.g. *[]map[string]interface{}).
func (q *QueryBuilder) Execute(dest interface{}) error {
	data, err := q.executeRaw()
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dest)
}

// executeRaw performs the GET request and returns raw JSON bytes.
func (q *QueryBuilder) executeRaw() ([]byte, error) {
	u := q.client.baseURL + "/rest/v1/" + q.table

	parts := []string{}

	if q.selectCols != "" {
		parts = append(parts, "select="+pgEscapeSelect(q.selectCols))
	}

	parts = append(parts, q.filters...)

	if len(q.orderParts) > 0 {
		parts = append(parts, "order="+strings.Join(q.orderParts, ","))
	}

	if q.limitSet {
		parts = append(parts, "limit="+strconv.Itoa(q.limitVal))
	}

	if len(parts) > 0 {
		u += "?" + strings.Join(parts, "&")
	}

	req, err := http.NewRequestWithContext(context.Background(), "GET", u, nil)
	if err != nil {
		return nil, err
	}
	q.client.applyHeaders(req)

	resp, err := q.client.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("supabase query %q error %d: %s", q.table, resp.StatusCode, string(data))
	}

	return data, nil
}

// pgEscape percent-encodes a plain filter value. Leaves characters safe for PostgREST unencoded.
func pgEscape(s string) string {
	// For date strings, UUIDs, tickers, IPs - all safe. Only encode truly unsafe chars.
	var b strings.Builder
	for _, c := range s {
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			b.WriteRune(c)
		case c == '-', c == '_', c == '.', c == ':', c == '+', c == '/':
			b.WriteRune(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// pgEscapeSelect encodes the select parameter value (allows parens, commas for embedded resources).
func pgEscapeSelect(s string) string {
	// select values contain commas and parens for embedded resources; encode only truly unsafe chars
	var b strings.Builder
	for _, c := range s {
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			b.WriteRune(c)
		case c == '-', c == '_', c == '.', c == ':', c == '+', c == '/':
			b.WriteRune(c)
		case c == ',', c == '(', c == ')':
			b.WriteRune(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// GetStr safely returns a string from a map value.
func GetStr(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok && v != nil {
		return fmt.Sprintf("%v", v)
	}
	return ""
}

// GetStrPtr returns a *string for a map value, nil if missing/null.
func GetStrPtr(m map[string]interface{}, key string) *string {
	if v, ok := m[key]; ok && v != nil {
		s := fmt.Sprintf("%v", v)
		return &s
	}
	return nil
}

// GetFloat64Ptr returns a *float64 for a map value, nil if missing/null/unparseable.
func GetFloat64Ptr(m map[string]interface{}, key string) *float64 {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case float64:
		return &t
	case float32:
		f := float64(t)
		return &f
	case int:
		f := float64(t)
		return &f
	case int64:
		f := float64(t)
		return &f
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return nil
		}
		return &f
	case string:
		f, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return nil
		}
		return &f
	}
	return nil
}

// GetFloat64 returns a float64 for a map value, 0 if missing/null/unparseable.
func GetFloat64(m map[string]interface{}, key string) float64 {
	if p := GetFloat64Ptr(m, key); p != nil {
		return *p
	}
	return 0
}

// GetIntPtr returns a *int for a map value.
func GetIntPtr(m map[string]interface{}, key string) *int {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case float64:
		n := int(t)
		return &n
	case float32:
		n := int(t)
		return &n
	case int:
		return &t
	case int64:
		n := int(t)
		return &n
	case json.Number:
		n, err := strconv.Atoi(t.String())
		if err != nil {
			return nil
		}
		return &n
	}
	return nil
}

// GetStringSlice returns a []string from a JSON array value in a map.
func GetStringSlice(m map[string]interface{}, key string) []string {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if item == nil {
			continue
		}
		s := fmt.Sprintf("%v", item)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// GetMap returns a nested map from a map value.
func GetMap(m map[string]interface{}, key string) map[string]interface{} {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	if sub, ok := v.(map[string]interface{}); ok {
		return sub
	}
	return nil
}

// GetFirstMap returns the first element of a nested []interface{} as a map, or nil.
func GetFirstMap(m map[string]interface{}, key string) map[string]interface{} {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case []interface{}:
		if len(t) == 0 {
			return nil
		}
		if sub, ok := t[0].(map[string]interface{}); ok {
			return sub
		}
	case map[string]interface{}:
		return t
	}
	return nil
}
