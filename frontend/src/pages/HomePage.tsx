import React, { Suspense, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Markdown from '../components/Markdown'
import { ErrorCallout, EmptyState } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { cn } from '../lib/cn'
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

type SentimentTotals = { positive: number; negative: number; neutral: number; total: number }

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

function buildSentimentTotals(items: Array<{ edges: Array<{ ticker: string; sentiment: Sentiment }> }> | undefined): SentimentTotals {
  const totals: SentimentTotals = { positive: 0, negative: 0, neutral: 0, total: 0 }
  for (const item of items || []) {
    for (const edge of item.edges || []) {
      totals[edge.sentiment] += 1
      totals.total += 1
    }
  }
  return totals
}

export default function HomePage() {
  const { timeZone, timeShiftMinutes } = useTimeZone()
  const intlTimeZone = resolveTimeZoneForIntl(timeZone)
  const effectiveShiftMinutes = resolveTimeShiftMinutes(timeZone, timeShiftMinutes)

  const [params] = useSearchParams()
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState('')

  const days = useMemo(() => parseDays(params.get('days'), 7), [params])
  const limit = useMemo(() => {
    const n = params.get('limit')
    const parsed = n ? Number(n) : NaN
    return Number.isFinite(parsed) ? Math.max(10, Math.min(250, Math.floor(parsed))) : 100
  }, [params])

  const dailyQuery = useLatestDailySummary()
  const anchorDate = dailyQuery.data?.market_date

  const canQueryWindow = !dailyQuery.isLoading
  const videosQuery = useVideos(anchorDate, days, limit, canQueryWindow)
  const infographicQuery = useVideoInfographic(anchorDate, days, 200, canQueryWindow)
  const moversQuery = useTopMovers(anchorDate, days, 8, true)

  const tickerStats = useMemo(() => buildTickerStats(infographicQuery.data), [infographicQuery.data])
  const sentimentTotals = useMemo(() => buildSentimentTotals(infographicQuery.data), [infographicQuery.data])

  const uniqueChannels = useMemo(() => {
    const set = new Set<string>()
    for (const v of videosQuery.data || []) {
      if (v.channel) set.add(v.channel)
    }
    return set.size
  }, [videosQuery.data])

  const combinedError =
    (dailyQuery.error as any)?.message ||
    (videosQuery.error as any)?.message ||
    (infographicQuery.error as any)?.message ||
    (moversQuery.error as any)?.message ||
    null

  const visibleError = combinedError && combinedError !== dismissedError ? combinedError : null

  return (
    <div className={styles.page}>
      {visibleError && <ErrorCallout message={visibleError} onDismiss={() => setDismissedError(visibleError)} />}

      <div className={styles.dashboard}>
        <div className={styles.mainCol}>
          <section className={ui.card} aria-label="Daily market summary">
          <div className={ui.cardHeader}>
            <h2>Market brief</h2>
            <span className={ui.chip}>{anchorDate || 'Latest'}</span>
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
                </div>

                <div className={styles.kpiGrid} aria-label="At-a-glance stats">
                  <Kpi label="Window" value={`${days}d`} hint="Analysis window length" />
                  <Kpi
                    label="Videos"
                    value={canQueryWindow ? String(videosQuery.data?.length ?? 0) : '—'}
                    hint="Videos included in this window"
                  />
                  <Kpi label="Channels" value={canQueryWindow ? String(uniqueChannels) : '—'} hint="Unique channels in the window" />
                  <Kpi
                    label="Entities"
                    value={String(dailyQuery.data.per_entity_summaries?.length ?? tickerStats.size ?? 0)}
                    hint="Tickers/entities with extracted highlights"
                  />
                  <Kpi
                    label="Sentiment"
                    value={sentimentTotals.total ? `${Math.round(((sentimentTotals.positive - sentimentTotals.negative) / sentimentTotals.total) * 100)}%` : '—'}
                    hint="Net sentiment from infographic edges"
                  />
                  <Kpi
                    label="Signals"
                    value={sentimentTotals.total ? String(sentimentTotals.total) : '—'}
                    hint="Total ticker sentiment edges"
                  />
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
          <section className={cn(ui.card, styles.sideCard)} aria-label="Top movers">
            <div className={styles.sideHeader}>
              <h2>Top movers</h2>
              <span className={ui.chip}>{anchorDate || 'Latest'}</span>
            </div>

            {moversQuery.isLoading && <LoadingLine label="Loading movers…" />}

            {!moversQuery.isLoading && moversQuery.data?.length ? (
              <div className={styles.moversList}>
                {moversQuery.data.slice(0, 8).map((m, idx) => (
                  <div key={`${m.symbol}-${idx}`} className={styles.moverRow}>
                    <div className={styles.moverLeft}>
                      <div className={styles.moverSymbol}>{m.symbol}</div>
                      <div className={cn(util.muted, util.small)}>{m.reason}</div>

                      {(() => {
                        const stats = tickerStats.get(m.symbol)
                        if (!stats || !stats.total) return null
                        const pctClass =
                          stats.netPercent == null
                            ? styles.moverPctMixed
                            : stats.netPercent > 0
                              ? styles.moverPctUp
                              : stats.netPercent < 0
                                ? styles.moverPctDown
                                : styles.moverPctMixed
                        return (
                          <div className={styles.moverStats} aria-label="Mover stats">
                            <span
                              className={cn(ui.chip, styles.moverPct, pctClass)}
                              title="Net sentiment score derived from infographic edges"
                            >
                              {stats.netPercent != null ? `${stats.netPercent}%` : '—'}
                            </span>
                            <span className={cn(ui.chip, styles.moverCounts)} title="Counts derived from infographic edges">
                              <span className={styles.moverCountPos}>↑{stats.counts.positive}</span>
                              <span className={styles.moverCountNeg}>↓{stats.counts.negative}</span>
                              <span className={styles.moverCountNeu}>~{stats.counts.neutral}</span>
                            </span>
                          </div>
                        )
                      })()}
                    </div>
                    <div
                      className={cn(
                        styles.moverDir,
                        m.direction === 'bullish' && styles.moverUp,
                        m.direction === 'bearish' && styles.moverDown,
                        m.direction === 'mixed' && styles.moverMixed,
                      )}
                    >
                      {m.direction}
                    </div>
                  </div>
                ))}
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

function Kpi(props: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.kpiCard} title={props.hint || props.label}>
      <div className={styles.kpiLabel}>{props.label}</div>
      <div className={styles.kpiValue}>{props.value}</div>
    </div>
  )
}
