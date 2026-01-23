import React, { Suspense, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Markdown from '../components/Markdown'
import { ErrorCallout, EmptyState } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { cn } from '../lib/cn'
import { getUiErrorInfo } from '../lib/errors'
import { formatDateTime, parseDays } from '../lib/format'
import { resolveTimeShiftMinutes, resolveTimeZoneForIntl, useTimeZone } from '../app/timeZone'
import { useLatestDailySummary, useTopMovers, useVideoInfographic, useVideos } from '../services/queries'
import { ui, util } from '../styles'
import styles from './HomePage.module.css'

const VideoTickerInfographic = React.lazy(() => import('../components/features/VideoTickerInfographic'))

type Sentiment = 'positive' | 'negative' | 'neutral'

type SentimentCounts = { positive: number; negative: number; neutral: number }

type TickerStats = {
  counts: SentimentCounts
  netPercent: number | null
  total: number
}

type DailyOutlook = 'bullish' | 'bearish' | 'mixed' | 'neutral'

function normalizeDailyOutlook(input: unknown): DailyOutlook | null {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return null
  if (s === 'bullish' || s === 'positive' || s === 'up') return 'bullish'
  if (s === 'bearish' || s === 'negative' || s === 'down') return 'bearish'
  if (s === 'mixed') return 'mixed'
  if (s === 'neutral') return 'neutral'
  return null
}

function dailyOutlookLabel(s: DailyOutlook): string {
  if (s === 'bullish') return 'Bullish'
  if (s === 'bearish') return 'Bearish'
  if (s === 'mixed') return 'Mixed'
  return 'Neutral'
}

function formatConfidencePct(input: unknown): string | null {
  const n = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(n)) return null
  // Support either [0,1] ratios or [0,100] percentages (older pipeline/data).
  const ratio = n > 1 ? n / 100 : n
  const clamped = Math.max(0, Math.min(1, ratio))
  return `${Math.round(clamped * 100)}%`
}

function buildTickerStats(items: Array<{ edges: Array<{ ticker: string; sentiment: Sentiment }> }> | undefined): Map<string, TickerStats> {
  const byTicker = new Map<string, SentimentCounts>()

  for (const item of items || []) {
    for (const edge of item.edges || []) {
      const prev = byTicker.get(edge.ticker) || { positive: 0, negative: 0, neutral: 0 }
      prev[edge.sentiment] += 1
      byTicker.set(edge.ticker, prev)
    }
  }

  const stats = new Map<string, TickerStats>()
  for (const [ticker, counts] of byTicker.entries()) {
    const total = counts.positive + counts.negative + counts.neutral
    const netPercent = total ? Math.round(((counts.positive - counts.negative) / total) * 100) : null
    stats.set(ticker, { counts, netPercent, total })
  }
  return stats
}

export default function HomePage() {
  const { timeZone, timeShiftMinutes } = useTimeZone()
  const intlTimeZone = resolveTimeZoneForIntl(timeZone)
  const effectiveShiftMinutes = resolveTimeShiftMinutes(timeZone, timeShiftMinutes)

  const [params, setParams] = useSearchParams()
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState('')

  const days = useMemo(() => parseDays(params.get('days'), 7), [params])
  const limit = useMemo(() => {
    const n = params.get('limit')
    const parsed = n ? Number(n) : NaN
    return Number.isFinite(parsed) ? Math.max(10, Math.min(250, Math.floor(parsed))) : 100
  }, [params])

  const onChangeDays: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const next = new URLSearchParams(params)
    next.set('days', e.target.value)
    setParams(next)
  }

  const onChangeLimit: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const next = new URLSearchParams(params)
    next.set('limit', e.target.value)
    setParams(next)
  }

  const dailyQuery = useLatestDailySummary()
  const anchorDate = dailyQuery.data?.market_date

  const canQueryWindow = !dailyQuery.isLoading
  const videosQuery = useVideos(anchorDate, days, limit, canQueryWindow)
  const infographicQuery = useVideoInfographic(anchorDate, days, 200, canQueryWindow)
  const moversQuery = useTopMovers(anchorDate, days, 8, true)

  const tickerStats = useMemo(() => buildTickerStats(infographicQuery.data), [infographicQuery.data])

  const errorInfo =
    getUiErrorInfo(dailyQuery.error) ||
    getUiErrorInfo(videosQuery.error) ||
    getUiErrorInfo(infographicQuery.error) ||
    getUiErrorInfo(moversQuery.error) ||
    null

  const visibleError = errorInfo?.message && errorInfo.message !== dismissedError ? errorInfo : null

  return (
    <div className={styles.page}>
      {visibleError && (
        <ErrorCallout
          message={visibleError.message}
          requestId={visibleError.requestId}
          onDismiss={() => setDismissedError(visibleError.message)}
        />
      )}

      <div className={styles.dashboard}>
        <div className={styles.mainCol}>
          <section className={cn(ui.card, styles.welcomeCard)} aria-label="Dashboard controls">
            <div className={styles.welcomeTop}>
              <div>
                <div className={styles.kicker}>yuNews</div>
                <div className={styles.welcomeTitle}>Market narrative, distilled</div>
                <div className={styles.welcomeBody}>
                  A daily brief plus the underlying videos and tickers—optimized for quick scanning, and deeper drill-down when you need it.
                </div>
              </div>

              <div className={styles.quickActions} aria-label="Quick actions">
                <label className={styles.toolbarField}>
                  <span className={styles.fieldLabel}>Window</span>
                  <select
                    className={cn(styles.select, styles.toolbarSelect)}
                    value={String(days)}
                    onChange={onChangeDays}
                    aria-label="Select day window"
                  >
                    <option value="7">Last 7 days</option>
                    <option value="14">Last 14 days</option>
                    <option value="30">Last 30 days</option>
                  </select>
                </label>

                <Link
                  className={cn(ui.button, ui.primary)}
                  to={`/ticker` + (days ? `?days=${encodeURIComponent(String(days))}` : '')}
                >
                  Explore ticker
                </Link>
                <Link
                  className={cn(ui.button, ui.ghost)}
                  to={`/videos` + (days ? `?days=${encodeURIComponent(String(days))}` : '')}
                >
                  Browse videos
                </Link>
              </div>
            </div>
          </section>

          <section className={ui.card} aria-label="Daily market summary">
          <div className={ui.cardHeader}>
            <h2>Market brief</h2>
            <div className={styles.headerChips} aria-label="Market brief metadata">
              <span className={ui.chip}>{anchorDate || 'Latest'}</span>
              {(() => {
                const outlook = normalizeDailyOutlook(dailyQuery.data?.sentiment)
                const conf = formatConfidencePct(dailyQuery.data?.sentiment_confidence)
                const reason = String(dailyQuery.data?.sentiment_reason || '').trim()
                if (!outlook && !conf) return null

                return (
                  <span
                    className={cn(
                      ui.chip,
                      styles.sentimentChip,
                      outlook === 'bullish' && styles.sentimentPos,
                      outlook === 'bearish' && styles.sentimentNeg,
                      (outlook === 'mixed' || outlook === 'neutral' || !outlook) && styles.sentimentNeu,
                    )}
                    title={reason ? `Daily sentiment: ${reason}` : 'Daily sentiment (from daily_summaries)'}
                  >
                    {outlook ? dailyOutlookLabel(outlook) : 'Sentiment'}
                    {conf ? ` • ${conf} conf` : ''}
                  </span>
                )
              })()}
            </div>
          </div>

          {dailyQuery.isLoading && <LoadingLine label="Loading market brief…" />}
          {!dailyQuery.isLoading && !dailyQuery.data && (
            <EmptyState title="No daily summary found" body="Run the pipeline or check the backend connection." />
          )}

          {dailyQuery.data && (
            <>
              <header className={styles.briefHeader}>
                <div className={styles.titleRow}>
                  <div className={styles.headline}>{dailyQuery.data.title}</div>
                  <div className={cn(util.muted, util.small)}>
                    Generated {formatDateTime(dailyQuery.data.generated_at, { timeZone: intlTimeZone, shiftMinutes: effectiveShiftMinutes })} • Model {dailyQuery.data.model}
                  </div>
                  {(() => {
                    const reason = String(dailyQuery.data?.sentiment_reason || '').trim()
                    if (!reason) return null
                    return <div className={cn(util.muted, util.small, styles.reasonLine)}>{reason}</div>
                  })()}
                </div>

                {(() => {
                  const outlook = normalizeDailyOutlook(dailyQuery.data.sentiment)
                  const conf = formatConfidencePct(dailyQuery.data.sentiment_confidence)
                  const reason = String(dailyQuery.data.sentiment_reason || '').trim()
                  if (!outlook && !conf && !reason) return null

                  return (
                    <div className={styles.outlookRow} aria-label="Next session outlook">
                      <div className={styles.outlookLabel}>Next session outlook</div>
                      {outlook ? (
                        <span
                          className={cn(
                            ui.chip,
                            styles.outlookChip,
                            outlook === 'bullish' && styles.outlookPos,
                            outlook === 'bearish' && styles.outlookNeg,
                            (outlook === 'mixed' || outlook === 'neutral') && styles.outlookNeu,
                          )}
                          title="Derived from the daily summary inputs"
                        >
                          {dailyOutlookLabel(outlook)}
                          {conf ? ` • ${conf} conf` : ''}
                        </span>
                      ) : conf ? (
                        <span className={cn(ui.chip, styles.outlookChip)} title="Derived from the daily summary inputs">
                          {conf} confidence
                        </span>
                      ) : null}

                      {reason ? <div className={cn(util.small, util.muted)}>{reason}</div> : null}
                    </div>
                  )
                })()}
              </header>

              <section className={styles.summaryBlock} aria-label="Daily summary">
                <div className={styles.summaryTop}>
                  <div className={styles.summaryLabel}>Overview</div>
                </div>
                {dailyQuery.data.overall_summarize?.trim() ? (
                  <div className={cn(util.small, util.muted)} style={{ marginBottom: 8 }}>
                    <Markdown markdown={dailyQuery.data.overall_summarize} />
                  </div>
                ) : null}
                <div className={styles.overviewBody}>
                  <Markdown markdown={dailyQuery.data.summary_markdown} />
                </div>
              </section>

              <div className={styles.summaryGrid} aria-label="Key takeaways">
                <InfoList title="Risks" subtitle="What could go wrong">
                  {dailyQuery.data.risks?.length ? (
                    <ul className={styles.bulletList}>
                      {dailyQuery.data.risks.map((r, idx) => (
                        <li key={idx} className={util.small}>
                          {r}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className={cn(util.muted, util.small)}>None</div>
                  )}
                </InfoList>

                <InfoList title="Opportunities" subtitle="Where upside may exist">
                  {dailyQuery.data.opportunities?.length ? (
                    <ul className={styles.bulletList}>
                      {dailyQuery.data.opportunities.map((o, idx) => (
                        <li key={idx} className={util.small}>
                          {o}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className={cn(util.muted, util.small)}>None</div>
                  )}
                </InfoList>
              </div>

              {dailyQuery.data.per_entity_summaries?.length ? (
                <div className={util.divider} />
              ) : null}

              {dailyQuery.data.per_entity_summaries?.length ? (
                <section aria-label="Stock highlights">
                  <div className={styles.sectionHeaderRow}>
                    <div>
                      <h3>Entity highlights</h3>
                      <div className={cn(util.muted, util.small)}>Per-entity summaries extracted from the same analysis window.</div>
                    </div>

                    <div className={styles.entityFilterWrap}>
                      <label className={styles.entityFilterLabel} htmlFor="entityFilter">
                        Filter
                      </label>
                      <input
                        id="entityFilter"
                        className={styles.textInput}
                        value={entityFilter}
                        onChange={(e) => setEntityFilter(e.target.value)}
                        placeholder="e.g. TSLA, NVDA"
                        inputMode="search"
                      />
                    </div>
                  </div>

                  <div className={styles.accordion}>
                    {dailyQuery.data.per_entity_summaries
                      .filter((e) => {
                        const q = entityFilter.trim().toUpperCase()
                        if (!q) return true
                        return e.symbol.toUpperCase().includes(q)
                      })
                      .map((e) => (
                      <details key={e.symbol} className={styles.accordionItem}>
                        <summary className={styles.accordionSummary}>
                          <span className={styles.ticker}>{e.symbol}</span>
                          <span className={cn(util.muted, util.small)}>Open summary</span>
                        </summary>
                        <div className={styles.accordionBody}>
                          <div className={cn(util.small, util.preWrap)}>{e.summary_markdown}</div>
                          {e.key_claims?.length ? (
                            <>
                              <div className={styles.metaLabel}>Key claims</div>
                              <ul className={util.bullets}>
                                {e.key_claims.map((c, idx) => (
                                  <li key={idx} className={util.small}>
                                    {c}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </section>
        </div>

        <aside className={styles.sideCol} aria-label="Sidebar panels">
          <section className={cn(ui.card, styles.sideCard)} aria-label="Top mentions">
            <div className={styles.sideHeader}>
              <h2>Top mentions</h2>
              <span className={ui.chip}>{anchorDate || 'Latest'}</span>
            </div>

            {moversQuery.isLoading && <LoadingLine label="Loading movers…" />}

            {!moversQuery.isLoading && moversQuery.data?.length ? (
              <div className={styles.moversList}>
                {moversQuery.data.slice(0, 10).map((m, idx) => {
                  const stats = tickerStats.get(m.symbol)
                  const dirClass =
                    m.direction === 'bullish'
                      ? styles.moverRowUp
                      : m.direction === 'bearish'
                        ? styles.moverRowDown
                        : styles.moverRowMixed

                  const pctClass =
                    stats?.netPercent == null
                      ? styles.moverPctMixed
                      : stats.netPercent > 0
                        ? styles.moverPctUp
                        : stats.netPercent < 0
                          ? styles.moverPctDown
                          : styles.moverPctMixed

                  return (
                    <div key={`${m.symbol}-${idx}`} className={cn(styles.moverRow, dirClass)}>
                    <div className={styles.moverLeft}>
                      <div className={styles.moverSymbol}>{m.symbol}</div>
                      <div className={cn(util.muted, util.small)}>{m.reason}</div>
                    </div>
                    <div className={styles.moverRight} aria-label="Mover stats">
                      {stats && stats.total ? (
                        <>
                          <span
                            className={cn(ui.chip, styles.moverPct, pctClass)}
                            title="Net sentiment score derived from infographic edges"
                          >
                            {stats.netPercent != null ? `${stats.netPercent}%` : '—'}
                          </span>
                          <span className={cn(ui.chip, styles.moverCounts)} title="Edge sentiment counts">
                            <span className={styles.moverCountPos}>↑{stats.counts.positive}</span>
                            <span className={styles.moverCountNeg}>↓{stats.counts.negative}</span>
                            <span className={styles.moverCountNeu}>~{stats.counts.neutral}</span>
                          </span>
                        </>
                      ) : (
                        <span className={cn(ui.chip, styles.moverCounts)} title="No edge sentiment stats for this ticker">
                          —
                        </span>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            ) : !moversQuery.isLoading ? (
              <div className={cn(util.muted, util.small)}>No movers found for this window.</div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  )
}

function InfoList(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className={styles.infoBox}>
      <div className={styles.infoBoxTitleRow}>
        <div className={styles.infoBoxTitle}>{props.title}</div>
        {props.subtitle ? <div className={styles.infoBoxSubtitle}>{props.subtitle}</div> : null}
      </div>
      <div className={styles.infoBoxBody}>{props.children}</div>
    </div>
  )
}
