import React, { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ErrorCallout } from '../components/ui/Callout'
import { cn } from '../lib/cn'
import { getBackendBaseUrl } from '../config/env'
import { ui, util } from '../styles'
import styles from './FeedbackPage.module.css'

function normalizeEmail(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  // Minimal sanity check; server will treat it as optional free-form.
  if (!raw.includes('@') || raw.length > 320) return null
  return raw
}

async function submitFeedback(args: {
  message: string
  email?: string | null
  path?: string
  search?: string
  referrer?: string
}): Promise<void> {
  const base = getBackendBaseUrl().replace(/\/+$/, '')
  const payload = {
    message: args.message,
    email: args.email || null,
    path: args.path || '/',
    search: args.search || '',
    referrer: args.referrer || null,
  }

  const candidates: string[] = [`${base}/feedback`]
  if (base.endsWith('/api')) {
    candidates.push(`${base.slice(0, -4)}/feedback`)
  } else {
    candidates.push(`${base}/api/feedback`)
  }

  let lastRes: Response | null = null
  let lastText: string | null = null

  for (const url of candidates) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })

    lastRes = res

    const ct = res.headers.get('content-type') || ''
    if (res.ok && ct.includes('text/html')) {
      throw new Error(
        'Feedback backend misconfigured (received HTML). Check VITE_BACKEND_BASE_URL and any /api rewrites/proxies.',
      )
    }

    if (res.ok) return

    let text = ''
    try {
      text = await res.text()
    } catch {
      // ignore
    }
    lastText = text || null

    // If the endpoint is missing, try the alternate candidate.
    if (res.status === 404) continue

    throw new Error(text || `HTTP ${res.status}`)
  }

  if (lastRes?.status === 404) {
    throw new Error(
      'Feedback endpoint not found (HTTP 404). If you run the backend via Docker, rebuild/restart it: `docker compose up -d --build backend`. If you run Uvicorn directly, restart the server process.',
    )
  }

  throw new Error(lastText || (lastRes ? `HTTP ${lastRes.status}` : 'Failed to send feedback'))
}

export default function FeedbackPage() {
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(() => {
    const msg = String(message || '').trim()
    return msg.length >= 5 && msg.length <= 10_000
  }, [message])

  const normalizedEmail = useMemo(() => normalizeEmail(email), [email])

  return (
    <div className={styles.page}>
      {error ? <ErrorCallout message={error} onDismiss={() => setError(null)} /> : null}

      <div className={cn(ui.card, styles.headerCard)}>
        <div className={ui.cardHeader}>
          <div>
            <h2>Feedback</h2>
            <div className={cn(util.muted, util.small)}>Share a bug report, feature request, or anything else.</div>
          </div>
        </div>

        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit || submitting) return

            setSubmitting(true)
            setSent(false)
            setError(null)

            const referrer = (() => {
              try {
                return document.referrer || undefined
              } catch {
                return undefined
              }
            })()

            void submitFeedback({
              message: String(message || '').trim(),
              email: normalizedEmail,
              path: location.pathname || '/',
              search: location.search || '',
              referrer,
            })
              .then(() => {
                setSent(true)
                setMessage('')
              })
              .catch((err) => {
                setError(err instanceof Error ? err.message : 'Failed to send feedback')
              })
              .finally(() => {
                setSubmitting(false)
              })
          }}
        >
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email (optional)</span>
            <input
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              inputMode="email"
              autoComplete="email"
              aria-invalid={email.trim().length > 0 && !normalizedEmail ? 'true' : undefined}
            />
            {email.trim().length > 0 && !normalizedEmail ? (
              <span className={cn(util.muted, util.small)} role="status">
                Please enter a valid email (or leave blank).
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
            <button className={cn(ui.button)} type="submit" disabled={!canSubmit || submitting}>
              {submitting ? 'Sending…' : 'Send feedback'}
            </button>
            {sent ? <span className={cn(util.muted, util.small)}>Thanks — feedback sent.</span> : null}
          </div>
        </form>
      </div>
    </div>
  )
}
