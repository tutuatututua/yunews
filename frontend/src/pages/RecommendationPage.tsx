import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RecommendationDashboard, {
  type DashboardEventRow,
  type DashboardRecommendationGroup,
  type DashboardTickerItem,
} from '../components/features/recommendations/RecommendationDashboard'
import { getUiErrorInfo } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import { safeExternalHref } from '../lib/safeUrl'
import { resolveTimeShiftMinutes, resolveTimeZoneForIntl, useTimeZone } from '../app/timeZone'
import { useRecommendationOverlay, useRecommendationsList } from '../features/recommendations/queries'
import type { RecommendationEvent } from '../types'

type RecommendationGroup = {
  symbol: string
  count: number
  latestPublishedAt: string | null
  latestTitle: string | null
  positiveKeypoints: string[]
  videos: RecommendationEvent[]
  avgNowPct: number | null
  avg7dPct: number | null
  avg30dPct: number | null
}

function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || '').trim())}`
}

const WINDOW_DAYS: Record<'1y' | '6m' | '3m' | '1m', number> = {
  '1y': 365,
  '6m': 183,
  '3m': 92,
  '1m': 31,
}

function avgFinite(values: Array<number | null | undefined>): number | null {
  let sum = 0
  let n = 0
  for (const v of values) {
    if (v == null) continue
    const x = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(x)) continue
    sum += x
    n++
  }
  if (n <= 0) return null
  return sum / n
}

function normalizeSymbol(x: unknown): string | null {
  const sym = String(x || '').trim().toUpperCase()
  return sym || null
}

function isValidDateInput(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function groupRecommendationEvents(events: RecommendationEvent[] | undefined): RecommendationGroup[] {
  const bySymbol = new Map<string, RecommendationGroup>()

  for (const event of events || []) {
    const symbol = normalizeSymbol(event?.ticker)
    if (!symbol) continue

    const existing =
      bySymbol.get(symbol) ||
      ({
        symbol,
        count: 0,
        latestPublishedAt: null,
        latestTitle: null,
        positiveKeypoints: [],
        videos: [],
        avgNowPct: null,
        avg7dPct: null,
        avg30dPct: null,
      } satisfies RecommendationGroup)

    existing.count += 1
    existing.videos.push(event)

    for (const rawKeypoint of event?.positive_keypoints || []) {
      const keypoint = String(rawKeypoint || '').trim()
      if (!keypoint) continue
      if (existing.positiveKeypoints.includes(keypoint)) continue
      existing.positiveKeypoints.push(keypoint)
    }

    const publishedAt = isValidDateInput(event?.published_at) ? event.published_at : null
    const latestMs = existing.latestPublishedAt ? Date.parse(existing.latestPublishedAt) : Number.NaN
    const nextMs = publishedAt ? Date.parse(publishedAt) : Number.NaN
    if (publishedAt && (!Number.isFinite(latestMs) || nextMs > latestMs)) {
      existing.latestPublishedAt = publishedAt
      existing.latestTitle = String(event?.title || '').trim() || null
    }

    bySymbol.set(symbol, existing)
  }

  const groups = Array.from(bySymbol.values()).map((group) => ({
    ...group,
    avgNowPct: avgFinite(group.videos.map((video) => video?.return_pct ?? null)),
    avg7dPct: avgFinite(group.videos.map((video) => video?.return_7d_pct ?? null)),
    avg30dPct: avgFinite(group.videos.map((video) => video?.return_30d_pct ?? null)),
  }))

  return groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    const aMs = a.latestPublishedAt ? Date.parse(a.latestPublishedAt) : Number.NaN
    const bMs = b.latestPublishedAt ? Date.parse(b.latestPublishedAt) : Number.NaN
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && bMs !== aMs) return bMs - aMs
    return a.symbol.localeCompare(b.symbol)
  })
}

export default function RecommendationPage() {
  const { timeZone, timeShiftMinutes } = useTimeZone()
  const intlTimeZone = resolveTimeZoneForIntl(timeZone)
  const effectiveShiftMinutes = resolveTimeShiftMinutes(timeZone, timeShiftMinutes)

  const [params, setParams] = useSearchParams()
  const [tickerSearch, setTickerSearch] = useState('')
  const [windowKey, setWindowKey] = useState<'1y' | '6m' | '3m' | '1m'>('1m')
  const deferredTickerSearch = useDeferredValue(tickerSearch)

  const windowDays = WINDOW_DAYS[windowKey]

  const selectedSymbol = useMemo(() => {
    return normalizeSymbol(params.get('symbol'))
  }, [params])

  const listQuery = useRecommendationsList({ days: 365, limit: 600 })
  const recentQuery = useRecommendationsList({ days: 3, limit: 200 })

  const tickerQuery = String(deferredTickerSearch || '').trim().toUpperCase()
  const hasTickerQuery = tickerQuery.length > 0

  const tickers = useMemo(() => {
    const counts = new Map<string, number>()
    for (const ev of listQuery.data || []) {
      const sym = normalizeSymbol(ev?.ticker)
      if (!sym) continue
      counts.set(sym, (counts.get(sym) || 0) + 1)
    }

    const items = Array.from(counts.entries()).map(([symbol, count]) => ({ symbol, count }))
    items.sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol))
    return items
  }, [listQuery.data])

  const recentTickerSet = useMemo(() => new Set(recentQuery.data?.map((event) => normalizeSymbol(event?.ticker)).filter(Boolean) as string[]), [recentQuery.data])

  const shownTickers = useMemo(() => {
    return tickers.filter((ticker) => {
      return !hasTickerQuery || ticker.symbol.includes(tickerQuery)
    })
  }, [hasTickerQuery, tickers, tickerQuery])

  const recentGroups = useMemo(() => groupRecommendationEvents(recentQuery.data), [recentQuery.data])
  const recentSelectedGroup = useMemo(
    () => recentGroups.find((group) => group.symbol === selectedSymbol) || null,
    [recentGroups, selectedSymbol],
  )

  useEffect(() => {
    if (selectedSymbol) return
    const defaultSymbol = recentGroups[0]?.symbol || tickers[0]?.symbol
    if (!defaultSymbol) return

    const next = new URLSearchParams(params)
    next.set('symbol', defaultSymbol)
    setParams(next, { replace: true })
  }, [params, recentGroups, selectedSymbol, setParams, tickers])

  const overlayQuery = useRecommendationOverlay(selectedSymbol, { days: windowDays }, !!selectedSymbol)
  const overlay = overlayQuery.data || null

  const avgNowPct = useMemo(() => {
    if (!overlay) return null
    return avgFinite((overlay.events || []).map((e) => e?.return_pct ?? null))
  }, [overlay])

  const avg7dPct = useMemo(() => {
    if (!overlay) return null
    return avgFinite((overlay.events || []).map((e) => e?.return_7d_pct ?? null))
  }, [overlay])

  const avg30dPct = useMemo(() => {
    if (!overlay) return null
    return avgFinite((overlay.events || []).map((e) => e?.return_30d_pct ?? null))
  }, [overlay])

  const selectedLatestPublished = recentSelectedGroup?.latestPublishedAt
    ? formatDateTime(recentSelectedGroup.latestPublishedAt, {
        timeZone: intlTimeZone,
        shiftMinutes: effectiveShiftMinutes,
      })
    : null

  const errorInfo =
    getUiErrorInfo(recentQuery.error) || getUiErrorInfo(listQuery.error) || getUiErrorInfo(overlayQuery.error) || null

  const totalRecentMentions = recentQuery.data?.length || 0

  const dashboardGroups = useMemo<DashboardRecommendationGroup[]>(
    () =>
      recentGroups.map((group) => ({
        symbol: group.symbol,
        count: group.count,
        latestPublishedAtLabel: group.latestPublishedAt
          ? formatDateTime(group.latestPublishedAt, {
              timeZone: intlTimeZone,
              shiftMinutes: effectiveShiftMinutes,
            })
          : null,
        latestTitle: group.latestTitle,
        reasonTags: group.positiveKeypoints,
        avgNowPct: group.avgNowPct,
        avg7dPct: group.avg7dPct,
        avg30dPct: group.avg30dPct,
      })),
    [effectiveShiftMinutes, intlTimeZone, recentGroups],
  )

  const dashboardTickers = useMemo<DashboardTickerItem[]>(
    () =>
      shownTickers.map((ticker) => ({
        symbol: ticker.symbol,
        count: ticker.count,
        isRecent: recentTickerSet.has(ticker.symbol),
      })),
    [recentTickerSet, shownTickers],
  )

  const featuredTickers = useMemo(
    () => dashboardTickers.filter((ticker) => ticker.isRecent),
    [dashboardTickers],
  )

  const historyTickers = useMemo(
    () => dashboardTickers.filter((ticker) => !ticker.isRecent),
    [dashboardTickers],
  )

  const eventRows = useMemo<DashboardEventRow[]>(() => {
    if (!overlay?.events?.length) return []

    return overlay.events.slice(0, 50).map((event) => {
      const title = String(event?.title || 'Video').trim()
      const channel = event?.channel ? String(event.channel).trim() : null
      const published = event?.published_at
        ? formatDateTime(String(event.published_at), {
            timeZone: intlTimeZone,
            shiftMinutes: effectiveShiftMinutes,
          })
        : null

      const url = event?.video_url
        ? safeExternalHref(event.video_url)
        : event?.video_id
          ? buildYouTubeWatchUrl(event.video_id)
          : null

      const thumbUrlRaw = event?.thumbnail_url ? safeExternalHref(event.thumbnail_url) : null
      const thumbUrl = thumbUrlRaw && thumbUrlRaw !== '#' ? thumbUrlRaw : null
      const safeVideoUrl = url && url !== '#' ? url : null

      return {
        id: `${event.video_id}:${event.ticker}`,
        title,
        subtitle: [channel, published].filter(Boolean).join(' • ') || null,
        url: safeVideoUrl,
        thumbUrl,
        nowPct: event?.return_pct ?? null,
        day7Pct: event?.return_7d_pct ?? null,
        day30Pct: event?.return_30d_pct ?? null,
        keyPoints: Array.isArray(event?.positive_keypoints) ? event.positive_keypoints.slice(0, 3) : [],
      }
    })
  }, [effectiveShiftMinutes, intlTimeZone, overlay?.events])

  return (
    <RecommendationDashboard
      errorMessage={errorInfo?.message || null}
      errorRequestId={errorInfo?.requestId || null}
      recentLoading={recentQuery.isLoading}
      tickersLoading={listQuery.isLoading}
      recentGroups={dashboardGroups}
      totalTickerCount={tickers.length}
      totalRecentMentions={totalRecentMentions}
      selectedSymbol={selectedSymbol}
      selectedRecentCount={recentSelectedGroup?.count || null}
      selectedLatestPublished={selectedLatestPublished}
      tickerSearch={tickerSearch}
      onTickerSearchChange={setTickerSearch}
      featuredTickers={featuredTickers}
      historyTickers={historyTickers}
      hasTickerQuery={hasTickerQuery}
      windowKey={windowKey}
      onWindowChange={setWindowKey}
      onSelectSymbol={(symbol) => {
        const next = new URLSearchParams(params)
        next.set('symbol', symbol)
        setParams(next, { replace: true })
      }}
      overlayLoading={overlayQuery.isLoading}
      overlay={overlay}
      avgNowPct={avgNowPct}
      avg7dPct={avg7dPct}
      avg30dPct={avg30dPct}
      eventRows={eventRows}
    />
  )
}
