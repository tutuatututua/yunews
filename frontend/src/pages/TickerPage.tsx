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
import { ui, util } from '../styles'
import styles from './TickerPage.module.css'

const VideoTickerInfographic = React.lazy(() => import('../components/features/VideoTickerInfographic'))

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

export default function TickerPage() {
  const [params, setParams] = useSearchParams()
  const days = useMemo(() => parseDays(params.get('days'), 7), [params])

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

  const [publishedMinDay, setPublishedMinDay] = useState<number | null>(null)
  const [publishedMaxDay, setPublishedMaxDay] = useState<number | null>(null)
  const [mentionsMin, setMentionsMin] = useState(0)
  const [mentionsMax, setMentionsMax] = useState(0)

  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)

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

  useEffect(() => {
    setPublishedMinDay((prev) => {
      const next = prev == null ? dateBounds.minDay : clamp(prev, dateBounds.minDay, dateBounds.maxDay)
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

  useEffect(() => {
    // Initialize / clamp mention range based on data (after date filtering).
    setMentionsMin((prev) => {
      const seed = prev === 0 ? mentionMinBound : prev
      return clamp(seed, mentionMinBound, maxMentionsObserved)
    })
    setMentionsMax((prev) => {
      if (prev === 0) return maxMentionsObserved
      return clamp(prev, mentionMinBound, maxMentionsObserved)
    })
  }, [maxMentionsObserved, mentionMinBound])

  const filteredItems = useMemo(() => {
    const minMentions = Math.min(mentionsMin, mentionsMax)
    const maxMentions = Math.max(mentionsMin, mentionsMax)

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
  }, [dateFilteredItems, mentionCounts, mentionsMin, mentionsMax])

  const errorInfo = getUiErrorInfo(dailyQuery.error) || getUiErrorInfo(infographicQuery.error)

  const entityChunksQuery = useEntityChunks(selectedTicker, { days, limit: 120 }, !!selectedTicker)
  const videoDetailQuery = useVideoDetail(selectedVideoId)

  const selectedVideoMeta = useMemo(() => {
    if (!selectedVideoId) return null
    const v = filteredItems.find((x) => x.video_id === selectedVideoId)
    return v || null
  }, [filteredItems, selectedVideoId])

  const selectedNodeId = selectedVideoId || selectedTicker

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h2>Ticker</h2>
          <div className={cn(util.muted, util.small)}>{anchorDate ? `Anchored to ${anchorDate}` : 'Latest'}</div>
        </div>
        <div className={styles.headerRight}>
          <label className={styles.headerField}>
            <span className={styles.headerLabel}>Window</span>
            <select className={styles.headerSelect} value={String(days)} onChange={onChangeDays} aria-label="Select day window">
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </label>
          <Link className={cn(ui.button, ui.ghost)} to={`/` + (days ? `?days=${encodeURIComponent(String(days))}` : '')}>
            Back
          </Link>
        </div>
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
              setPublishedMinDay(dateBounds.minDay)
              setPublishedMaxDay(dateBounds.maxDay)
              setMentionsMin(mentionMinBound)
              setMentionsMax(maxMentionsObserved)
            }}
          >
            Reset
          </button>
        </div>

        <div className={styles.filtersGrid}>
          <div className={styles.filterRow}>
            <div className={styles.filterLabel}>
              Ticker mentions: <span className={styles.filterValue}>{Math.min(mentionsMin, mentionsMax)}</span> –{' '}
              <span className={styles.filterValue}>{Math.max(mentionsMin, mentionsMax)}</span>
            </div>
            <div className={styles.filterControls}>
              <RangeSlider
                min={mentionMinBound}
                max={Math.max(mentionMinBound, maxMentionsObserved)}
                step={1}
                value={[
                  clamp(
                    Math.min(mentionsMin, mentionsMax),
                    mentionMinBound,
                    Math.max(mentionMinBound, maxMentionsObserved),
                  ),
                  clamp(
                    Math.max(mentionsMin, mentionsMax),
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
                        {entityChunksQuery.data.map((row) => {
                          const title = row.videos?.title || row.videos?.video_id || 'Video'
                          const videoId = row.videos?.video_id ? String(row.videos.video_id) : null
                          const url =
                            (row.videos?.video_url ? safeExternalHref(row.videos.video_url) : null) ||
                            (row.videos?.video_id
                              ? `https://www.youtube.com/watch?v=${encodeURIComponent(String(row.videos.video_id))}`
                              : null)

                          const metaFromInfographic = videoId ? filteredItems.find((v) => v.video_id === videoId) : null
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

                          return (
                            <div key={row.chunk_id} className={styles.detailRow}>
                              <div className={styles.detailRowGrid}>
                                <div className={styles.detailThumbWrap}>
                                  {thumbnailUrl ? (
                                    url ? (
                                      <a href={url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${title}`}>
                                        <img
                                          className={styles.detailThumb}
                                          src={safeExternalHref(thumbnailUrl)}
                                          alt=""
                                          loading="lazy"
                                        />
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
                                  <div className={styles.detailKeypoint}>{row.keypoint || '—'}</div>

                                  <div className={cn(util.muted, util.small, styles.detailRowMeta)}>
                                    <span>
                                      Resource:{' '}
                                      {url ? (
                                        <a href={url} target="_blank" rel="noreferrer noopener">
                                          {title}
                                        </a>
                                      ) : (
                                        <span>{title}</span>
                                      )}
                                    </span>
                                    {publishedIso ? <span>Published: {publishedIso}</span> : <span>Published: —</span>}
                                    {relativeToFilter ? <span>({relativeToFilter} vs filter end)</span> : null}
                                    {channel ? <span>Channel: {channel}</span> : null}
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
                    <div className={styles.detailActions}>
                      {selectedVideoMeta?.video_url ? (
                        <a
                          className={cn(ui.button, ui.ghost)}
                          href={safeExternalHref(selectedVideoMeta.video_url)}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Watch
                        </a>
                      ) : null}
                      <Link className={cn(ui.button, ui.ghost)} to={`/videos?days=${encodeURIComponent(String(days))}`}>
                        Open videos page
                      </Link>
                    </div>

                    <div className={cn(util.muted, util.small)}>
                      Sentiment: {videoDetailQuery.data.summary.sentiment || '—'} • Tickers:{' '}
                      {videoDetailQuery.data.summary.tickers?.length ? videoDetailQuery.data.summary.tickers.join(', ') : '—'}
                    </div>

                    {videoDetailQuery.data.summary.key_points?.length ? (
                      <ul className={styles.detailBullets}>
                        {videoDetailQuery.data.summary.key_points.slice(0, 8).map((kp, i) => (
                          <li key={`${i}-${kp}`}>{kp}</li>
                        ))}
                      </ul>
                    ) : null}

                    <Markdown markdown={videoDetailQuery.data.summary.summary_markdown} />
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
