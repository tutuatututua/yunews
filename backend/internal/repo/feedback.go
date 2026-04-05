package repo

import (
	"fmt"
	"log/slog"
	"strings"

	"yunews/backend/internal/supabase"
)

// ErrDuplicateFeedbackSurvey is returned when a duplicate unique constraint is violated.
var ErrDuplicateFeedbackSurvey = fmt.Errorf("duplicate feedback survey")

// FeedbackRepository handles feedback and feedback_surveys tables.
type FeedbackRepository struct {
	db *supabase.Client
}

// NewFeedbackRepository creates a new FeedbackRepository.
func NewFeedbackRepository(db *supabase.Client) *FeedbackRepository {
	return &FeedbackRepository{db: db}
}

// InsertFeedback inserts a feedback row. Errors are logged but not returned (best-effort).
func (r *FeedbackRepository) InsertFeedback(ip, requestID, message string, email *string, path, userAgent, referrer *string) {
	payload := map[string]interface{}{
		"ip":          truncate(normalizeIP(ip), 100),
		"request_id":  truncateOrNil(requestID, 100),
		"message":     truncate(strings.TrimSpace(message), 10000),
		"email":       truncateOrNilPtr(email, 320),
		"path":        truncate(strDefault(path, "/"), 500),
		"user_agent":  truncateOrNilPtr(userAgent, 500),
		"referrer":    truncateOrNilPtr(referrer, 500),
	}
	if err := r.db.Insert("feedback", payload); err != nil {
		slog.Warn("failed to insert feedback", "error", err)
	}
}

// HasFeedbackSurveyForIP returns true if the IP has already submitted a survey.
func (r *FeedbackRepository) HasFeedbackSurveyForIP(ip string) bool {
	var rows []map[string]interface{}
	err := r.db.From("feedback_surveys").
		Select("id").
		Eq("ip", normalizeIP(ip)).
		Limit(1).
		Execute(&rows)
	if err != nil {
		slog.Warn("failed to check feedback survey for ip", "error", err)
		return false
	}
	for _, row := range rows {
		if row["id"] != nil {
			return true
		}
	}
	return false
}

// InsertFeedbackSurvey inserts a feedback survey row.
// Returns ErrDuplicateFeedbackSurvey on unique-constraint violation.
func (r *FeedbackRepository) InsertFeedbackSurvey(params FeedbackSurveyParams) error {
	payload := map[string]interface{}{
		"ip":                    truncate(normalizeIP(params.IP), 100),
		"request_id":            truncateOrNil(params.RequestID, 100),
		"subscription_intent":   truncate(params.SubscriptionIntent, 20),
		"fair_price_monthly":    params.FairPriceMonthly,
		"usage_frequency":       truncate(params.UsageFrequency, 20),
		"primary_market_focus":  truncate(params.PrimaryMarketFocus, 40),
		"discovery_source":      truncate(params.DiscoverySource, 40),
		"trust_score":           params.TrustScore,
		"referral_likelihood":   params.ReferralLikelihood,
		"most_wanted_feature":   truncate(params.MostWantedFeature, 500),
		"must_improve_before_pay": truncate(params.MustImproveBeforePay, 1000),
		"ideal_alert_channel":   truncateOrNil(params.IdealAlertChannel, 200),
		"additional_notes":      truncateOrNil(params.AdditionalNotes, 4000),
		"web_helpful":           truncateOrNil(params.WebHelpful, 20),
		"email":                 truncateOrNilPtr(params.Email, 320),
		"path":                  truncate(strDefault(&params.Path, "/"), 500),
		"user_agent":            truncateOrNilPtr(params.UserAgent, 500),
		"referrer":              truncateOrNilPtr(params.Referrer, 500),
	}

	if err := r.db.Insert("feedback_surveys", payload); err != nil {
		if isDuplicateKeyError(err) {
			return ErrDuplicateFeedbackSurvey
		}
		return err
	}
	return nil
}

// FeedbackSurveyParams holds all fields for a feedback survey insert.
type FeedbackSurveyParams struct {
	IP                   string
	RequestID            string
	SubscriptionIntent   string
	FairPriceMonthly     *float64
	UsageFrequency       string
	PrimaryMarketFocus   string
	DiscoverySource      string
	TrustScore           int
	ReferralLikelihood   int
	MostWantedFeature    string
	MustImproveBeforePay string
	IdealAlertChannel    string
	AdditionalNotes      string
	WebHelpful           string
	Email                *string
	Path                 string
	UserAgent            *string
	Referrer             *string
}

func normalizeIP(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return "unknown"
	}
	if len(ip) > 100 {
		return ip[:100]
	}
	return ip
}

func truncate(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) > maxLen {
		return s[:maxLen]
	}
	return s
}

func truncateOrNil(s string, maxLen int) interface{} {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s
}

func truncateOrNilPtr(s *string, maxLen int) interface{} {
	if s == nil {
		return nil
	}
	return truncateOrNil(*s, maxLen)
}

func strDefault(s *string, def string) *string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return &def
	}
	return s
}

func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "23505") || strings.Contains(msg, "duplicate key") ||
		(strings.Contains(msg, "unique") && strings.Contains(msg, "feedback_surveys"))
}
