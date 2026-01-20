import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Markdown from '../components/Markdown'
import { EmptyState, ErrorCallout } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { cn } from '../lib/cn'
import { getUiErrorInfo } from '../lib/errors'
import { formatCompactNumber, formatDateTime, parseDays } from '../lib/format'
import { safeExternalHref } from '../lib/safeUrl'
import { resolveTimeShiftMinutes, resolveTimeZoneForIntl, useTimeZone } from '../app/timeZone'
import { useLatestDailySummary, useVideoDetail, useVideoInfographic, useVideos } from '../services/queries'
import type { VideoInfographicItem, VideoListItem } from '../types'
import { ui, util } from '../styles'
import styles from './VideoInsightsPage.module.css'

type Sentiment = 'bullish' | 'bearish' | 'mixed'

type SentimentCounts = { positive: number; negative: number; neutral: number }

type VideoEdgeSummary = {
  tickers: string[]
  counts: SentimentCounts
  overall: Sentiment
}

type MoverDirection = 'up' | 'down' | 'mixed'

function normalizeMoverDirection(input: unknown): MoverDirection | null {
  const s = String(input || '').trim().toLowerCase()
  if (s === 'up' || s === 'bullish' || s === 'positive') return 'up'
  if (s === 'down' || s === 'bearish' || s === 'negative') return 'down'
  if (s === 'mixed' || s === 'neutral') return 'mixed'
  return null
}

function moverDirectionLabel(d: MoverDirection): string {
  if (d === 'up') return 'Up'
  if (d === 'down') return 'Down'
  return 'Mixed'
}

function sentimentPillLabel(s: Sentiment): string {
  if (s === 'bullish') return 'Bullish'
  if (s === 'bearish') return 'Bearish'
  return 'Mixed'
}

function normalizeSentiment(input: string | null | undefined): Sentiment | null {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return null
  if (s === 'bullish' || s === 'positive') return 'bullish'
  if (s === 'bearish' || s === 'negative') return 'bearish'
  if (s === 'mixed' || s === 'neutral') return 'mixed'
  return null
}

function videoHref(v: VideoListItem): string {
  if (v.video_url) return safeExternalHref(v.video_url)
  if (v.video_id) return `https://www.youtube.com/watch?v=${encodeURIComponent(v.video_id)}`
  return safeExternalHref('#')
}

function summarizeVideoEdges(items: VideoInfographicItem[] | undefined): Map<string, VideoEdgeSummary> {
  const byVideoId = new Map<string, VideoEdgeSummary>()
  for (const item of items || []) {
    const counts: SentimentCounts = { positive: 0, negative: 0, neutral: 0 }
    const tickers = new Set<string>()

    for (const edge of item.edges || []) {
      tickers.add(edge.ticker)
      counts[edge.sentiment] += 1
    }

    const overall: Sentiment =
      counts.positive === counts.negative
        ? 'mixed'
        : counts.positive > counts.negative
          ? 'bullish'
          : 'bearish'

    byVideoId.set(item.video_id, { tickers: Array.from(tickers).sort(), counts, overall })
  }
  return byVideoId
}


export default function VideoInsightsPage() {
  const { timeZone, timeShiftMinutes } = useTimeZone()
  const intlTimeZone = resolveTimeZoneForIntl(timeZone)
  const effectiveShiftMinutes = resolveTimeShiftMinutes(timeZone, timeShiftMinutes)

  const [params, setParams] = useSearchParams()
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
  const infographicQuery = useVideoInfographic(anchorDate, days, 250, canQueryWindow)

  const edgeSummaryByVideoId = useMemo(() => summarizeVideoEdges(infographicQuery.data), [infographicQuery.data])

  const detailQuery = useVideoDetail(expandedId)

  const onChangeDays: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const next = new URLSearchParams(params)
    next.set('days', e.target.value)
    setParams(next)
  }

  const errorInfo =
    getUiErrorInfo(dailyQuery.error) ||
    getUiErrorInfo(videosQuery.error) ||
    getUiErrorInfo(infographicQuery.error) ||
    getUiErrorInfo(detailQuery.error) ||
    null

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h2>Video insights</h2>
          <div className={cn(util.muted, util.small)}>
            {anchorDate ? `Anchored to ${anchorDate}` : 'Latest'} • Last {days} days • Showing {limit}
          </div>
        </div>

        <div className={styles.headerActions}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Window</span>
            <select className={styles.select} value={String(days)} onChange={onChangeDays} aria-label="Select day window">
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </label>  

          <Link className={cn(ui.button, ui.ghost)} to={`/ticker?days=${encodeURIComponent(String(days))}`}>
            Ticker view
          </Link>
        </div>
      </div>

      {errorInfo && <ErrorCallout message={errorInfo.message} requestId={errorInfo.requestId} />}

      {!canQueryWindow && <LoadingLine label="Preparing your feed…" />}
      {canQueryWindow && videosQuery.isLoading && <LoadingLine label="Loading videos…" />}

      {canQueryWindow && !videosQuery.isLoading && !videosQuery.data?.length && (
        <EmptyState title="No videos found" body="Try expanding the window or verify the backend has ingested videos." />
      )}

      <section className={ui.card} aria-label="Video feed">
        {(videosQuery.data || []).map((v) => {
          const expanded = expandedId === v.id
          const edgeSummary = v.video_id ? edgeSummaryByVideoId.get(v.video_id) : undefined
          const rowSentiment = normalizeSentiment(v.sentiment) || edgeSummary?.overall || null

          const toggleExpanded = () => setExpandedId(expanded ? null : v.id)

          return (
            <div key={v.id} className={cn(styles.videoRow, expanded && styles.videoRowExpanded)}>
              <div className={styles.videoTop}>
                {v.thumbnail_url ? (
                  <img className={styles.thumb} src={v.thumbnail_url} alt="" loading="lazy" decoding="async" />
                ) : (
                  <div className={styles.thumb} aria-hidden="true" />
                )}

                <div className={styles.videoMeta}>
                  <div className={styles.titleRow}>
                    <button
                      className={styles.videoTitleButton}
                      onClick={toggleExpanded}
                      aria-expanded={expanded}
                      type="button"
                      title={expanded ? 'Hide summary' : 'View summary'}
                    >
                      {v.title}
                    </button>

                    {rowSentiment ? (
                      <span
                        className={cn(
                          ui.chip,
                          styles.sentimentChip,
                          rowSentiment === 'bullish' && styles.sentimentPos,
                          rowSentiment === 'bearish' && styles.sentimentNeg,
                          rowSentiment === 'mixed' && styles.sentimentNeu,
                        )}
                        title="Sentiment derived from stored video summary (fallback: infographic edges)"
                      >
                        {sentimentPillLabel(rowSentiment)}
                      </span>
                    ) : (
                      <span className={cn(ui.chip, styles.sentimentChip)} title="Sentiment derived from stored video summary (fallback: infographic edges)">
                        Sentiment —
                      </span>
                    )}
                  </div>
                  <div className={cn(util.muted, util.small)}>
                    {v.channel || 'Unknown channel'} • {formatDateTime(v.published_at, { timeZone: intlTimeZone, shiftMinutes: effectiveShiftMinutes })}
                  </div>

                  {v.overall_explanation?.trim() ? (
                    <div className={styles.videoDesc}>{v.overall_explanation}</div>
                  ) : null}

                  <div className={styles.badges} aria-label="Video badges">
                    {edgeSummary?.tickers?.slice(0, 4).map((t) => (
                      <span key={t} className={cn(ui.chip, styles.tickerChip)}>
                        {t}
                      </span>
                    ))}
                    {edgeSummary?.tickers?.length && edgeSummary.tickers.length > 4 ? (
                      <span className={cn(ui.chip, styles.moreChip)}>+{edgeSummary.tickers.length - 4}</span>
                    ) : null}
                  </div>

                  <div className={cn(util.muted, util.small)}>
                    Views {formatCompactNumber(v.view_count)} • Likes {formatCompactNumber(v.like_count)} • Comments{' '}
                    {formatCompactNumber(v.comment_count)}
                  </div>
                </div>
              </div>

              {expanded && (
                <div className={styles.inlineDetail} aria-live="polite">
                  {detailQuery.isLoading && <LoadingLine label="Loading video detail…" />}

                  {!detailQuery.isLoading && detailQuery.data && (
                    <>
                      {detailQuery.data.summary ? (
                        <>
                          <div className={styles.inlineHeader}>
                            <h3 className={styles.inlineTitle}>Summary</h3>
                            <a className={cn(ui.button, ui.ghost)} href={videoHref(v)} target="_blank" rel="noreferrer noopener">
                              Watch
                            </a>
                          </div>

                          <div className={cn(util.muted, util.small)}>
                            Model {detailQuery.data.summary.model} • {formatDateTime(detailQuery.data.summary.summarized_at, { timeZone: intlTimeZone, shiftMinutes: effectiveShiftMinutes })}
                          </div>

                          <div className={styles.inlineMeta}>
                            <div className={styles.metaItem}>
                              <div className={styles.metaLabel}>Tickers</div>
                              <div className={util.small}>
                                {detailQuery.data.summary.tickers?.length ? detailQuery.data.summary.tickers.join(', ') : '—'}
                              </div>
                            </div>
                            <div className={styles.metaItem}>
                              <div className={styles.metaLabel}>Sentiment</div>
                              <div className={util.small}>{detailQuery.data.summary.sentiment || '—'}</div>
                            </div>
                          </div>

                          <div className={styles.overallBlock}>
                            <div className={styles.metaLabel}>Overall explanation</div>
                            <div className={styles.overallText}>
                              {detailQuery.data.summary.overall_explanation?.trim() || '—'}
                            </div>
                          </div>

                          <div className={styles.moversSection} aria-label="Top movers in this video">
                            <div className={styles.moversHeader}>
                              <div className={styles.metaLabel}>Top movers</div>
                              <span className={cn(ui.chip, styles.moversCountChip)} title="Key tickers driving this video (from stored video summary)">
                                {detailQuery.data.summary.movers?.length ?? 0}
                              </span>
                            </div>

                            {detailQuery.data.summary.movers?.length ? (
                              <div className={styles.moversList}>
                                {detailQuery.data.summary.movers.slice(0, 8).map((mv, idx) => {
                                  const sym = String(mv?.symbol || '').trim().toUpperCase()
                                  const dir = normalizeMoverDirection(mv?.direction) || 'mixed'
                                  const reason = String(mv?.reason || '').trim()
                                  const tickerHref = `/ticker?days=${encodeURIComponent(String(days))}&symbol=${encodeURIComponent(sym)}`

                                  return (
                                    <div key={`${sym || 'mover'}-${idx}`} className={styles.moverItem}>
                                      <div className={styles.moverTopRow}>
                                        {sym ? (
                                          <Link className={cn(ui.chip, styles.moverSymbolChip)} to={tickerHref} title={`Open ${sym} in ticker view`}>
                                            {sym}
                                          </Link>
                                        ) : (
                                          <span className={cn(ui.chip, styles.moverSymbolChip)} aria-label="Unknown symbol">
                                            —
                                          </span>
                                        )}

                                        <span
                                          className={cn(
                                            ui.chip,
                                            styles.moverDirChip,
                                            dir === 'up' && styles.moverDirUp,
                                            dir === 'down' && styles.moverDirDown,
                                            dir === 'mixed' && styles.moverDirMixed,
                                          )}
                                          title="Direction as described by the summarizer"
                                        >
                                          {moverDirectionLabel(dir)}
                                        </span>
                                      </div>

                                      {reason ? (
                                        <div className={styles.moverReason}>{reason}</div>
                                      ) : (
                                        <div className={cn(util.muted, util.small)}>No rationale stored.</div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <div className={cn(util.muted, util.small, styles.moversEmpty)}>
                                No movers were extracted for this video.
                              </div>
                            )}
                          </div>

                          <Markdown markdown={detailQuery.data.summary.summary_markdown} />

                          {detailQuery.data.summary.key_points?.length ? (
                            <>
                              <div className={styles.metaLabel}>Key points</div>
                              <ul className={util.bullets}>
                                {detailQuery.data.summary.key_points.map((kp, idx) => (
                                  <li key={idx} className={util.small}>
                                    {kp}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <EmptyState title="No summary stored" body="This video may not have been summarized yet." />
                      )}

                    </>
                  )}

                  {!detailQuery.isLoading && !detailQuery.data && (
                    <EmptyState title="No details" body="Unable to load video detail from backend." />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
