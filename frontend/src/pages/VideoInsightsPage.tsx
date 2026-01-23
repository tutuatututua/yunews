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

type EdgeSentiment = 'positive' | 'negative' | 'neutral'

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

function formatDurationSeconds(seconds: unknown): string {
  const n = typeof seconds === 'number' ? seconds : Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const s = Math.floor(n)
  const mm = Math.floor(s / 60)
  const ss = s % 60
  if (mm < 60) return `${mm}:${String(ss).padStart(2, '0')}`
  const hh = Math.floor(mm / 60)
  const rem = mm % 60
  return `${hh}:${String(rem).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function normalizeKeypointText(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function buildKeypointSentimentIndex(
  edges: Array<{ sentiment: EdgeSentiment; key_points: string[] }> | undefined,
): Map<string, EdgeSentiment> {
  const m = new Map<string, EdgeSentiment>()
  for (const e of edges || []) {
    const s = e?.sentiment
    if (!(s === 'positive' || s === 'negative' || s === 'neutral')) continue
    for (const kp of e?.key_points || []) {
      const norm = normalizeKeypointText(String(kp || ''))
      if (!norm) continue
      if (!m.has(norm)) m.set(norm, s)
    }
  }
  return m
}

function formatTickerSummaryMarkdown(summary: any): string {
  if (!summary || typeof summary !== 'object') return ''

  const asList = (v: any): string[] => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [])

  const positive = asList((summary as any).positive)
  const negative = asList((summary as any).negative)
  const neutral = asList((summary as any).neutral)

  const bull = asList((summary as any).bull_case)
  const bear = asList((summary as any).bear_case)
  const risks = asList((summary as any).risks)

  const lines: string[] = []
  const addSection = (title: string, items: string[]) => {
    if (!items.length) return
    lines.push(`**${title}**`)
    for (const item of items.slice(0, 12)) lines.push(`- ${item}`)
    lines.push('')
  }

  if (positive.length || negative.length || neutral.length) {
    addSection('Positive', positive)
    addSection('Negative', negative)
    addSection('Neutral', neutral)
  } else {
    addSection('Bull case', bull)
    addSection('Bear case', bear)
    addSection('Risks', risks)
  }

  return lines.join('\n').trim()
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
  // Backend video detail route is keyed by `video_id`.
  // Prefer `video_id` over `id` in case list rows include a separate DB id.
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null)

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
                            {(() => {
                              const detailVideo = (detailQuery.data as any)?.video as any
                              const publishedAt =
                                (detailQuery.data.summary?.published_at as string | null | undefined) ||
                                (detailVideo?.published_at as string | null | undefined) ||
                                v.published_at

                              const durationSeconds =
                                (detailVideo?.duration_seconds as number | null | undefined) ??
                                (v.duration_seconds as number | null | undefined)

                              const views = (detailVideo?.view_count as number | null | undefined) ?? v.view_count
                              const likes = (detailVideo?.like_count as number | null | undefined) ?? v.like_count
                              const comments = (detailVideo?.comment_count as number | null | undefined) ?? v.comment_count

                              return (
                                <>
                                  Model {detailQuery.data.summary.model || '—'} •{' '}
                                  {formatDateTime(detailQuery.data.summary.summarized_at, { timeZone: intlTimeZone, shiftMinutes: effectiveShiftMinutes })}
                                  {publishedAt ? (
                                    <>
                                      {' '}• Published{' '}
                                      {formatDateTime(publishedAt, { timeZone: intlTimeZone, shiftMinutes: effectiveShiftMinutes })}
                                    </>
                                  ) : null}
                                  {durationSeconds != null ? <> • Duration {formatDurationSeconds(durationSeconds)}</> : null}
                                  {views != null ? <> • Views {formatCompactNumber(views)}</> : null}
                                  {likes != null ? <> • Likes {formatCompactNumber(likes)}</> : null}
                                  {comments != null ? <> • Comments {formatCompactNumber(comments)}</> : null}
                                </>
                              )
                            })()}
                          </div>

                          <div className={styles.inlineMeta}>
                            <div className={styles.metaItem}>
                              <div className={styles.metaLabel}>Tickers</div>
                              <div className={util.small}>
                                {detailQuery.data.summary.tickers?.length ? (
                                  <span className={styles.inlineTickers}>
                                    {detailQuery.data.summary.tickers.slice(0, 16).map((symRaw, idx) => {
                                      const sym = String(symRaw || '').trim().toUpperCase()
                                      if (!sym) return null
                                      return (
                                        <Link
                                          key={`${sym}-${idx}`}
                                          className={cn(ui.chip, styles.inlineTickerChip)}
                                          to={`/ticker?days=${encodeURIComponent(String(days))}&symbol=${encodeURIComponent(sym)}`}
                                          title={`Open ${sym} in ticker view`}
                                        >
                                          {sym}
                                        </Link>
                                      )
                                    })}
                                  </span>
                                ) : (
                                  '—'
                                )}
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

                          {(() => {
                            const rowVid = String(rowVideoId || '')
                            const infoItem = rowVid ? infographicByVideoId.get(rowVid) : undefined
                            const edges = (infoItem?.edges || []) as Array<{ ticker: string; sentiment: EdgeSentiment; key_points: string[] }>
                            const kpIndex = buildKeypointSentimentIndex(edges)

                            return detailQuery.data.summary.key_points?.length ? (
                              <div className={styles.section}>
                                <div className={styles.sectionTitle}>Key points</div>
                                <ul className={styles.keypointsList}>
                                  {detailQuery.data.summary.key_points.slice(0, 16).map((kp, idx) => {
                                    const s = kpIndex.get(normalizeKeypointText(kp)) || 'neutral'
                                    return (
                                      <li key={idx} className={styles.keypointItem}>
                                        <span className={cn(styles.keypointDot, styles[`keypointDot_${s}`])} title={`Sentiment: ${s}`} />
                                        <span className={styles.keypointText}>{kp}</span>
                                      </li>
                                    )
                                  })}
                                </ul>
                              </div>
                            ) : null
                          })()}

                          {detailQuery.data.summary.events?.length ? (
                            <div className={styles.section}>
                              <div className={styles.sectionTitle}>Events</div>
                              <div className={styles.eventsList}>
                                {detailQuery.data.summary.events.slice(0, 10).map((ev, idx) => {
                                  const whenParts: string[] = []
                                  if (ev?.date) whenParts.push(String(ev.date))
                                  if (ev?.timeframe) whenParts.push(String(ev.timeframe))
                                  const when = whenParts.join(' • ')
                                  const tickers = Array.isArray(ev?.tickers) ? ev.tickers : []
                                  return (
                                    <div key={idx} className={styles.eventRow}>
                                      {when ? <div className={styles.eventWhen}>{when}</div> : null}
                                      <div className={styles.eventWhat}>{String(ev?.description || '').trim() || '—'}</div>
                                      {tickers.length ? (
                                        <div className={styles.eventTickers}>
                                          {tickers.slice(0, 8).map((t, j) => {
                                            const sym = String(t || '').trim().toUpperCase()
                                            if (!sym) return null
                                            return (
                                              <Link
                                                key={`${sym}-${j}`}
                                                className={cn(ui.chip, styles.eventTickerChip)}
                                                to={`/ticker?days=${encodeURIComponent(String(days))}&symbol=${encodeURIComponent(sym)}`}
                                              >
                                                {sym}
                                              </Link>
                                            )
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ) : null}

                          {detailQuery.data.summary.opportunities?.length || detailQuery.data.summary.risks?.length ? (
                            <div className={styles.twoCol}>
                              {detailQuery.data.summary.opportunities?.length ? (
                                <div className={styles.section}>
                                  <div className={styles.sectionTitle}>Opportunities</div>
                                  <ul className={styles.bullets}>
                                    {detailQuery.data.summary.opportunities.slice(0, 10).map((t, idx) => (
                                      <li key={idx}>{t}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {detailQuery.data.summary.risks?.length ? (
                                <div className={styles.section}>
                                  <div className={styles.sectionTitle}>Risks</div>
                                  <ul className={styles.bullets}>
                                    {detailQuery.data.summary.risks.slice(0, 10).map((t, idx) => (
                                      <li key={idx}>{t}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {detailQuery.data.ticker_details?.length ? (
                            <div className={styles.section}>
                              <div className={styles.sectionTitle}>Ticker details</div>
                              <div className={styles.tickerDetailsList}>
                                {detailQuery.data.ticker_details.slice(0, 25).map((td, idx) => {
                                  const sym = String(td?.ticker || '').trim().toUpperCase()
                                  if (!sym) return null
                                  const sentiment = String((td as any)?.sentiment || 'neutral') as EdgeSentiment
                                  const md = formatTickerSummaryMarkdown((td as any)?.summary)
                                  return (
                                    <div key={`${sym}-${idx}`} className={styles.tickerDetailRow}>
                                      <div className={styles.tickerDetailTop}>
                                        <Link
                                          className={cn(ui.chip, styles.tickerDetailChip, styles[`tickerDetailChip_${sentiment}`])}
                                          to={`/ticker?days=${encodeURIComponent(String(days))}&symbol=${encodeURIComponent(sym)}`}
                                        >
                                          {sym}
                                        </Link>
                                        <span className={cn(ui.chip, styles.tickerDetailSentiment)}>{sentiment}</span>
                                      </div>
                                      {md ? <Markdown markdown={md} /> : <div className={cn(util.muted, util.small)}>No summary stored.</div>}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ) : null}

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
