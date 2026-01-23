import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Markdown from '../components/Markdown'
import { EmptyState, ErrorCallout } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { RangeSlider } from '../components/ui/RangeSlider'
import { cn } from '../lib/cn'
import { getUiErrorInfo } from '../lib/errors'
import { parseDays } from '../lib/format'
import { safeExternalHref } from '../lib/safeUrl'
import { useEntityChunks, useLatestDailySummary, useVideoDetail, useVideoInfographic } from '../services/queries'
import type { EntityChunkRow } from '../types'
import { ui, util } from '../styles'
import styles from './TickerPage.module.css'

const VideoTickerInfographic = React.lazy(() => import('../components/features/VideoTickerInfographic'))

type Sentiment = 'positive' | 'negative' | 'neutral'

type SentimentTotals = { positive: number; negative: number; neutral: number; total: number }

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

function buildUniqueTickers(items: Array<{ edges: Array<{ ticker: string }> }> | undefined): number {
  const tickers = new Set<string>()
  for (const item of items || []) {
    for (const edge of item.edges || []) {
      const sym = String(edge?.ticker || '').trim().toUpperCase()
      if (sym) tickers.add(sym)
    }
  }
  return tickers.size
}

function buildUniqueChannels(items: Array<{ channel: string | null }> | undefined): number {
  const channels = new Set<string>()
  for (const item of items || []) {
    if (item.channel) channels.add(item.channel)
  }
  return channels.size
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
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

function formatRelativeDayDelta(deltaDays: number): string {
  if (!Number.isFinite(deltaDays)) return '—'
  if (deltaDays === 0) return 'same day'
  const abs = Math.abs(deltaDays)
  const unit = abs === 1 ? 'day' : 'days'
  return deltaDays > 0 ? `${abs} ${unit} before` : `${abs} ${unit} after`
}

function normalizeKeypointText(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function toEdgeSentiment(raw: string | null | undefined): Sentiment | null {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return null
  if (s === 'positive' || s === 'bullish' || s === 'up') return 'positive'
  if (s === 'negative' || s === 'bearish' || s === 'down') return 'negative'
  if (s === 'neutral' || s === 'mixed') return 'neutral'
  return null
}

function buildKeypointSentimentIndex(edges: Array<{ sentiment: Sentiment; key_points: string[] }> | undefined): Map<string, Sentiment> {
  const m = new Map<string, Sentiment>()
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

function groupEntityChunkRows(
  rows: EntityChunkRow[],
): Array<{ key: string; row: EntityChunkRow; keypoints: Array<{ text: string; sentiment: Sentiment }> }> {
  const byVideo = new Map<
    string,
    {
      key: string
      row: EntityChunkRow
      keypoints: Array<{ text: string; sentiment: Sentiment }>
      keypointSet: Set<string>
    }
  >()

  for (const r of rows) {
    const videoId = r.videos?.video_id ? String(r.videos.video_id) : null
    const rawUrl = r.videos?.video_url ? safeExternalHref(r.videos.video_url) : null
    const title = r.videos?.title ? String(r.videos.title) : null
    const key = videoId ? `yt:${videoId}` : rawUrl ? `url:${rawUrl}` : `title:${title || 'unknown'}`

    const kpbs = r.keypoints_by_sentiment || null
    const pos = Array.isArray(kpbs?.positive) ? kpbs?.positive : []
    const neg = Array.isArray(kpbs?.negative) ? kpbs?.negative : []
    const neu = Array.isArray(kpbs?.neutral) ? kpbs?.neutral : []
    const existing = byVideo.get(key)
    if (!existing) {
      const keypoints: Array<{ text: string; sentiment: Sentiment }> = []
      const keypointSet = new Set<string>()
      for (const raw of pos) {
        const kp = String(raw || '').trim()
        if (!kp || keypointSet.has(kp)) continue
        keypoints.push({ text: kp, sentiment: 'positive' })
        keypointSet.add(kp)
      }
      for (const raw of neg) {
        const kp = String(raw || '').trim()
        if (!kp || keypointSet.has(kp)) continue
        keypoints.push({ text: kp, sentiment: 'negative' })
        keypointSet.add(kp)
      }
      for (const raw of neu) {
        const kp = String(raw || '').trim()
        if (!kp || keypointSet.has(kp)) continue
        keypoints.push({ text: kp, sentiment: 'neutral' })
        keypointSet.add(kp)
      }
      byVideo.set(key, { key, row: r, keypoints, keypointSet })
      continue
    }

    for (const raw of pos) {
      const kp = String(raw || '').trim()
      if (!kp || existing.keypointSet.has(kp)) continue
      existing.keypoints.push({ text: kp, sentiment: 'positive' })
      existing.keypointSet.add(kp)
    }
    for (const raw of neg) {
      const kp = String(raw || '').trim()
      if (!kp || existing.keypointSet.has(kp)) continue
      existing.keypoints.push({ text: kp, sentiment: 'negative' })
      existing.keypointSet.add(kp)
    }
    for (const raw of neu) {
      const kp = String(raw || '').trim()
      if (!kp || existing.keypointSet.has(kp)) continue
      existing.keypoints.push({ text: kp, sentiment: 'neutral' })
      existing.keypointSet.add(kp)
    }
  }

  return Array.from(byVideo.values()).map(({ key, row, keypoints }) => ({
    key,
    row,
    keypoints: keypoints.length ? keypoints : [{ text: '—', sentiment: 'neutral' }],
  }))
}

export default function TickerPage() {
  const [params, setParams] = useSearchParams()
  const days = useMemo(() => parseDays(params.get('days'), 7), [params])

  const getIntParam = (key: string): number | null => {
    const raw = params.get(key)
    if (raw == null) return null
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return Math.floor(n)
  }

  const symbolFromUrl = useMemo(() => {
    const raw = params.get('symbol')
    const sym = String(raw || '').trim().toUpperCase()
    return sym || null
  }, [params])

  const onChangeDays: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const next = new URLSearchParams(params)
    next.set('days', e.target.value)
    setParams(next, { replace: true })
  }

  const dailyQuery = useLatestDailySummary()
  const anchorDate = dailyQuery.data?.market_date
  const infographicQuery = useVideoInfographic(anchorDate, days, 250, !dailyQuery.isLoading)

  const rawItems = infographicQuery.data || []

  const allItemsByVideoId = useMemo(() => {
    const m = new Map<string, (typeof rawItems)[number]>()
    for (const v of rawItems) {
      const id = String(v?.video_id || '').trim()
      if (!id) continue
      if (!m.has(id)) m.set(id, v)
    }
    return m
  }, [rawItems])

  const dateBounds = useMemo(() => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const v of rawItems) {
      const di = toUtcDayIndex(v?.published_at)
      if (di == null) continue
      min = Math.min(min, di)
      max = Math.max(max, di)
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const today = Math.floor(Date.now() / 86_400_000)
      return { minDay: today, maxDay: today }
    }

    return { minDay: min, maxDay: max }
  }, [rawItems])

  const [publishedMinDay, setPublishedMinDay] = useState<number | null>(() => getIntParam('publishedMinDay'))
  const [publishedMaxDay, setPublishedMaxDay] = useState<number | null>(() => getIntParam('publishedMaxDay'))
  const [mentionsMin, setMentionsMin] = useState<number | null>(() => getIntParam('mentionsMin'))
  const [mentionsMax, setMentionsMax] = useState<number | null>(() => getIntParam('mentionsMax'))

  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [copiedHref, setCopiedHref] = useState<string | null>(null)

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

  useEffect(() => {
    if (symbolFromUrl && symbolFromUrl !== selectedTicker) {
      setSelectedTicker(symbolFromUrl)
      setSelectedVideoId(null)
    }
  }, [symbolFromUrl, selectedTicker])

  const publishedRefDay = useMemo(() => {
    const lo = publishedMinDay ?? dateBounds.minDay
    const hi = publishedMaxDay ?? dateBounds.maxDay
    return Math.max(lo, hi)
  }, [publishedMinDay, publishedMaxDay, dateBounds.minDay, dateBounds.maxDay])

  const selectedPublishedWindow = useMemo(() => {
    const lo = publishedMinDay ?? dateBounds.minDay
    const hi = publishedMaxDay ?? dateBounds.maxDay
    const minDay = Math.min(lo, hi)
    const maxDay = Math.max(lo, hi)
    return {
      minDay,
      maxDay,
      label: `${dayIndexToIsoDate(minDay)} – ${dayIndexToIsoDate(maxDay)}`,
    }
  }, [publishedMinDay, publishedMaxDay, dateBounds.minDay, dateBounds.maxDay])

  const defaultDateWindowDays = 3

  useEffect(() => {
    const windowDays = Math.max(1, Math.floor(defaultDateWindowDays))
    const defaultMinDay = Math.max(dateBounds.minDay, dateBounds.maxDay - (windowDays - 1))
    setPublishedMinDay((prev) => {
      const next = prev == null ? defaultMinDay : clamp(prev, dateBounds.minDay, dateBounds.maxDay)
      return next
    })
    setPublishedMaxDay((prev) => {
      const next = prev == null ? dateBounds.maxDay : clamp(prev, dateBounds.minDay, dateBounds.maxDay)
      return next
    })
  }, [dateBounds.minDay, dateBounds.maxDay])

  const dateFilteredItems = useMemo(() => {
    const lo = publishedMinDay ?? dateBounds.minDay
    const hi = publishedMaxDay ?? dateBounds.maxDay
    const minDay = Math.min(lo, hi)
    const maxDay = Math.max(lo, hi)

    return rawItems.filter((v) => {
      const di = toUtcDayIndex(v?.published_at)
      if (di == null) return false
      return di >= minDay && di <= maxDay
    })
  }, [rawItems, publishedMinDay, publishedMaxDay, dateBounds.minDay, dateBounds.maxDay])

  const mentionCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of dateFilteredItems) {
      for (const e of v?.edges || []) {
        const sym = String(e?.ticker || '').trim().toUpperCase()
        if (!sym) continue
        m.set(sym, (m.get(sym) || 0) + 1)
      }
    }
    return m
  }, [dateFilteredItems])

  const maxMentionsObserved = useMemo(() => {
    let max = 0
    for (const v of mentionCounts.values()) max = Math.max(max, v)
    return max
  }, [mentionCounts])

  const mentionMinBound = useMemo(() => {
    // If there are any mentions at all, start the slider at 1 (so we don't show “0 mentions”).
    return maxMentionsObserved > 0 ? 1 : 0
  }, [maxMentionsObserved])

  const mentionDefaultMin = useMemo(() => {
    // Default to 2+ mentions when possible, otherwise fall back to the minimum bound.
    return maxMentionsObserved >= 2 ? 2 : mentionMinBound
  }, [maxMentionsObserved, mentionMinBound])

  useEffect(() => {
    // Initialize / clamp mention range based on data (after date filtering).
    setMentionsMin((prev) => {
      const seed = prev == null ? mentionDefaultMin : prev
      return clamp(seed, mentionMinBound, maxMentionsObserved)
    })
    setMentionsMax((prev) => {
      if (prev == null) return maxMentionsObserved
      return clamp(prev, mentionMinBound, maxMentionsObserved)
    })
  }, [maxMentionsObserved, mentionMinBound, mentionDefaultMin])

  const filteredItems = useMemo(() => {
    const resolvedMentionsMin = mentionsMin ?? mentionDefaultMin
    const resolvedMentionsMax = mentionsMax ?? maxMentionsObserved

    const minMentions = Math.min(resolvedMentionsMin, resolvedMentionsMax)
    const maxMentions = Math.max(resolvedMentionsMin, resolvedMentionsMax)

    const allowedTickers = new Set<string>()
    for (const [sym, cnt] of mentionCounts.entries()) {
      if (cnt >= minMentions && cnt <= maxMentions) allowedTickers.add(sym)
    }

    return dateFilteredItems
      .map((v) => {
        const edges = (v?.edges || []).filter((e) => allowedTickers.has(String(e?.ticker || '').trim().toUpperCase()))
        return { ...v, edges }
      })
      .filter((v) => (v.edges || []).length > 0)
  }, [dateFilteredItems, mentionCounts, mentionsMin, mentionsMax, mentionDefaultMin, maxMentionsObserved])

  useEffect(() => {
    // Persist filters in URL so navigating away + back restores state.
    const next = new URLSearchParams(params)

    const defaultPublishedMaxDay = dateBounds.maxDay
    const defaultPublishedMinDay = Math.max(dateBounds.minDay, dateBounds.maxDay - (defaultDateWindowDays - 1))

    const resolvedPublishedMinDay = publishedMinDay ?? defaultPublishedMinDay
    const resolvedPublishedMaxDay = publishedMaxDay ?? defaultPublishedMaxDay

    const resolvedMentionsMin = mentionsMin ?? mentionDefaultMin
    const resolvedMentionsMax = mentionsMax ?? maxMentionsObserved

    if (resolvedPublishedMinDay === defaultPublishedMinDay) next.delete('publishedMinDay')
    else next.set('publishedMinDay', String(resolvedPublishedMinDay))

    if (resolvedPublishedMaxDay === defaultPublishedMaxDay) next.delete('publishedMaxDay')
    else next.set('publishedMaxDay', String(resolvedPublishedMaxDay))

    if (resolvedMentionsMin === mentionDefaultMin) next.delete('mentionsMin')
    else next.set('mentionsMin', String(resolvedMentionsMin))

    if (resolvedMentionsMax === maxMentionsObserved) next.delete('mentionsMax')
    else next.set('mentionsMax', String(resolvedMentionsMax))

    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [
    params,
    setParams,
    publishedMinDay,
    publishedMaxDay,
    mentionsMin,
    mentionsMax,
    mentionDefaultMin,
    maxMentionsObserved,
    dateBounds.minDay,
    dateBounds.maxDay,
  ])

  const sentimentTotals = useMemo(() => buildSentimentTotals(filteredItems), [filteredItems])
  const uniqueChannels = useMemo(() => buildUniqueChannels(filteredItems), [filteredItems])
  const uniqueTickers = useMemo(() => buildUniqueTickers(filteredItems), [filteredItems])

  const errorInfo = getUiErrorInfo(dailyQuery.error) || getUiErrorInfo(infographicQuery.error)

  const entityChunksQuery = useEntityChunks(selectedTicker, { days, limit: 120 }, !!selectedTicker)
  const videoDetailQuery = useVideoDetail(selectedVideoId)

  const selectedVideoInfographic = useMemo(() => {
    if (!selectedVideoId) return null
    return allItemsByVideoId.get(selectedVideoId) || null
  }, [allItemsByVideoId, selectedVideoId])

  const selectedVideoMeta = useMemo(() => {
    if (!selectedVideoId) return null
    // Prefer the full infographic dataset so selections outside the current filters still render with full context.
    const full = allItemsByVideoId.get(selectedVideoId)
    if (full) return full
    return filteredItems.find((x) => x.video_id === selectedVideoId) || null
  }, [allItemsByVideoId, filteredItems, selectedVideoId])

  const selectedNodeId = selectedVideoId || selectedTicker

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h2>Ticker</h2>
          <div className={cn(util.muted, util.small)}>{anchorDate ? `Anchored to ${anchorDate}` : 'Latest'}</div>
        </div>
      </div>

      <div className={styles.kpiGrid} aria-label="At-a-glance stats">
        <Kpi label="Window" value={`${days}d`} hint="Analysis window length" />
        <Kpi
          label="Videos (filtered)"
          value={infographicQuery.isLoading ? '—' : String(filteredItems.length)}
          hint="Videos remaining after applying filters"
        />
        <Kpi
          label="Channels (filtered)"
          value={infographicQuery.isLoading ? '—' : String(uniqueChannels)}
          hint="Unique channels remaining after applying filters"
        />
        <Kpi
          label="Entities (filtered)"
          value={infographicQuery.isLoading ? '—' : String(uniqueTickers)}
          hint="Unique tickers remaining after applying filters"
        />
        <Kpi
          label="Sentiment (filtered)"
          value={sentimentTotals.total ? `${Math.round(((sentimentTotals.positive - sentimentTotals.negative) / sentimentTotals.total) * 100)}%` : '—'}
          hint="Net sentiment from filtered infographic edges"
        />
        <Kpi
          label="Signals (filtered)"
          value={infographicQuery.isLoading ? '—' : String(sentimentTotals.total)}
          hint="Total filtered ticker sentiment edges"
        />
      </div>

      <div className={cn(ui.card, styles.filtersCard)}>
        <div className={styles.filtersHeader}>
          <div className={styles.filtersTitleRow}>
            <div className={styles.filtersTitle}>Filters</div>
            <span className={cn(ui.chip, styles.filtersChip)} title="Videos remaining after applying filters">
              {filteredItems.length} videos
            </span>
          </div>
          <button
            type="button"
            className={cn(ui.button, ui.ghost)}
            onClick={() => {
              setPublishedMinDay(Math.max(dateBounds.minDay, dateBounds.maxDay - (defaultDateWindowDays - 1)))
              setPublishedMaxDay(dateBounds.maxDay)
              setMentionsMin(mentionDefaultMin)
              setMentionsMax(maxMentionsObserved)

              const next = new URLSearchParams(params)
              next.delete('publishedMinDay')
              next.delete('publishedMaxDay')
              next.delete('mentionsMin')
              next.delete('mentionsMax')
              if (next.toString() !== params.toString()) setParams(next, { replace: true })
            }}
          >
            Reset
          </button>
        </div>

        <div className={styles.filtersGrid}>
          <div className={styles.filterRow}>
            <div className={styles.filterLabel}>
              Ticker mentions:{' '}
              <span className={styles.filterValue}>{Math.min(mentionsMin ?? mentionDefaultMin, mentionsMax ?? maxMentionsObserved)}</span>
              {' – '}
              <span className={styles.filterValue}>{Math.max(mentionsMin ?? mentionDefaultMin, mentionsMax ?? maxMentionsObserved)}</span>
            </div>
            <div className={styles.filterControls}>
              <RangeSlider
                min={mentionMinBound}
                max={Math.max(mentionMinBound, maxMentionsObserved)}
                step={1}
                value={[
                  clamp(
                    Math.min(mentionsMin ?? mentionDefaultMin, mentionsMax ?? maxMentionsObserved),
                    mentionMinBound,
                    Math.max(mentionMinBound, maxMentionsObserved),
                  ),
                  clamp(
                    Math.max(mentionsMin ?? mentionDefaultMin, mentionsMax ?? maxMentionsObserved),
                    mentionMinBound,
                    Math.max(mentionMinBound, maxMentionsObserved),
                  ),
                ]}
                onValueChange={([min, max]) => {
                  setMentionsMin(min)
                  setMentionsMax(max)
                }}
                thumbLabels={['Minimum ticker mentions', 'Maximum ticker mentions']}
              />
            </div>
            <div className={cn(util.muted, util.small)}>Based on the current date window (max: {maxMentionsObserved}).</div>
          </div>

          <div className={styles.filterRow}>
            <div className={styles.filterLabel}>
              Video published date:{' '}
              <span className={styles.filterValue}>
                {dayIndexToIsoDate(Math.min(publishedMinDay ?? dateBounds.minDay, publishedMaxDay ?? dateBounds.maxDay))}
              </span>{' '}
              –{' '}
              <span className={styles.filterValue}>
                {dayIndexToIsoDate(Math.max(publishedMinDay ?? dateBounds.minDay, publishedMaxDay ?? dateBounds.maxDay))}
              </span>
            </div>
            <div className={styles.filterControls}>
              <RangeSlider
                min={dateBounds.minDay}
                max={dateBounds.maxDay}
                step={1}
                value={[
                  clamp(
                    Math.min(publishedMinDay ?? dateBounds.minDay, publishedMaxDay ?? dateBounds.maxDay),
                    dateBounds.minDay,
                    dateBounds.maxDay,
                  ),
                  clamp(
                    Math.max(publishedMinDay ?? dateBounds.minDay, publishedMaxDay ?? dateBounds.maxDay),
                    dateBounds.minDay,
                    dateBounds.maxDay,
                  ),
                ]}
                onValueChange={([min, max]) => {
                  setPublishedMinDay(min)
                  setPublishedMaxDay(max)
                }}
                thumbLabels={['Minimum published date', 'Maximum published date']}
              />
            </div>
          </div>
        </div>

        <div className={cn(util.muted, util.small)}>Tip: click a ticker or video node to inspect details.</div>
      </div>

      {errorInfo && <ErrorCallout message={errorInfo.message} requestId={errorInfo.requestId} />}
      {(dailyQuery.isLoading || infographicQuery.isLoading) && <LoadingLine label="Loading ticker…" />}

      {!errorInfo && !dailyQuery.isLoading && !infographicQuery.isLoading && filteredItems.length === 0 && (
        <EmptyState
          title="No videos match these filters"
          body="Try widening the date window or lowering the minimum ticker mentions."
        />
      )}

      <div className={ui.card}>
        <Suspense fallback={<LoadingLine label="Loading visualization…" />}>
          <VideoTickerInfographic
            items={filteredItems}
            days={days}
            enablePopout={false}
            showRangeLabel={false}
            selectedNodeId={selectedNodeId}
            onSelectTicker={(sym) => {
              setSelectedTicker(sym)
              setSelectedVideoId(null)

              const next = new URLSearchParams(params)
              next.set('symbol', sym)
              if (next.toString() !== params.toString()) setParams(next, { replace: true })
            }}
            onSelectVideo={(videoId) => {
              setSelectedVideoId(videoId)
              setSelectedTicker(null)

              const next = new URLSearchParams(params)
              next.delete('symbol')
              if (next.toString() !== params.toString()) setParams(next, { replace: true })
            }}
          />
        </Suspense>

        {(selectedTicker || selectedVideoId) && (
          <div className={styles.detailWrap} aria-live="polite">
            <div className={styles.detailHeader}>
              <div className={styles.detailTitle}>
                {selectedTicker ? `Ticker: ${selectedTicker}` : selectedVideoMeta?.title ? `Video: ${selectedVideoMeta.title}` : 'Selection'}
              </div>
              <button
                type="button"
                className={cn(ui.button, ui.ghost)}
                onClick={() => {
                  setSelectedTicker(null)
                  setSelectedVideoId(null)

                  const next = new URLSearchParams(params)
                  next.delete('symbol')
                  if (next.toString() !== params.toString()) setParams(next, { replace: true })
                }}
              >
                Clear
              </button>
            </div>

            {selectedTicker && (
              <>
                {entityChunksQuery.isLoading && <LoadingLine label={`Loading ${selectedTicker} keypoints…`} />}

                {!entityChunksQuery.isLoading && (
                  <>
                    <div className={cn(util.muted, util.small)}>
                      Showing latest keypoints mentioning {selectedTicker} (last {days} days).
                    </div>

                    {entityChunksQuery.data?.length ? (
                      <div className={styles.detailList}>
                        {groupEntityChunkRows(entityChunksQuery.data).map((g) => {
                          const row = g.row
                          const key = g.key
                          const title = row.videos?.title || row.videos?.video_id || 'Video'
                          const videoId = row.videos?.video_id ? String(row.videos.video_id) : null
                          const url =
                            (row.videos?.video_url ? safeExternalHref(row.videos.video_url) : null) ||
                            (row.videos?.video_id
                              ? `https://www.youtube.com/watch?v=${encodeURIComponent(String(row.videos.video_id))}`
                              : null)

                          const metaFromInfographic = videoId ? allItemsByVideoId.get(videoId) : null
                          const youtubeThumb = videoId
                            ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`
                            : null
                          const thumbnailUrl = metaFromInfographic?.thumbnail_url || youtubeThumb || null
                          const publishedAt = metaFromInfographic?.published_at || row.videos?.published_at || null
                          const publishedDay = toUtcDayIndex(publishedAt)
                          const publishedIso = publishedDay == null ? null : dayIndexToIsoDate(publishedDay)
                          const relativeToFilter =
                            publishedDay == null ? null : formatRelativeDayDelta(publishedDay - publishedRefDay)

                          const channel = metaFromInfographic?.channel || row.videos?.channel || null

                          const isInSelectedWindow =
                            publishedDay != null &&
                            publishedDay >= selectedPublishedWindow.minDay &&
                            publishedDay <= selectedPublishedWindow.maxDay

                          const sentiment: 'positive' | 'negative' | 'neutral' | undefined = (() => {
                            if (!selectedTicker) return undefined
                            if (!metaFromInfographic || !Array.isArray(metaFromInfographic.edges)) return undefined
                            const edge = metaFromInfographic.edges.find((e) => String(e.ticker).toUpperCase() === selectedTicker)
                            return edge?.sentiment
                          })()

                          const sentimentRowClass =
                            sentiment === 'positive'
                              ? styles.detailRowPositive
                              : sentiment === 'negative'
                                ? styles.detailRowNegative
                                : sentiment === 'neutral'
                                  ? styles.detailRowNeutral
                                  : null

                          const keypointSentimentByText = (() => {
                            const m = new Map<string, Sentiment>()
                            const edges = metaFromInfographic?.edges
                            if (!edges || !Array.isArray(edges)) return m

                            for (const e of edges) {
                              const s = e?.sentiment as Sentiment
                              if (!(s === 'positive' || s === 'negative' || s === 'neutral')) continue
                              for (const kp of e?.key_points || []) {
                                const norm = normalizeKeypointText(String(kp || ''))
                                if (!norm) continue
                                if (!m.has(norm)) m.set(norm, s)
                              }
                            }

                            return m
                          })()

                          const edgeChips = (() => {
                            const edges = metaFromInfographic?.edges
                            if (!edges || !Array.isArray(edges) || edges.length === 0) return [] as Array<{ ticker: string; sentiment: Sentiment }>
                            const normalized = edges
                              .map((e) => ({ ticker: String(e?.ticker || '').trim().toUpperCase(), sentiment: e?.sentiment as Sentiment }))
                              .filter((e) => e.ticker && (e.sentiment === 'positive' || e.sentiment === 'negative' || e.sentiment === 'neutral'))

                            // Put the selected ticker first, then alphabetical.
                            normalized.sort((a, b) => {
                              const aIsSel = selectedTicker && a.ticker === selectedTicker
                              const bIsSel = selectedTicker && b.ticker === selectedTicker
                              if (aIsSel && !bIsSel) return -1
                              if (!aIsSel && bIsSel) return 1
                              return a.ticker.localeCompare(b.ticker)
                            })

                            return normalized
                          })()

                          return (
                            <div
                              key={key}
                              className={cn(
                                styles.detailRow,
                                sentimentRowClass,
                              )}
                              title={
                                publishedIso
                                  ? `${publishedIso} • ${isInSelectedWindow ? 'In' : 'Outside'} selected window (${selectedPublishedWindow.label})`
                                  : `Publish date unknown • ${isInSelectedWindow ? 'In' : 'Outside'} selected window (${selectedPublishedWindow.label})`
                              }
                            >
                              <div className={styles.detailRowGrid}>
                                <div className={styles.detailThumbWrap}>
                                  {thumbnailUrl ? (
                                    url ? (
                                      <a
                                        className={styles.detailThumbLink}
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        aria-label={`Open ${title}`}
                                      >
                                        <img
                                          className={styles.detailThumb}
                                          src={safeExternalHref(thumbnailUrl)}
                                          alt=""
                                          loading="lazy"
                                        />
                                        <span className={styles.detailThumbPlay} aria-hidden="true" />
                                      </a>
                                    ) : (
                                      <img
                                        className={styles.detailThumb}
                                        src={safeExternalHref(thumbnailUrl)}
                                        alt=""
                                        loading="lazy"
                                      />
                                    )
                                  ) : (
                                    <div className={styles.detailThumbPlaceholder} aria-hidden="true" />
                                  )}
                                </div>

                                <div className={styles.detailRowMain}>
                                  <div className={styles.detailRowHeader}>
                                    <div className={styles.detailRowHeaderLeft}>
                                      {url ? (
                                        <a
                                          className={styles.detailRowTitle}
                                          href={url}
                                          target="_blank"
                                          rel="noreferrer noopener"
                                          title={title}
                                        >
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
                                      {edgeChips.length ? (
                                        <span className={styles.edgeChips} aria-label="Video tickers and sentiment">
                                          {edgeChips.slice(0, 6).map((e) => (
                                            <span
                                              key={`${key}-edge-${e.ticker}`}
                                              className={cn(styles.edgeChip, styles[`edgeChip_${e.sentiment}`], e.ticker === selectedTicker ? styles.edgeChipSelected : null)}
                                              title={`${e.ticker}: ${e.sentiment}`}
                                            >
                                              {e.ticker}
                                            </span>
                                          ))}
                                          {edgeChips.length > 6 ? (
                                            <span className={cn(styles.edgeChip, styles.edgeChipMore)} title="More tickers in this video">
                                              +{edgeChips.length - 6}
                                            </span>
                                          ) : null}
                                        </span>
                                      ) : null}
                                      {relativeToFilter ? (
                                        <span className={cn(ui.chip, styles.detailBadge)} title="Relative to the end of the selected date window">
                                          {relativeToFilter}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className={styles.detailKeypointWrap}>
                                    <div className={styles.detailKeypointContent}>
                                      <ul className={styles.detailKeypointsList} aria-label="Keypoints">
                                        {g.keypoints.map((kp, i) => {
                                          const text = String(kp?.text || '').trim()
                                          const kpSent = kp?.sentiment || 'neutral'
                                          return (
                                          <li key={`${key}-kp-${i}`} className={styles.detailKeypointsItem}>
                                            <span
                                              className={cn(
                                                styles.keypointDot,
                                                styles[`keypointDot_${kpSent}`],
                                              )}
                                              title={`Sentiment: ${kpSent}`}
                                            />
                                            <span className={cn(styles.keypointText, styles[`keypointText_${kpSent}`])}>{text}</span>
                                          </li>
                                          )
                                        })}
                                      </ul>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className={cn(util.muted, util.small)}>No keypoints found for {selectedTicker} in this window.</div>
                    )}
                  </>
                )}
              </>
            )}

            {selectedVideoId && (
              <>
                {videoDetailQuery.isLoading && <LoadingLine label="Loading video insight…" />}

                {!videoDetailQuery.isLoading && videoDetailQuery.data?.summary && (
                  <>
                    {(() => {
                      const summary = videoDetailQuery.data.summary
                      const meta = selectedVideoInfographic || selectedVideoMeta
                      const videoId = selectedVideoId

                      const title = meta?.title || (summary as any)?.title || `Video ${videoId}`
                      const channel = meta?.channel || (selectedVideoMeta as any)?.channel || null
                      const publishedDay = toUtcDayIndex(meta?.published_at)
                      const publishedIso = publishedDay == null ? null : dayIndexToIsoDate(publishedDay)
                      const watchUrl = meta?.video_url
                        ? safeExternalHref(meta.video_url)
                        : videoId
                          ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
                          : null
                      const youtubeThumb = videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : null
                      const thumbnailUrl = meta?.thumbnail_url || youtubeThumb || null

                      const overall = toEdgeSentiment(summary.sentiment)
                      const overallRowClass =
                        overall === 'positive'
                          ? styles.detailRowPositive
                          : overall === 'negative'
                            ? styles.detailRowNegative
                            : overall === 'neutral'
                              ? styles.detailRowNeutral
                              : null

                      const edges = meta?.edges
                      const keypointIndex = buildKeypointSentimentIndex(edges)

                      const tickerSet = new Set<string>()
                      for (const t of summary.tickers || []) tickerSet.add(String(t || '').trim().toUpperCase())
                      for (const mv of summary.movers || []) tickerSet.add(String(mv?.symbol || '').trim().toUpperCase())
                      for (const td of videoDetailQuery.data?.ticker_details || []) tickerSet.add(String(td?.ticker || '').trim().toUpperCase())
                      tickerSet.delete('')

                      const tickers = Array.from(tickerSet.values()).sort((a, b) => a.localeCompare(b))

                      const tickerEdges = (edges || [])
                        .map((e) => ({ ticker: String(e?.ticker || '').trim().toUpperCase(), sentiment: e?.sentiment }))
                        .filter((e) => e.ticker && (e.sentiment === 'positive' || e.sentiment === 'negative' || e.sentiment === 'neutral'))

                      const sentimentForTicker = (sym: string): Sentiment => {
                        const hit = tickerEdges.find((e) => e.ticker === sym)
                        return (hit?.sentiment as Sentiment) || overall || 'neutral'
                      }

                      return (
                        <div className={styles.videoDetailWrap} aria-label="Video summary">
                          <div className={cn(styles.detailRow, overallRowClass)}>
                            <div className={styles.detailRowGrid}>
                              <div className={styles.detailThumbWrap}>
                                {thumbnailUrl ? (
                                  watchUrl ? (
                                    <a
                                      className={styles.detailThumbLink}
                                      href={watchUrl}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      aria-label={`Open ${title}`}
                                    >
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
                                      <a
                                        className={styles.detailRowTitle}
                                        href={watchUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        title={title}
                                      >
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
                                            if (!watchUrl) return
                                            void copyHref(watchUrl)
                                          }}
                                          title="Copy the video URL"
                                        >
                                          {copiedHref === watchUrl ? 'Copied' : 'Copy link'}
                                        </button>
                                      ) : null}
                                      <Link className={cn(ui.button, ui.ghost)} to={`/videos?days=${encodeURIComponent(String(days))}`}>
                                        Videos
                                      </Link>
                                    </div>
                                  </div>
                                </div>

                                <div className={styles.videoMetaGrid}>
                                  <div className={styles.videoMetaBlock}>
                                    <div className={styles.videoMetaLabel}>Summary sentiment</div>
                                    <div className={styles.videoMetaValue}>{summary.sentiment || '—'}</div>
                                  </div>
                                  <div className={styles.videoMetaBlock}>
                                    <div className={styles.videoMetaLabel}>Published</div>
                                    <div className={styles.videoMetaValue}>{formatIsoDateTime(summary.published_at || meta?.published_at)}</div>
                                  </div>
                                  <div className={styles.videoMetaBlock}>
                                    <div className={styles.videoMetaLabel}>Model</div>
                                    <div className={styles.videoMetaValue}>{summary.model || '—'}</div>
                                  </div>
                                  <div className={styles.videoMetaBlock}>
                                    <div className={styles.videoMetaLabel}>Summarized</div>
                                    <div className={styles.videoMetaValue}>{formatIsoDateTime(summary.summarized_at)}</div>
                                  </div>
                                </div>
                                {summary.overall_explanation?.trim() ? (
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
                                        <Link
                                          key={`${videoId}-t-${sym}`}
                                          to={`/ticker?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(String(days))}`}
                                          className={cn(styles.edgeChip, styles[`edgeChip_${sentimentForTicker(sym)}`])}
                                          title={`${sym}: ${sentimentForTicker(sym)}`}
                                          onClick={() => {
                                            setSelectedTicker(sym)
                                            setSelectedVideoId(null)
                                          }}
                                        >
                                          {sym}
                                        </Link>
                                      ))}
                                      {tickers.length > 14 ? <span className={cn(styles.edgeChip, styles.edgeChipMore)}>+{tickers.length - 14}</span> : null}
                                    </div>
                                  </div>
                                ) : null}

                                {summary.key_points?.length ? (
                                  <div className={styles.videoSection}>
                                    <div className={styles.videoSectionTitle}>Key points</div>
                                    <ul className={styles.detailKeypointsList} aria-label="Summary key points">
                                      {summary.key_points.slice(0, 10).map((kp, i) => {
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
                                  {summary.movers?.length ? (
                                    <div className={styles.videoSection}>
                                      <div className={styles.videoSectionTitle}>Top movers</div>
                                      <div className={styles.videoMoverList} aria-label="Movers">
                                        {summary.movers.slice(0, 12).map((mv, i) => {
                                          const sym = String(mv?.symbol || '').trim().toUpperCase() || '—'
                                          const dir = String(mv?.direction || 'mixed') as 'up' | 'down' | 'mixed'
                                          const dirClass = dir === 'up' ? styles.moverChipUp : dir === 'down' ? styles.moverChipDown : styles.moverChipMixed
                                          return (
                                            <Link
                                              key={`${videoId}-mv-${sym}-${i}`}
                                              to={`/ticker?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(String(days))}`}
                                              className={cn(styles.moverChip, dirClass)}
                                              title={mv?.reason || ''}
                                            >
                                              {sym}
                                            </Link>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  ) : null}

                                  {summary.events?.length ? (
                                    <div className={styles.videoSection}>
                                      <div className={styles.videoSectionTitle}>Events</div>
                                      <div className={styles.videoEvents}>
                                        {summary.events.slice(0, 6).map((ev, i) => (
                                          <div key={`${videoId}-ev-${i}`} className={styles.videoEventRow}>
                                            {(() => {
                                              const whenParts: string[] = []
                                              if (ev?.date) whenParts.push(String(ev.date))
                                              if (ev?.timeframe) whenParts.push(String(ev.timeframe))
                                              const when = whenParts.join(' • ')
                                              return when ? <div className={styles.videoEventWhen}>{when}</div> : null
                                            })()}
                                            <div className={styles.videoEventWhat}>{String(ev?.description || '').trim() || '—'}</div>
                                            {ev?.tickers?.length ? (
                                              <div className={styles.videoEventTickers}>
                                                {ev.tickers.slice(0, 6).map((t) => {
                                                  const sym = String(t || '').trim().toUpperCase()
                                                  if (!sym) return null
                                                  return (
                                                    <Link
                                                      key={`${videoId}-ev-${i}-${sym}`}
                                                      to={`/ticker?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(String(days))}`}
                                                      className={cn(styles.edgeChip, styles[`edgeChip_${sentimentForTicker(sym)}`])}
                                                    >
                                                      {sym}
                                                    </Link>
                                                  )
                                                })}
                                              </div>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>

                                {(summary.opportunities?.length || summary.risks?.length) ? (
                                  <div className={styles.videoTwoCol}>
                                    {summary.opportunities?.length ? (
                                      <div className={styles.videoSection}>
                                        <div className={styles.videoSectionTitle}>Opportunities</div>
                                        <ul className={styles.videoBullets}>
                                          {summary.opportunities.slice(0, 8).map((t, i) => (
                                            <li key={`${videoId}-opp-${i}`}>{t}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : null}
                                    {summary.risks?.length ? (
                                      <div className={styles.videoSection}>
                                        <div className={styles.videoSectionTitle}>Risks</div>
                                        <ul className={styles.videoBullets}>
                                          {summary.risks.slice(0, 8).map((t, i) => (
                                            <li key={`${videoId}-risk-${i}`}>{t}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}

                                {summary.summary_markdown ? (
                                  <div className={styles.videoSection}>
                                    <div className={styles.videoSectionTitle}>Summary</div>
                                    <Markdown markdown={summary.summary_markdown} />
                                  </div>
                                ) : null}

                                {videoDetailQuery.data?.ticker_details?.length ? (
                                  <div className={styles.videoSection}>
                                    <div className={styles.videoSectionTitle}>Ticker details</div>
                                    <div className={styles.videoEvents}>
                                      {videoDetailQuery.data.ticker_details.slice(0, 25).map((td, i) => {
                                        const sym = String(td?.ticker || '').trim().toUpperCase()
                                        if (!sym) return null
                                        const s = toEdgeSentiment(td?.sentiment) || 'neutral'
                                        const md = formatTickerSummaryMarkdown(td?.summary)

                                        return (
                                          <div key={`${videoId}-td-${sym}-${i}`} className={styles.videoEventRow}>
                                            <div className={styles.videoEventWhen}>
                                              <Link
                                                to={`/ticker?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(String(days))}`}
                                                className={cn(styles.edgeChip, styles[`edgeChip_${s}`])}
                                              >
                                                {sym}
                                              </Link>
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
                    })()}
                  </>
                )}

                {!videoDetailQuery.isLoading && !videoDetailQuery.data?.summary && (
                  <div className={cn(util.muted, util.small)}>No stored insight found for this video yet.</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
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
