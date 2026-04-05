package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"yunews/backend/internal/apperr"
	"yunews/backend/internal/middleware"
	"yunews/backend/internal/repo"
)

// FeedbackHandler handles feedback and feedback-survey routes.
type FeedbackHandler struct {
	repo *repo.FeedbackRepository
}

// NewFeedbackHandler creates a FeedbackHandler.
func NewFeedbackHandler(r *repo.FeedbackRepository) *FeedbackHandler {
	return &FeedbackHandler{repo: r}
}

type feedbackRequest struct {
	Message  string  `json:"message"`
	Email    *string `json:"email,omitempty"`
	Path     string  `json:"path"`
	Search   *string `json:"search,omitempty"`
	Referrer *string `json:"referrer,omitempty"`
}

type feedbackSurveyRequest struct {
	SubscriptionIntent   string   `json:"subscription_intent"`
	FairPriceMonthly     *float64 `json:"fair_price_monthly,omitempty"`
	UsageFrequency       string   `json:"usage_frequency"`
	PrimaryMarketFocus   string   `json:"primary_market_focus"`
	DiscoverySource      string   `json:"discovery_source"`
	TrustScore           int      `json:"trust_score"`
	ReferralLikelihood   int      `json:"referral_likelihood"`
	MostWantedFeature    string   `json:"most_wanted_feature"`
	MustImproveBeforePay string   `json:"must_improve_before_pay"`
	IdealAlertChannel    string   `json:"ideal_alert_channel"`
	AdditionalNotes      string   `json:"additional_notes"`
	WebHelpful           string   `json:"web_helpful"`
	Email                *string  `json:"email,omitempty"`
	Path                 string   `json:"path"`
	Search               *string  `json:"search,omitempty"`
	Referrer             *string  `json:"referrer,omitempty"`
}

// SubmitFeedback handles POST /feedback and POST /api/feedback.
func (h *FeedbackHandler) SubmitFeedback(w http.ResponseWriter, r *http.Request) {
	var payload feedbackRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "BAD_REQUEST", "message": "invalid request body"})
		return
	}
	msg := strings.TrimSpace(payload.Message)
	if len(msg) < 5 {
		WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "BAD_REQUEST", "message": "message must be at least 5 characters"})
		return
	}

	ip := ClientIP(r)
	rid := middleware.GetRequestID(r.Context())
	ua := r.Header.Get("User-Agent")
	var uaPtr *string
	if ua != "" {
		uaPtr = &ua
	}
	referer := payload.Referrer
	if referer == nil {
		if rf := r.Header.Get("Referer"); rf != "" {
			referer = &rf
		}
	}

	path := combinePath(payload.Path, payload.Search)
	h.repo.InsertFeedback(ip, rid, msg, payload.Email, &path, uaPtr, referer)
	WriteJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "request_id": rid})
}

// SurveyStatus handles GET /feedback-survey/status and GET /api/feedback-survey/status.
func (h *FeedbackHandler) SurveyStatus(w http.ResponseWriter, r *http.Request) {
	ip := ClientIP(r)
	submitted := h.repo.HasFeedbackSurveyForIP(ip)
	WriteJSON(w, http.StatusOK, map[string]interface{}{"submitted": submitted})
}

// SubmitSurvey handles POST /feedback-survey and POST /api/feedback-survey.
func (h *FeedbackHandler) SubmitSurvey(w http.ResponseWriter, r *http.Request) {
	var payload feedbackSurveyRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "BAD_REQUEST", "message": "invalid request body"})
		return
	}

	ip := ClientIP(r)
	rid := middleware.GetRequestID(r.Context())

	// Duplicate check.
	if h.repo.HasFeedbackSurveyForIP(ip) {
		WriteError(w, apperr.ConflictCode(
			"This survey has already been submitted from your connection.",
			"feedback_survey_already_submitted",
			nil,
		))
		return
	}

	ua := r.Header.Get("User-Agent")
	var uaPtr *string
	if ua != "" {
		uaPtr = &ua
	}
	referer := payload.Referrer
	if referer == nil {
		if rf := r.Header.Get("Referer"); rf != "" {
			referer = &rf
		}
	}

	path := combinePath(payload.Path, payload.Search)

	params := repo.FeedbackSurveyParams{
		IP:                   ip,
		RequestID:            rid,
		SubscriptionIntent:   payload.SubscriptionIntent,
		FairPriceMonthly:     payload.FairPriceMonthly,
		UsageFrequency:       payload.UsageFrequency,
		PrimaryMarketFocus:   payload.PrimaryMarketFocus,
		DiscoverySource:      payload.DiscoverySource,
		TrustScore:           payload.TrustScore,
		ReferralLikelihood:   payload.ReferralLikelihood,
		MostWantedFeature:    payload.MostWantedFeature,
		MustImproveBeforePay: payload.MustImproveBeforePay,
		IdealAlertChannel:    payload.IdealAlertChannel,
		AdditionalNotes:      payload.AdditionalNotes,
		WebHelpful:           payload.WebHelpful,
		Email:                payload.Email,
		Path:                 path,
		UserAgent:            uaPtr,
		Referrer:             referer,
	}

	if err := h.repo.InsertFeedbackSurvey(params); err != nil {
		if err == repo.ErrDuplicateFeedbackSurvey {
			WriteError(w, apperr.ConflictCode(
				"This survey has already been submitted from your connection.",
				"feedback_survey_already_submitted",
				nil,
			))
			return
		}
		HandleAppError(w, err)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "request_id": rid})
}

func combinePath(path string, search *string) string {
	p := strings.TrimSpace(path)
	if p == "" {
		p = "/"
	}
	if len(p) > 500 {
		p = p[:500]
	}
	if search != nil && *search != "" {
		s := strings.TrimSpace(*search)
		if !strings.HasPrefix(s, "?") {
			s = "?" + s
		}
		combined := p + s
		if len(combined) > 500 {
			combined = combined[:500]
		}
		return combined
	}
	return p
}
