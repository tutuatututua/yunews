import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Markdown from '../components/Markdown'
import VideoDetailPanel from '../components/video/VideoDetailPanel'
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

type PerTickerStat = { mentions: number; positive: number; negative: number; neutral: number }
type PerVideoTickerStats = Map<string, Map<string, PerTickerStat>>

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

function buildTickerHref(symbol: string, days: number): string {
  const sym = String(symbol || '').trim().toUpperCase()
  return `/ticker?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(String(days))}`
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

function buildInfographicEdgeChips(
  edges: any[] | null | undefined,
  perTickerStats: Map<string, PerTickerStat> | null | undefined,
): Array<{ ticker: string; sentiment: Sentiment }> {
  if (!edges || !Array.isArray(edges) || edges.length === 0) return []

  const pickSentiment = (sym: string): Sentiment => {
    const stat = perTickerStats?.get(sym)
    if (!stat) return 'neutral'
    if (stat.positive === stat.negative) return 'neutral'
    return stat.positive > stat.negative ? 'positive' : 'negative'
  }

  const uniqueTickers = new Set<string>()
  for (const e of edges) {
    const sym = String(e?.ticker || '').trim().toUpperCase()
    if (sym) uniqueTickers.add(sym)
  }

  const normalized = Array.from(uniqueTickers.values()).map((sym) => ({
    ticker: sym,
    sentiment: pickSentiment(sym),
    mentions: perTickerStats?.get(sym)?.mentions || 0,
  }))

  normalized.sort((a, b) => b.mentions - a.mentions || a.ticker.localeCompare(b.ticker))

  return normalized.map(({ ticker, sentiment }) => ({ ticker, sentiment }))
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

  const perVideoTickerStats = useMemo(() => {
    type Sent = 'positive' | 'negative' | 'neutral'
    const byVideo: PerVideoTickerStats = new Map()
    for (const [videoId, v] of allItemsByVideoId.entries()) {
      const perTicker = new Map<string, PerTickerStat>()
      for (const e of v?.edges || []) {
        const sym = String(e?.ticker || '').trim().toUpperCase()
        if (!sym) continue
        const s = String(e?.sentiment || 'neutral').trim().toLowerCase() as Sent

        const rawKeyPoints = (e as any)?.key_points
        const w = Math.max(1, Array.isArray(rawKeyPoints) ? rawKeyPoints.length : 0)

        const stat = perTicker.get(sym) || { mentions: 0, positive: 0, negative: 0, neutral: 0 }
        stat.mentions += w
        if (s === 'positive') stat.positive += w
        else if (s === 'negative') stat.negative += w
        else stat.neutral += w
        perTicker.set(sym, stat)
      }
      byVideo.set(videoId, perTicker)
    }
    return byVideo
  }, [allItemsByVideoId])

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
      return { minDay: today, maxDay: today, hasReal: false }
    }

    return { minDay: min, maxDay: max, hasReal: true }
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
    // Avoid seeding defaults from fallback bounds while data is still loading.
    if (!dateBounds.hasReal) return
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
  }, [dateBounds.minDay, dateBounds.maxDay, dateBounds.hasReal])

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
    if (infographicQuery.isLoading) return
    setMentionsMin((prev) => {
      const seed = prev == null ? mentionDefaultMin : prev
      return clamp(seed, mentionMinBound, maxMentionsObserved)
    })
    setMentionsMax((prev) => {
      if (prev == null) return maxMentionsObserved
      return clamp(prev, mentionMinBound, maxMentionsObserved)
    })
  }, [infographicQuery.isLoading, maxMentionsObserved, mentionMinBound, mentionDefaultMin])

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
    if (infographicQuery.isLoading) return
    if (!dateBounds.hasReal) return
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
    infographicQuery.isLoading,
    publishedMinDay,
    publishedMaxDay,
    mentionsMin,
    mentionsMax,
    mentionDefaultMin,
    maxMentionsObserved,
    dateBounds.minDay,
    dateBounds.maxDay,
    dateBounds.hasReal,
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
          <div className={cn(util.muted, util.small)}>Explore ticker sentiment across videos.</div>
        </div>

        <div className={styles.headerRight}>
          <span
            className={cn(ui.chip, styles.marketChip)}
            title="Market date used to anchor the analysis window"
          >
            {anchorDate ? `Market: ${anchorDate}` : 'Market: Latest'}
          </span>

          <label className={styles.headerField}>
            <span className={styles.headerLabel}>Window</span>
            <select className={styles.headerSelect} value={String(days)} onChange={onChangeDays} aria-label="Select day window">
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </label>
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
                            (videoId ? buildYouTubeWatchUrl(videoId) : null)

                          const metaFromInfographic = videoId ? allItemsByVideoId.get(videoId) : null
                          const youtubeThumb = videoId ? buildYouTubeThumbUrl(videoId) : null
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

                          let sentiment: Sentiment | null | undefined = undefined
                          if (selectedTicker && metaFromInfographic?.edges && Array.isArray(metaFromInfographic.edges)) {
                            const edge = metaFromInfographic.edges.find((e) => String(e?.ticker || '').toUpperCase() === selectedTicker)
                            sentiment = toEdgeSentiment(edge?.sentiment)
                          }

                          const rowClass = getSentimentRowClass(sentiment)

                          const perTickerStats = videoId ? perVideoTickerStats.get(videoId) : null
                          const edgeChips = buildInfographicEdgeChips(metaFromInfographic?.edges, perTickerStats)

                          return (
                            <div
                              key={key}
                              className={cn(
                                styles.detailRow,
                                rowClass,
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
                  <VideoDetailPanel
                    videoId={selectedVideoId}
                    days={days}
                    summary={videoDetailQuery.data.summary}
                    meta={selectedVideoInfographic || selectedVideoMeta}
                    tickerDetails={videoDetailQuery.data?.ticker_details}
                    copiedHref={copiedHref}
                    copyHref={copyHref}
                    getMentionCount={(sym) => {
                      const per = perVideoTickerStats.get(selectedVideoId)
                      return per?.get(sym)?.mentions || 0
                    }}
                    onSelectTicker={(sym) => {
                      setSelectedTicker(sym)
                      setSelectedVideoId(null)
                    }}
                  />
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
