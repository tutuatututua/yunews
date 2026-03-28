import React, { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ErrorCallout } from '../components/ui/Callout'
import { cn } from '../lib/cn'
import { getBackendBaseUrl } from '../config/env'
import { ui, util } from '../styles'
import styles from './FeedbackPage.module.css'

type SubscriptionIntent = 'yes' | 'free_only' | 'no'
type UsageFrequency = 'daily' | 'weekly' | 'monthly' | 'occasionally' | 'first_time'
type PrimaryMarketFocus = 'thai_stocks' | 'us_stocks' | 'both' | 'crypto' | 'global_macro' | 'other'
type DiscoverySource = 'search' | 'social_media' | 'youtube' | 'friend_or_colleague' | 'direct' | 'other'
type WebHelpful = 'yes' | 'slightly_yes' | 'somewhat' | 'slightly_no' | 'no'

const SUBSCRIPTION_OPTIONS: Array<{ value: SubscriptionIntent; label: string; hint: string }> = [
  { value: 'yes', label: 'Yes', hint: 'Some paid features would make sense.' },
  { value: 'free_only', label: 'Only free part', hint: 'I would rather keep using only the free parts.' },
  { value: 'no', label: 'No', hint: 'I would not use this website if it had a subscription tier.' },
]

const USAGE_FREQUENCY_OPTIONS: Array<{ value: UsageFrequency; label: string; hint: string }> = [
  { value: 'daily', label: 'Daily', hint: 'Part of my regular market routine.' },
  { value: 'weekly', label: 'Weekly', hint: 'A tool I would check every week.' },
  { value: 'monthly', label: 'Monthly', hint: 'Useful, but not part of my weekly workflow.' },
  { value: 'occasionally', label: 'Occasionally', hint: 'Only when I need a quick answer or update.' },
  { value: 'first_time', label: 'First time / unsure', hint: 'I am still figuring out whether this fits me.' },
]

const MARKET_FOCUS_OPTIONS: Array<{ value: PrimaryMarketFocus; label: string }> = [
  { value: 'thai_stocks', label: 'Thai stocks' },
  { value: 'us_stocks', label: 'US stocks' },
  { value: 'both', label: 'Both Thai and US stocks' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'global_macro', label: 'Global macro / broader markets' },
  { value: 'other', label: 'Other' },
]

const DISCOVERY_SOURCE_OPTIONS: Array<{ value: DiscoverySource; label: string }> = [
  { value: 'search', label: 'Search engine' },
  { value: 'social_media', label: 'Social media' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'friend_or_colleague', label: 'Friend or colleague' },
  { value: 'direct', label: 'Direct / already knew the site' },
  { value: 'other', label: 'Other' },
]

const WEB_HELPFUL_OPTIONS: Array<{ value: WebHelpful; label: string; hint: string }> = [
  { value: 'yes', label: 'Yes', hint: 'It genuinely helps me stay informed.' },
  { value: 'slightly_yes', label: 'Slightly yes', hint: 'It helps a bit, but not consistently enough yet.' },
  { value: 'somewhat', label: 'Neutral', hint: 'It helps sometimes, but the value feels mixed overall.' },
  { value: 'slightly_no', label: 'Slightly no', hint: 'It is close, but still misses too often for me.' },
  { value: 'no', label: 'No', hint: 'Not really helpful for my needs yet.' },
]

class ApiRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

type ApiErrorBody = {
  error?: {
    message?: string
    details?: {
      errors?: Array<{
        loc?: Array<string | number>
        msg?: string
      }>
    }
  }
}

const API_FIELD_LABELS: Record<string, string> = {
  message: 'message',
  email: 'email',
  subscription_intent: 'subscription choice',
  fair_price_monthly: 'monthly price',
  usage_frequency: 'usage frequency',
  primary_market_focus: 'market focus',
  discovery_source: 'discovery source',
  trust_score: 'trust score',
  referral_likelihood: 'referral likelihood',
  web_helpful: 'website helpfulness',
  most_wanted_feature: 'most wanted feature',
  must_improve_before_pay: 'what must improve before paying',
  ideal_alert_channel: 'ideal alert channel',
  additional_notes: 'additional notes',
  path: 'path',
  search: 'search',
  referrer: 'referrer',
}

function formatApiErrorMessage(body: ApiErrorBody | null, fallbackStatus: number): string {
  const message = body?.error?.message?.trim()
  const errors = body?.error?.details?.errors

  if (Array.isArray(errors) && errors.length > 0) {
    const firstError = errors[0]
    const field = firstError?.loc?.find((part) => part !== 'body')
    const fieldLabel = typeof field === 'string' ? (API_FIELD_LABELS[field] || field.replace(/_/g, ' ')) : 'request field'
    const detail = firstError?.msg?.trim()

    if (detail) {
      return `${fieldLabel}: ${detail}`
    }
  }

  return message || `HTTP ${fallbackStatus}`
}

function normalizeEmail(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  // Minimal sanity check; server will treat it as optional free-form.
  if (!raw.includes('@') || raw.length > 320) return null
  return raw
}

function parseOptionalPrice(input: string): number | null | 'invalid' {
  const raw = String(input || '').trim()
  if (!raw) return null

  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return 'invalid'
  return Number(value.toFixed(2))
}

function getReferrer(): string | undefined {
  try {
    return document.referrer || undefined
  } catch {
    return undefined
  }
}

function getApiCandidates(endpoint: string): string[] {
  const base = getBackendBaseUrl().replace(/\/+$/, '')
  const normalized = endpoint.replace(/^\/+/, '')
  const candidates: string[] = [`${base}/${normalized}`]

  if (base.endsWith('/api')) {
    candidates.push(`${base.slice(0, -4)}/${normalized}`)
  } else {
    candidates.push(`${base}/api/${normalized}`)
  }

  return Array.from(new Set(candidates))
}

async function requestApi<T>(endpoint: string, init: RequestInit): Promise<T> {
  const candidates = getApiCandidates(endpoint)

  let lastRes: Response | null = null
  let lastMessage: string | null = null

  for (const url of candidates) {
    const res = await fetch(url, init)

    lastRes = res

    const ct = res.headers.get('content-type') || ''
    if (res.ok && ct.includes('text/html')) {
      throw new Error(
        'Feedback backend misconfigured (received HTML). Check VITE_BACKEND_BASE_URL and any /api rewrites/proxies.',
      )
    }

    if (res.ok) {
      if (ct.includes('application/json')) {
        return (await res.json()) as T
      }
      return null as T
    }

    let message = ''
    try {
      if (ct.includes('application/json')) {
        const body = (await res.json()) as ApiErrorBody
        message = formatApiErrorMessage(body, res.status)
      } else {
        message = await res.text()
      }
    } catch {
      // ignore
    }
    lastMessage = message || null

    // If the endpoint is missing, try the alternate candidate.
    if (res.status === 404) continue

    throw new ApiRequestError(message || `HTTP ${res.status}`, res.status)
  }

  if (lastRes?.status === 404) {
    throw new Error(
      'Feedback endpoint not found (HTTP 404). If you run the backend via Docker, rebuild/restart it: `docker compose up -d --build backend`. If you run Uvicorn directly, restart the server process.',
    )
  }

  throw new Error(lastMessage || (lastRes ? `HTTP ${lastRes.status}` : 'Failed to send request'))
}

async function submitFeedback(args: {
  message: string
  email?: string | null
  path?: string
  search?: string
  referrer?: string
}): Promise<void> {
  await requestApi<null>('feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      message: args.message,
      email: args.email || null,
      path: args.path || '/',
      search: args.search || '',
      referrer: args.referrer || null,
    }),
  })
}

async function fetchSurveyStatus(): Promise<{ submitted: boolean }> {
  return requestApi<{ submitted: boolean }>('feedback-survey/status', {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
}

async function submitSurvey(args: {
  subscriptionIntent: SubscriptionIntent
  fairPriceMonthly: number | null
  usageFrequency: UsageFrequency
  primaryMarketFocus: PrimaryMarketFocus
  discoverySource: DiscoverySource
  trustScore: number
  referralLikelihood: number
  webHelpful?: string | null
  mostWantedFeature: string
  mustImproveBeforePay: string
  idealAlertChannel?: string | null
  additionalNotes?: string | null
  email?: string | null
  path?: string
  search?: string
  referrer?: string
}): Promise<void> {
  await requestApi<null>('feedback-survey', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      subscription_intent: args.subscriptionIntent,
      fair_price_monthly: args.fairPriceMonthly,
      usage_frequency: args.usageFrequency,
      primary_market_focus: args.primaryMarketFocus,
      discovery_source: args.discoverySource,
      trust_score: args.trustScore,
      referral_likelihood: args.referralLikelihood,
      web_helpful: args.webHelpful || null,
      most_wanted_feature: args.mostWantedFeature,
      must_improve_before_pay: args.mustImproveBeforePay,
      ideal_alert_channel: args.idealAlertChannel || null,
      additional_notes: args.additionalNotes || null,
      email: args.email || null,
      path: args.path || '/',
      search: args.search || '',
      referrer: args.referrer || null,
    }),
  })
}

export default function FeedbackPage() {
  const location = useLocation()

  const [feedbackEmail, setFeedbackEmail] = useState('')
  const [message, setMessage] = useState('')
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  const [surveyEmail, setSurveyEmail] = useState('')
  const [subscriptionIntent, setSubscriptionIntent] = useState<SubscriptionIntent | ''>('')
  const [fairPrice, setFairPrice] = useState('')
  const [usageFrequency, setUsageFrequency] = useState<UsageFrequency | ''>('')
  const [primaryMarketFocus, setPrimaryMarketFocus] = useState<PrimaryMarketFocus | ''>('')
  const [discoverySource, setDiscoverySource] = useState<DiscoverySource | ''>('')
  const [trustScore, setTrustScore] = useState<number | ''>('')
  const [referralLikelihood, setReferralLikelihood] = useState<number | ''>('')
  const [mostWantedFeature, setMostWantedFeature] = useState('')
  const [mustImproveBeforePay, setMustImproveBeforePay] = useState('')
  const [idealAlertChannel, setIdealAlertChannel] = useState('')
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [webHelpful, setWebHelpful] = useState<WebHelpful | ''>('')
  const [surveyChecking, setSurveyChecking] = useState(true)
  const [surveySubmitting, setSurveySubmitting] = useState(false)
  const [surveySubmitted, setSurveySubmitted] = useState(false)
  const [surveyJustSubmitted, setSurveyJustSubmitted] = useState(false)
  const [surveyError, setSurveyError] = useState<string | null>(null)

  const feedbackPath = location.pathname || '/'
  const feedbackSearch = location.search || ''
  const showSurveyCard = !surveyChecking && !surveySubmitted
  const showSurveyThankYou = !surveyChecking && surveySubmitted && surveyJustSubmitted

  function resetSurveyForm(): void {
    setSurveyEmail('')
    setSubscriptionIntent('')
    setFairPrice('')
    setUsageFrequency('')
    setPrimaryMarketFocus('')
    setDiscoverySource('')
    setTrustScore('')
    setReferralLikelihood('')
    setMostWantedFeature('')
    setMustImproveBeforePay('')
    setIdealAlertChannel('')
    setAdditionalNotes('')
    setWebHelpful('')
  }

  const canSubmit = useMemo(() => {
    const msg = String(message || '').trim()
    return msg.length >= 5 && msg.length <= 10_000
  }, [message])

  const normalizedFeedbackEmail = useMemo(() => normalizeEmail(feedbackEmail), [feedbackEmail])
  const normalizedSurveyEmail = useMemo(() => normalizeEmail(surveyEmail), [surveyEmail])
  const fairPriceMonthly = useMemo(() => parseOptionalPrice(fairPrice), [fairPrice])

  const surveyBlockers = useMemo(() => {
    const blockers: string[] = []

    if (subscriptionIntent === '') blockers.push('subscription answer')
    if (usageFrequency === '') blockers.push('usage frequency')
    if (primaryMarketFocus === '') blockers.push('market focus')
    if (discoverySource === '') blockers.push('discovery source')
    if (trustScore === '') blockers.push('trust score')
    if (referralLikelihood === '') blockers.push('referral likelihood')
    if (webHelpful === '') blockers.push('website helpfulness')
    if (fairPriceMonthly === 'invalid') blockers.push('a valid price or blank')

    return blockers
  }, [
    discoverySource,
    fairPriceMonthly,
    primaryMarketFocus,
    referralLikelihood,
    subscriptionIntent,
    trustScore,
    usageFrequency,
    webHelpful,
  ])

  const canSubmitSurvey = surveyBlockers.length === 0

  useEffect(() => {
    let cancelled = false

    setSurveyChecking(true)
    fetchSurveyStatus()
      .then((result) => {
        if (cancelled) return
        setSurveySubmitted(Boolean(result?.submitted))
        setSurveyJustSubmitted(false)
      })
      .catch(() => {
        if (cancelled) return
        setSurveySubmitted(false)
        setSurveyJustSubmitted(false)
      })
      .finally(() => {
        if (cancelled) return
        setSurveyChecking(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.stack}>
        <div className={cn(ui.card, styles.headerCard)}>
          {feedbackError ? <ErrorCallout message={feedbackError} onDismiss={() => setFeedbackError(null)} /> : null}

          <div className={ui.cardHeader}>
            <div>
              <div className={styles.kicker}>Unlimited messages</div>
              <h2>Feedback box</h2>
              <div className={cn(util.muted, util.small)}>Share a bug report, feature request, or anything else. You can send as many feedback messages as you want.</div>
            </div>
          </div>

          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault()
              if (!canSubmit || feedbackSubmitting) return

              setFeedbackSubmitting(true)
              setFeedbackSent(false)
              setFeedbackError(null)

              void submitFeedback({
                message: String(message || '').trim(),
                email: normalizedFeedbackEmail,
                path: feedbackPath,
                search: feedbackSearch,
                referrer: getReferrer(),
              })
                .then(() => {
                  setFeedbackSent(true)
                  setMessage('')
                })
                .catch((err) => {
                  setFeedbackError(err instanceof Error ? err.message : 'Failed to send feedback')
                })
                .finally(() => {
                  setFeedbackSubmitting(false)
                })
            }}
          >
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email (optional)</span>
              <input
                className={styles.input}
                value={feedbackEmail}
                onChange={(e) => setFeedbackEmail(e.target.value)}
                placeholder="you@example.com"
                inputMode="email"
                autoComplete="email"
                aria-invalid={feedbackEmail.trim().length > 0 && !normalizedFeedbackEmail ? 'true' : undefined}
              />
              {feedbackEmail.trim().length > 0 && !normalizedFeedbackEmail ? (
                <span className={cn(util.muted, util.small)} role="status">
                  Please enter a valid email, or leave this blank.
                </span>
              ) : null}
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Message</span>
              <textarea
                className={styles.textarea}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What should we improve?"
                rows={7}
                required
              />
              <span className={cn(util.muted, util.small)}>
                {String(message || '').trim().length}/10000
              </span>
            </label>

            <div className={styles.actions}>
              <button className={cn(ui.button)} type="submit" disabled={!canSubmit || feedbackSubmitting}>
                {feedbackSubmitting ? 'Sending…' : 'Send feedback'}
              </button>
              {feedbackSent ? <span className={cn(util.muted, util.small)}>Thanks. Feedback sent.</span> : null}
            </div>
          </form>
        </div>

        {showSurveyCard ? (
          <div className={cn(ui.card, styles.headerCard, styles.surveyCard)}>
            {surveyError ? <ErrorCallout message={surveyError} onDismiss={() => setSurveyError(null)} /> : null}

            <div className={ui.cardHeader}>
              <div>
                <div className={styles.kicker}>This survey is limited to one response</div>
                <h2>Product and feature survey</h2>
                <div className={cn(util.muted, util.small)}>
                    Just to make sure you don't misunderstand me: my goal is not to get rich, but to build a website that people genuinely want to use. I don't want to drain your money. I just want enough to cover the server costs.
                </div>
              </div>
              </div>

            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault()
                if (!canSubmitSurvey || surveySubmitting || subscriptionIntent === '') return
                if (
                  usageFrequency === '' ||
                  primaryMarketFocus === '' ||
                  discoverySource === '' ||
                  trustScore === '' ||
                  referralLikelihood === ''
                ) {
                  return
                }

                setSurveySubmitting(true)
                setSurveyError(null)

                void submitSurvey({
                  subscriptionIntent,
                  fairPriceMonthly: fairPriceMonthly === 'invalid' ? null : fairPriceMonthly,
                  usageFrequency,
                  primaryMarketFocus,
                  discoverySource,
                  trustScore,
                  referralLikelihood,
                  webHelpful: webHelpful || null,
                  mostWantedFeature: String(mostWantedFeature || '').trim(),
                  mustImproveBeforePay: String(mustImproveBeforePay || '').trim(),
                  idealAlertChannel: String(idealAlertChannel || '').trim() || null,
                  additionalNotes: String(additionalNotes || '').trim() || null,
                  email: normalizedSurveyEmail,
                  path: feedbackPath,
                  search: feedbackSearch,
                  referrer: getReferrer(),
                })
                  .then(() => {
                    resetSurveyForm()
                    setSurveyJustSubmitted(true)
                    setSurveySubmitted(true)
                  })
                  .catch((err) => {
                    if (err instanceof ApiRequestError && err.status === 409) {
                      setSurveyError(null)
                      setSurveyJustSubmitted(true)
                      setSurveySubmitted(true)
                      return
                    }
                    setSurveyError(err instanceof Error ? err.message : 'Failed to send survey')
                  })
                  .finally(() => {
                    setSurveySubmitting(false)
                  })
              }}
            >
              <div className={styles.gridTwo}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Some part need to be subscription</span>
                  <span className={cn(util.muted, util.small)}>
                    The main features you use right now will stay free, but some parts like notifications for serious news may become paid.
                  </span>
                  <select
                    className={styles.select}
                    value={subscriptionIntent}
                    onChange={(e) => setSubscriptionIntent(e.target.value as SubscriptionIntent | '')}
                    disabled={surveySubmitting}
                    required
                  >
                    <option value="">Choose one</option>
                    {SUBSCRIPTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.hint}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>What monthly price feels fair in dollars? (optional)</span>
                  <input
                    className={styles.input}
                    value={fairPrice}
                    onChange={(e) => setFairPrice(e.target.value)}
                    placeholder="0, 2, 3, 5, 10, etc."
                    inputMode="decimal"
                    disabled={surveySubmitting}
                    aria-invalid={fairPriceMonthly === 'invalid' ? 'true' : undefined}
                  />
                  {fairPriceMonthly === 'invalid' ? (
                    <span className={cn(util.muted, util.small)} role="status">
                      Enter any non-negative number, or leave it blank.
                    </span>
                  ) : null}
                </label>
              </div>

              <div className={styles.gridTwo}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>How often do you use this product?</span>
                  <select
                    className={styles.select}
                    value={usageFrequency}
                    onChange={(e) => setUsageFrequency(e.target.value as UsageFrequency | '')}
                    disabled={surveySubmitting}
                    required
                  >
                    <option value="">Choose one</option>
                    {USAGE_FREQUENCY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.hint}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Is this website actually helping you?</span>
                  <select
                    className={styles.select}
                    value={webHelpful}
                    onChange={(e) => setWebHelpful(e.target.value as WebHelpful | '')}
                    disabled={surveySubmitting}
                    required
                  >
                    <option value="">Choose one</option>
                    {WEB_HELPFUL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.hint}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className={styles.gridTwo}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Which market matters most to you?</span>
                  <select
                    className={styles.select}
                    value={primaryMarketFocus}
                    onChange={(e) => setPrimaryMarketFocus(e.target.value as PrimaryMarketFocus | '')}
                    disabled={surveySubmitting}
                    required
                  >
                    <option value="">Choose one</option>
                    {MARKET_FOCUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>How did you find this product?</span>
                  <select
                    className={styles.select}
                    value={discoverySource}
                    onChange={(e) => setDiscoverySource(e.target.value as DiscoverySource | '')}
                    disabled={surveySubmitting}
                    required
                  >
                    <option value="">Choose one</option>
                    {DISCOVERY_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className={styles.gridTwo}>
                
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>How much do you trust the product today?</span>
                  <select
                    className={styles.select}
                    value={trustScore === '' ? '' : String(trustScore)}
                    onChange={(e) => setTrustScore(e.target.value ? Number(e.target.value) : '')}
                    disabled={surveySubmitting}
                    required
                  >
                    <option value="">Choose 1-5</option>
                    <option value="1">1 - Very low trust</option>
                    <option value="2">2 - Low trust</option>
                    <option value="3">3 - Neutral</option>
                    <option value="4">4 - Strong trust</option>
                    <option value="5">5 - Very strong trust</option>
                  </select>
                </label>
                                <label className={styles.field}>
                  <span className={styles.fieldLabel}>  How likely are you to recommend it to someone else?</span>
                  <select
                    className={styles.select}
                    value={referralLikelihood === '' ? '' : String(referralLikelihood)}
                    onChange={(e) => setReferralLikelihood(e.target.value ? Number(e.target.value) : '')}
                    disabled={surveySubmitting}
                    required
                  >
                    <option value="">Choose 0-10</option>
                    {Array.from({ length: 11 }, (_, index) => (
                      <option key={index} value={String(index)}>
                        {index}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>What feature do you want the most? (optional)</span>
                <textarea
                  className={styles.textarea}
                  value={mostWantedFeature}
                  onChange={(e) => setMostWantedFeature(e.target.value)}
                  placeholder="Email alerts, better global performance, more market sources, smarter AI summaries..."
                  rows={4}
                  disabled={surveySubmitting}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>What must improve before it feels worth paying for? (optional)</span>
                <textarea
                  className={styles.textarea}
                  value={mustImproveBeforePay}
                  onChange={(e) => setMustImproveBeforePay(e.target.value)}
                  placeholder="Tell us what is missing, unclear, or not strong enough yet."
                  rows={4}
                  disabled={surveySubmitting}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Email (optional)</span>
                <input
                  className={styles.input}
                  value={surveyEmail}
                  onChange={(e) => setSurveyEmail(e.target.value)}
                  placeholder="you@example.com"
                  inputMode="email"
                  autoComplete="email"
                  disabled={surveySubmitting}
                  aria-invalid={surveyEmail.trim().length > 0 && !normalizedSurveyEmail ? 'true' : undefined}
                />
                {surveyEmail.trim().length > 0 && !normalizedSurveyEmail ? (
                  <span className={cn(util.muted, util.small)} role="status">
                    Please enter a valid email, or leave this blank.
                  </span>
                ) : null}
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Anything else? (optional)</span>
                <textarea
                  className={styles.textarea}
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  placeholder="Anything else you want to add about feature, comment, trust, or direction."
                  rows={5}
                  disabled={surveySubmitting}
                />
              </label>

              <div className={styles.actions}>
                <button className={cn(ui.button)} type="submit" disabled={!canSubmitSurvey || surveySubmitting}>
                  {surveySubmitting ? 'Sending…' : 'Send survey'}
                </button>
                {!canSubmitSurvey && !surveySubmitting ? (
                  <span className={cn(util.muted, util.small)} role="status">
                    Complete: {surveyBlockers.join(', ')}.
                  </span>
                ) : null}
                <span className={cn(util.muted, util.small)}>One survey response per connection.</span>
              </div>
            </form>
          </div>
        ) : null}

        {showSurveyThankYou ? (
          <div className={cn(ui.card, styles.headerCard, styles.surveyCard)}>
            <div className={ui.cardHeader}>
              <div>
                <div className={styles.kicker}>Survey received</div>
                <h2>Thank you for your time</h2>
                <div className={cn(util.muted, util.small)}>
                  Your response has been recorded and will help shape future decisions.
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
