import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import VideoDetailPanel from '../components/video/VideoDetailPanel'
import VideoTickerBadge from '../components/video/VideoTickerBadge'
import detailStyles from '../components/video/VideoDetailPanel.module.css'
import { EmptyState, ErrorCallout } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { cn } from '../lib/cn'
import { getUiErrorInfo } from '../lib/errors'
import { formatCompactNumber, formatDateTime, parseDays } from '../lib/format'
import { resolveTimeShiftMinutes, resolveTimeZoneForIntl, useTimeZone } from '../app/timeZone'
import { useLatestDailySummary, useVideoDetail, useVideoInfographic, useVideos } from '../services/queries'
import type { VideoInfographicItem } from '../types'
import { ui, util } from '../styles'
import styles from './VideoInsightsPage.module.css'

type Sentiment = 'bullish' | 'bearish' | 'mixed'

type SentimentCounts = { positive: number; negative: number; neutral: number }

type VideoEdgeSummary = {
  tickers: string[]
  overall: Sentiment
  tickerSentiment: Record<string, EdgeSentiment>
}

type EdgeSentiment = 'positive' | 'negative' | 'neutral'

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

function summarizeVideoEdges(items: VideoInfographicItem[] | undefined): Map<string, VideoEdgeSummary> {
  const byVideoId = new Map<string, VideoEdgeSummary>()
  for (const item of items || []) {
    const totals: SentimentCounts = { positive: 0, negative: 0, neutral: 0 }
    const tickers = new Set<string>()

    const perTicker = new Map<string, SentimentCounts>()

    for (const edge of item.edges || []) {
      const sym = String(edge.ticker || '').trim().toUpperCase()
      if (!sym) continue

      const rawKeyPoints = (edge as any)?.key_points
      const w = Math.max(1, Array.isArray(rawKeyPoints) ? rawKeyPoints.length : 0)

      tickers.add(sym)
      totals[edge.sentiment] += w
      const cur = perTicker.get(sym) || { positive: 0, negative: 0, neutral: 0 }
      cur[edge.sentiment] += w
      perTicker.set(sym, cur)
    }

    const overall: Sentiment =
      totals.positive === totals.negative
        ? 'mixed'
        : totals.positive > totals.negative
          ? 'bullish'
          : 'bearish'

    const tickerSentiment: Record<string, EdgeSentiment> = {}
    for (const [sym, c] of perTicker.entries()) {
      tickerSentiment[sym] = c.positive === c.negative ? 'neutral' : c.positive > c.negative ? 'positive' : 'negative'
    }

    const sortedTickers = Array.from(tickers).sort((a, b) => {
      const aCounts = perTicker.get(a)
      const bCounts = perTicker.get(b)
      const aTotal = (aCounts?.positive || 0) + (aCounts?.negative || 0) + (aCounts?.neutral || 0)
      const bTotal = (bCounts?.positive || 0) + (bCounts?.negative || 0) + (bCounts?.neutral || 0)
      return bTotal - aTotal || a.localeCompare(b)
    })

    byVideoId.set(item.video_id, { tickers: sortedTickers, overall, tickerSentiment })
  }
  return byVideoId
}

export default function VideoInsightsPage() {
  const { timeZone, timeShiftMinutes } = useTimeZone()
  const intlTimeZone = resolveTimeZoneForIntl(timeZone)
  const effectiveShiftMinutes = resolveTimeShiftMinutes(timeZone, timeShiftMinutes)

  const [params, setParams] = useSearchParams()
  // Backend video detail route is keyed by `video_id`.
  // Prefer `video_id` over `id` in case list rows include a separate DB id.
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null)
  const [copiedHref, setCopiedHref] = useState<string | null>(null)

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
  const infographicByVideoId = useMemo(() => {
    const m = new Map<string, VideoInfographicItem>()
    for (const item of infographicQuery.data || []) {
      if (item?.video_id) m.set(item.video_id, item)
    }
    return m
  }, [infographicQuery.data])

  const detailQuery = useVideoDetail(expandedVideoId)

  const copyHref = async (href: string) => {
    const next = String(href || '').trim()
    if (!next) return

    const markCopied = () => {
      setCopiedHref(next)
      window.setTimeout(() => {
        setCopiedHref((cur) => (cur === next ? null : cur))
      }, 1100)
    }

    try {
      await navigator.clipboard.writeText(next)
      markCopied()
      return
    } catch {
      // Fallback for older browsers / permissions.
    }

    try {
      const el = document.createElement('textarea')
      el.value = next
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      markCopied()
    } catch {
      // ignore
    }
  }

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
          const rowVideoId = v.video_id || v.id
          const expanded = !!rowVideoId && expandedVideoId === rowVideoId
          const edgeSummary = v.video_id ? edgeSummaryByVideoId.get(v.video_id) : undefined
          const rowSentiment = normalizeSentiment(v.sentiment) || edgeSummary?.overall || null

          const toggleExpanded = () => setExpandedVideoId(expanded ? null : (rowVideoId || null))

          return (
            <div key={rowVideoId || v.id} className={cn(styles.videoRow, expanded && styles.videoRowExpanded)}>
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
                      <VideoTickerBadge
                        key={t}
                        symbol={t}
                        days={days}
                        sentiment={edgeSummary?.tickerSentiment?.[String(t || '').trim().toUpperCase()] || 'neutral'}
                      />
                    ))}
                    {edgeSummary?.tickers?.length && edgeSummary.tickers.length > 4 ? (
                      <span className={cn(detailStyles.edgeChip, detailStyles.edgeChipMore)}>+{edgeSummary.tickers.length - 4}</span>
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
                      {detailQuery.data.summary ? (() => {
                        const rowVid = String(rowVideoId || '')
                        const infoItem = rowVid ? infographicByVideoId.get(rowVid) : undefined

                        const meta = infoItem || v

                        const getMentionCount = (symbol: string) => {
                          const sym = String(symbol || '').trim().toUpperCase()
                          if (!sym) return 0
                          let total = 0
                          for (const e of infoItem?.edges || []) {
                            const t = String((e as any)?.ticker || '').trim().toUpperCase()
                            if (!t || t !== sym) continue
                            const kps = (e as any)?.key_points
                            const w = Math.max(1, Array.isArray(kps) ? kps.length : 0)
                            total += w
                          }
                          return total
                        }

                        return (
                          <>
                            <VideoDetailPanel
                              videoId={rowVid}
                              days={days}
                              summary={detailQuery.data.summary}
                              meta={meta}
                              tickerDetails={detailQuery.data.ticker_details}
                              copiedHref={copiedHref}
                              copyHref={copyHref}
                              variant="inline"
                              getMentionCount={getMentionCount}
                              showVideosLink={false}
                            />

                            {detailQuery.data.transcript?.transcript_text?.trim() ? (
                              <div className={styles.section}>
                                <div className={styles.sectionTitle}>Transcript</div>
                                <details className={styles.transcriptDetails}>
                                  <summary className={styles.transcriptSummary}>Show transcript</summary>
                                  <pre className={styles.transcriptText}>{detailQuery.data.transcript.transcript_text}</pre>
                                </details>
                              </div>
                            ) : null}
                          </>
                        )
                      })() : (
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
