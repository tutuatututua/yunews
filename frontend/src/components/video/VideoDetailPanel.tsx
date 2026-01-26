import React from 'react'
import { Link } from 'react-router-dom'
import Markdown from '../Markdown'
import { cn } from '../../lib/cn'
import { safeExternalHref } from '../../lib/safeUrl'
import { ui, util } from '../../styles'
import styles from './VideoDetailPanel.module.css'
import VideoTickerBadge, { type EdgeSentiment } from './VideoTickerBadge'

type Sentiment = 'positive' | 'negative' | 'neutral'

function toEdgeSentiment(raw: string | null | undefined): Sentiment | null {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return null
  if (s === 'positive' || s === 'bullish' || s === 'up') return 'positive'
  if (s === 'negative' || s === 'bearish' || s === 'down') return 'negative'
  if (s === 'neutral' || s === 'mixed') return 'neutral'
  return null
}

function getSentimentRowClass(sentiment: Sentiment | null | undefined): string | null {
  if (sentiment === 'positive') return styles.detailRowPositive
  if (sentiment === 'negative') return styles.detailRowNegative
  if (sentiment === 'neutral') return styles.detailRowNeutral
  return null
}

function buildVideosHref(days: number): string {
  return `/videos?days=${encodeURIComponent(String(days))}`
}

function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || '').trim())}`
}

function buildYouTubeThumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(String(videoId || '').trim())}/hqdefault.jpg`
}

function toUtcDayIndex(isoLike: string | null | undefined): number | null {
  if (!isoLike) return null
  const ms = Date.parse(isoLike)
  if (!Number.isFinite(ms)) return null
  return Math.floor(ms / 86_400_000)
}

function dayIndexToIsoDate(dayIndex: number): string {
  const d = new Date(dayIndex * 86_400_000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function normalizeKeypointText(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function buildKeypointSentimentIndex(edges: Array<{ sentiment: EdgeSentiment; key_points: string[] }> | undefined): Map<string, EdgeSentiment> {
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

function formatIsoDateTime(isoLike: string | null | undefined): string {
  if (!isoLike) return '—'
  const ms = Date.parse(isoLike)
  if (!Number.isFinite(ms)) return String(isoLike)
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(
    d.getUTCHours(),
  ).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

function formatEventWhen(ev: { date?: unknown; timeframe?: unknown } | null | undefined): string | null {
  if (!ev) return null
  const parts: string[] = []
  if ((ev as any).date) parts.push(String((ev as any).date))
  if ((ev as any).timeframe) parts.push(String((ev as any).timeframe))
  const when = parts.join(' • ')
  return when || null
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

export default function VideoDetailPanel(props: {
  videoId: string
  days: number
  summary: any
  meta: any
  tickerDetails: any[] | undefined
  copiedHref: string | null
  copyHref: (href: string) => Promise<void> | void
  getMentionCount?: (symbol: string) => number
  onSelectTicker?: (symbol: string) => void
  showVideosLink?: boolean
}) {
  const { videoId, days, summary, meta, tickerDetails, copiedHref, copyHref, getMentionCount, onSelectTicker } = props

  const showVideosLink = props.showVideosLink !== false

  const title = meta?.title || (summary as any)?.title || `Video ${videoId}`
  const channel = meta?.channel || null

  const publishedDay = toUtcDayIndex(meta?.published_at)
  const publishedIso = publishedDay == null ? null : dayIndexToIsoDate(publishedDay)

  const watchUrl = meta?.video_url ? safeExternalHref(meta.video_url) : videoId ? buildYouTubeWatchUrl(videoId) : null
  const thumbnailUrl = meta?.thumbnail_url || (videoId ? buildYouTubeThumbUrl(videoId) : null)

  const overall = toEdgeSentiment(summary?.sentiment)
  const overallRowClass = getSentimentRowClass(overall)

  const edges = meta?.edges
  const keypointIndex = buildKeypointSentimentIndex(edges)

  const tickerSet = new Set<string>()
  for (const t of summary?.tickers || []) tickerSet.add(String(t || '').trim().toUpperCase())
  for (const mv of summary?.movers || []) tickerSet.add(String(mv?.symbol || '').trim().toUpperCase())
  for (const td of tickerDetails || []) tickerSet.add(String(td?.ticker || '').trim().toUpperCase())
  tickerSet.delete('')

  const mentionCountForTicker = (sym: string) => {
    const n = getMentionCount ? getMentionCount(sym) : 0
    return Number.isFinite(n) ? n : 0
  }

  const tickers = Array.from(tickerSet.values()).sort((a, b) => mentionCountForTicker(b) - mentionCountForTicker(a) || a.localeCompare(b))

  const tickerEdges = (edges || [])
    .map((e: any) => ({ ticker: String(e?.ticker || '').trim().toUpperCase(), sentiment: e?.sentiment }))
    .filter((e: any) => e.ticker && (e.sentiment === 'positive' || e.sentiment === 'negative' || e.sentiment === 'neutral'))

  const sentimentForTicker = (sym: string): Sentiment => {
    const hit = tickerEdges.find((e: any) => e.ticker === sym)
    return (hit?.sentiment as Sentiment) || overall || 'neutral'
  }

  return (
    <div className={styles.videoDetailWrap} aria-label="Video summary">
      <div className={cn(styles.detailRow, overallRowClass)}>
        <div className={styles.detailRowGrid}>
          <div className={styles.detailThumbWrap}>
            {thumbnailUrl ? (
              watchUrl ? (
                <a className={styles.detailThumbLink} href={watchUrl} target="_blank" rel="noreferrer noopener" aria-label={`Open ${title}`}>
                  <img className={styles.detailThumb} src={safeExternalHref(thumbnailUrl)} alt="" loading="lazy" />
                  <span className={styles.detailThumbPlay} aria-hidden="true" />
                </a>
              ) : (
                <img className={styles.detailThumb} src={safeExternalHref(thumbnailUrl)} alt="" loading="lazy" />
              )
            ) : (
              <div className={styles.detailThumbPlaceholder} aria-hidden="true" />
            )}
          </div>

          <div className={styles.detailRowMain}>
            <div className={styles.detailRowHeader}>
              <div className={styles.detailRowHeaderLeft}>
                {watchUrl ? (
                  <a className={styles.detailRowTitle} href={watchUrl} target="_blank" rel="noreferrer noopener" title={title}>
                    {title}
                  </a>
                ) : (
                  <div className={styles.detailRowTitle} title={title}>
                    {title}
                  </div>
                )}

                <div className={styles.detailRowSubline}>
                  {publishedIso ? <span>{publishedIso}</span> : <span>Unknown publish date</span>}
                  {channel ? <span aria-hidden="true">•</span> : null}
                  {channel ? <span>{channel}</span> : null}
                </div>
              </div>

              <div className={styles.detailRowBadges}>
                <div className={styles.videoActions}>
                  {watchUrl ? (
                    <a className={cn(ui.button, ui.ghost)} href={watchUrl} target="_blank" rel="noreferrer noopener">
                      Watch
                    </a>
                  ) : null}
                  {watchUrl ? (
                    <button
                      type="button"
                      className={cn(ui.button, ui.ghost)}
                      onClick={() => {
                        void copyHref(watchUrl)
                      }}
                      title="Copy the video URL"
                    >
                      {copiedHref === watchUrl ? 'Copied' : 'Copy link'}
                    </button>
                  ) : null}
                  {showVideosLink ? (
                    <Link className={cn(ui.button, ui.ghost)} to={buildVideosHref(days)}>
                      Videos
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>

            <div className={styles.videoMetaGrid}>
              <div className={styles.videoMetaBlock}>
                <div className={styles.videoMetaLabel}>Summary sentiment</div>
                <div className={styles.videoMetaValue}>{summary?.sentiment || '—'}</div>
              </div>
              <div className={styles.videoMetaBlock}>
                <div className={styles.videoMetaLabel}>Published</div>
                <div className={styles.videoMetaValue}>{formatIsoDateTime(summary?.published_at || meta?.published_at)}</div>
              </div>
              <div className={styles.videoMetaBlock}>
                <div className={styles.videoMetaLabel}>Model</div>
                <div className={styles.videoMetaValue}>{summary?.model || '—'}</div>
              </div>
              <div className={styles.videoMetaBlock}>
                <div className={styles.videoMetaLabel}>Summarized</div>
                <div className={styles.videoMetaValue}>{formatIsoDateTime(summary?.summarized_at)}</div>
              </div>
            </div>

            {summary?.overall_explanation?.trim() ? (
              <div className={styles.videoSection}>
                <div className={styles.videoSectionTitle}>Overall explanation</div>
                <div className={cn(util.small)}>{summary.overall_explanation}</div>
              </div>
            ) : null}

            {tickers.length ? (
              <div className={styles.videoTickers} aria-label="Tickers mentioned in summary">
                <div className={styles.videoSectionTitle}>Tickers</div>
                <div className={cn(styles.edgeChips, styles.edgeChipsStart)}>
                  {tickers.slice(0, 14).map((sym) => (
                    <VideoTickerBadge
                      key={`${videoId}-t-${sym}`}
                      symbol={sym}
                      days={days}
                      sentiment={sentimentForTicker(sym)}
                      title={`${sym}: ${sentimentForTicker(sym)}`}
                      onClick={() => {
                        onSelectTicker?.(sym)
                      }}
                    />
                  ))}
                  {tickers.length > 14 ? <span className={cn(styles.edgeChip, styles.edgeChipMore)}>+{tickers.length - 14}</span> : null}
                </div>
              </div>
            ) : null}

            {summary?.key_points?.length ? (
              <div className={styles.videoSection}>
                <div className={styles.videoSectionTitle}>Key points</div>
                <ul className={styles.detailKeypointsList} aria-label="Summary key points">
                  {summary.key_points.slice(0, 10).map((kp: string, i: number) => {
                    const s = keypointIndex.get(normalizeKeypointText(kp)) || overall || 'neutral'
                    return (
                      <li key={`${videoId}-sumkp-${i}`} className={styles.detailKeypointsItem}>
                        <span className={cn(styles.keypointDot, styles[`keypointDot_${s}`])} title={`Sentiment: ${s}`} />
                        <span className={styles.keypointText}>{kp}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}

            <div className={styles.videoTwoCol}>
              {summary?.movers?.length ? (
                <div className={styles.videoSection}>
                  <div className={styles.videoSectionTitle}>Top movers</div>
                  <div className={styles.videoEvents} aria-label="Movers">
                    {summary.movers.slice(0, 12).map((mv: any, i: number) => {
                      const sym = String(mv?.symbol || '').trim().toUpperCase() || '—'
                      const dir = String(mv?.direction || 'mixed') as 'up' | 'down' | 'mixed'
                      const dirClass = dir === 'up' ? styles.moverChipUp : dir === 'down' ? styles.moverChipDown : styles.moverChipMixed
                      const reason = String(mv?.reason || '').trim()
                      return (
                        <div key={`${videoId}-mv-${sym}-${i}`} className={styles.videoEventRow}>
                          <div className={styles.videoEventWhen}>
                            <Link to={`/ticker?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(String(days))}`} className={cn(styles.moverChip, dirClass)} title={reason || undefined}>
                              {sym}
                            </Link>
                          </div>
                          <div className={styles.videoEventWhat}>{reason || '—'}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {summary?.events?.length ? (
                <div className={styles.videoSection}>
                  <div className={styles.videoSectionTitle}>Events</div>
                  <div className={styles.videoEvents}>
                    {summary.events.slice(0, 6).map((ev: any, i: number) => {
                      const when = formatEventWhen(ev)
                      return (
                        <div key={`${videoId}-ev-${i}`} className={styles.videoEventRow}>
                          {when ? <div className={styles.videoEventWhen}>{when}</div> : null}
                          <div className={styles.videoEventWhat}>{String(ev?.description || '').trim() || '—'}</div>
                          {ev?.tickers?.length ? (
                            <div className={styles.videoEventTickers}>
                              {ev.tickers.slice(0, 6).map((t: any) => {
                                const sym = String(t || '').trim().toUpperCase()
                                if (!sym) return null
                                return <VideoTickerBadge key={`${videoId}-ev-${i}-${sym}`} symbol={sym} days={days} sentiment={sentimentForTicker(sym)} />
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {summary?.opportunities?.length || summary?.risks?.length ? (
              <div className={styles.videoTwoCol}>
                {summary?.opportunities?.length ? (
                  <div className={styles.videoSection}>
                    <div className={styles.videoSectionTitle}>Opportunities</div>
                    <ul className={styles.videoBullets}>
                      {summary.opportunities.slice(0, 8).map((t: string, i: number) => (
                        <li key={`${videoId}-opp-${i}`}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {summary?.risks?.length ? (
                  <div className={styles.videoSection}>
                    <div className={styles.videoSectionTitle}>Risks</div>
                    <ul className={styles.videoBullets}>
                      {summary.risks.slice(0, 8).map((t: string, i: number) => (
                        <li key={`${videoId}-risk-${i}`}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {summary?.summary_markdown ? (
              <div className={styles.videoSection}>
                <div className={styles.videoSectionTitle}>Summary</div>
                <Markdown markdown={summary.summary_markdown} />
              </div>
            ) : null}

            {tickerDetails?.length ? (
              <div className={styles.videoSection}>
                <div className={styles.videoSectionTitle}>Ticker details</div>
                <div className={styles.videoEvents}>
                  {[...tickerDetails]
                    .sort((a, b) => {
                      const aSym = String(a?.ticker || '').trim().toUpperCase()
                      const bSym = String(b?.ticker || '').trim().toUpperCase()
                      return mentionCountForTicker(bSym) - mentionCountForTicker(aSym) || aSym.localeCompare(bSym)
                    })
                    .slice(0, 25)
                    .map((td, i) => {
                      const sym = String(td?.ticker || '').trim().toUpperCase()
                      if (!sym) return null
                      const s = toEdgeSentiment(td?.sentiment) || 'neutral'
                      const md = formatTickerSummaryMarkdown(td?.summary)

                      return (
                        <div key={`${videoId}-td-${sym}-${i}`} className={styles.videoEventRow}>
                          <div className={styles.videoEventWhen}>
                            <VideoTickerBadge symbol={sym} days={days} sentiment={s} />
                            <span className={cn(ui.chip)} style={{ marginLeft: 8 }}>
                              {s}
                            </span>
                          </div>
                          {md ? (
                            <div className={styles.videoSection}>
                              <Markdown markdown={md} />
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
