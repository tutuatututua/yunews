import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Markdown from '../components/Markdown'
import { ErrorCallout, EmptyState } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { cn } from '../lib/cn'
import { getUiErrorInfo } from '../lib/errors'
import { formatDateTime, parseDays } from '../lib/format'
import { resolveTimeShiftMinutes, resolveTimeZoneForIntl, useTimeZone } from '../app/timeZone'
import { useDailySummariesList, useDailySummary, useTopMovers, useVideoInfographic } from '../services/queries'
import { ui, util } from '../styles'
import styles from './HomePage.module.css'

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

function formatSentimentScore(input: unknown): string | null {
  const n = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(n)) return null
  // Support either [-1,1] score or [-100,100] percentage-style (older/alternate data).
  const score = Math.abs(n) > 1 ? n / 100 : n
  const clamped = Math.max(-1, Math.min(1, score))
  const sign = clamped > 0 ? '+' : ''
  return `${sign}${clamped.toFixed(2)}`
}

function isIsoDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
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

function buildTickerVideoCounts(items: Array<{ edges: Array<{ ticker: string }>; video_id?: string }> | undefined): Map<string, number> {
  const byTicker = new Map<string, number>()

  for (const item of items || []) {
    const uniqueTickersInVideo = new Set<string>()
    for (const edge of item.edges || []) {
      if (edge?.ticker) uniqueTickersInVideo.add(edge.ticker)
    }
    for (const ticker of uniqueTickersInVideo) {
      byTicker.set(ticker, (byTicker.get(ticker) || 0) + 1)
    }
  }

  return byTicker
}

export default function HomePage() {
  const { timeZone, timeShiftMinutes } = useTimeZone()
  const intlTimeZone = resolveTimeZoneForIntl(timeZone)
  const effectiveShiftMinutes = resolveTimeShiftMinutes(timeZone, timeShiftMinutes)

  const [params, setParams] = useSearchParams()
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState('')

  const moversMaxAgo = 7
  const moversDays = useMemo(() => {
    const parsed = parseDays(params.get('moversDays'), 3)
    return Math.max(1, Math.min(moversMaxAgo + 1, parsed))
  }, [params])

  const onChangeMoversDays: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const n = Number(e.target.value)
    const next = new URLSearchParams(params)
    if (Number.isFinite(n)) next.set('moversDays', String(Math.max(1, Math.min(moversMaxAgo + 1, Math.floor(n)))))
    else next.delete('moversDays')
    next.delete('moversMinAgo')
    next.delete('moversMaxAgo')
    setParams(next)
  }

  const selectedDate = useMemo(() => {
    const raw = (params.get('date') || '').trim()
    if (!raw) return null
    return isIsoDateOnly(raw) ? raw : null
  }, [params])

  const onChangeDate: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const next = new URLSearchParams(params)
    const v = e.target.value
    if (v && isIsoDateOnly(v)) next.set('date', v)
    else next.delete('date')
    setParams(next)
  }

  const onClickLatest = () => {
    const next = new URLSearchParams(params)
    next.delete('date')
    setParams(next)
  }

  const dailyQuery = useDailySummary(selectedDate)
  const anchorDate = selectedDate || dailyQuery.data?.market_date

  const availableDatesQuery = useDailySummariesList(180)
  const availableDates = useMemo(() => {
    const list = availableDatesQuery.data || []
    const dates = list
      .map((s) => String((s as any)?.market_date || '').trim())
      .filter((d) => isIsoDateOnly(d))
    // Ensure uniqueness while preserving order (already newest-first from backend).
    return Array.from(new Set(dates))
  }, [availableDatesQuery.data])

  useEffect(() => {
    // If someone pastes a date in the URL that doesn't exist, fall back to latest.
    if (!selectedDate) return
    if (!availableDates.length) return
    if (availableDates.includes(selectedDate)) return

    const next = new URLSearchParams(params)
    next.delete('date')
    setParams(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, availableDates.join('|')])

  // Movers are windowed independently from the daily summary; default to the last 3 days.
  const moversAnchorDate = selectedDate || undefined
  const infographicQuery = useVideoInfographic(moversAnchorDate, moversDays, 200, true)
  const moversQuery = useTopMovers(moversAnchorDate, moversDays, 8, true)

  const tickerStats = useMemo(() => buildTickerStats(infographicQuery.data), [infographicQuery.data])
  const tickerVideoCounts = useMemo(() => buildTickerVideoCounts(infographicQuery.data as any), [infographicQuery.data])

  const moversSortedByMentions = useMemo(() => {
    const items = moversQuery.data ? [...moversQuery.data] : []
    items.sort((a, b) => {
      const aTotal = tickerStats.get(a.symbol)?.total ?? 0
      const bTotal = tickerStats.get(b.symbol)?.total ?? 0
      if (bTotal !== aTotal) return bTotal - aTotal
      return a.symbol.localeCompare(b.symbol)
    })
    return items
  }, [moversQuery.data, tickerStats])

  const errorInfo =
    getUiErrorInfo(dailyQuery.error) ||
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
          <section className={ui.card} aria-label="Daily market summary">
          <div className={ui.cardHeader}>
            <h2>Market brief</h2>
            <div className={styles.headerChips} aria-label="Market brief metadata">
              <div className={styles.dateControls} aria-label="Select market date">
                <label className={styles.dateLabel} htmlFor="marketDate">
                  Market date
                </label>
                <select
                  id="marketDate"
                  className={styles.dateInput}
                  value={selectedDate || ''}
                  onChange={onChangeDate}
                  aria-busy={availableDatesQuery.isLoading}
                >
                  <option value="">Latest</option>
                  {availableDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={cn(ui.button, ui.ghost)}
                  onClick={onClickLatest}
                  disabled={!selectedDate}
                  title="Clear date to use latest"
                >
                  Latest
                </button>
              </div>
              <span className={ui.chip}>{anchorDate || 'Latest'}</span>
              {(() => {
                const outlook = normalizeDailyOutlook(dailyQuery.data?.sentiment)
                const score = formatSentimentScore(dailyQuery.data?.sentiment_score)
                const reason = String(dailyQuery.data?.sentiment_reason || '').trim()
                if (!outlook && !score) return null

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
                    {score ? ` • ${score}` : ''}
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
              <div className={styles.sideHeaderRight}>
                <div className={styles.sliderRow} aria-label="Top mentions window">
                  <input
                    id="moversWindow"
                    type="range"
                    min={1}
                    max={moversMaxAgo + 1}
                    step={1}
                    value={moversDays}
                    onChange={onChangeMoversDays}
                    className={styles.slider}
                    aria-label="Top mentions window (days)"
                  />
                  <span
                    className={cn(ui.chip, styles.windowChip)}
                    title="How many days to include ending at the selected market date (or latest)"
                  >
                    {moversDays === 1 ? 'Latest day' : `Last ${moversDays} days`}
                  </span>
                </div>
              </div>
            </div>

            {moversQuery.isLoading && <LoadingLine label="Loading movers…" />}

            {!moversQuery.isLoading && moversQuery.data?.length ? (
              <div className={styles.moversList}>
                {moversSortedByMentions.slice(0, 10).map((m, idx) => {
                  const stats = tickerStats.get(m.symbol)
                  const videoCount = tickerVideoCounts.get(m.symbol) || 0
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
