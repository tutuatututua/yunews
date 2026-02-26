import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RecommendationOverlayChart from '../components/features/RecommendationOverlayChart'
import { ErrorCallout, EmptyState } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { cn } from '../lib/cn'
import { getUiErrorInfo } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import { safeExternalHref } from '../lib/safeUrl'
import { resolveTimeShiftMinutes, resolveTimeZoneForIntl, useTimeZone } from '../app/timeZone'
import { useRecommendationOverlay, useRecommendationsList } from '../services/queries'
import type { RecommendationEvent } from '../types'
import { ui, util } from '../styles'
import styles from './RecommendationPage.module.css'

function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || '').trim())}`
}

function fmtPct(x: unknown): string {
  const n = typeof x === 'number' ? x : Number(x)
  if (!Number.isFinite(n)) return '—'
  const s = (n * 100).toFixed(Math.abs(n) < 0.1 ? 1 : 0)
  return `${s}%`
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

export default function RecommendationPage() {
  const { timeZone, timeShiftMinutes } = useTimeZone()
  const intlTimeZone = resolveTimeZoneForIntl(timeZone)
  const effectiveShiftMinutes = resolveTimeShiftMinutes(timeZone, timeShiftMinutes)

  const [params, setParams] = useSearchParams()
  const [tickerSearch, setTickerSearch] = useState('')
  const [windowKey, setWindowKey] = useState<'1y' | '6m' | '3m' | '1m'>('1y')

  const windowDays = useMemo(() => {
    switch (windowKey) {
      case '6m':
        return 183
      case '3m':
        return 92
      case '1m':
        return 31
      case '1y':
      default:
        return 365
    }
  }, [windowKey])

  const selectedSymbol = useMemo(() => {
    const raw = params.get('symbol')
    const sym = String(raw || '').trim().toUpperCase()
    return sym || null
  }, [params])

  const listQuery = useRecommendationsList({ days: 365, limit: 600 })

  const tickers = useMemo(() => {
    const counts = new Map<string, number>()
    for (const ev of listQuery.data || []) {
      const sym = String(ev?.ticker || '').trim().toUpperCase()
      if (!sym) continue
      counts.set(sym, (counts.get(sym) || 0) + 1)
    }

    const items = Array.from(counts.entries()).map(([symbol, count]) => ({ symbol, count }))
    items.sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol))
    return items
  }, [listQuery.data])

  const filteredTickers = useMemo(() => {
    const q = String(tickerSearch || '').trim().toUpperCase()
    if (!q) return tickers
    return tickers.filter((t) => t.symbol.includes(q))
  }, [tickers, tickerSearch])

  useEffect(() => {
    if (selectedSymbol) return
    if (!tickers.length) return

    const next = new URLSearchParams(params)
    next.set('symbol', tickers[0].symbol)
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol, tickers.map((t) => t.symbol).join('|')])

  const overlayQuery = useRecommendationOverlay(selectedSymbol, { days: windowDays }, !!selectedSymbol)

  const errorInfo = getUiErrorInfo(listQuery.error) || getUiErrorInfo(overlayQuery.error) || null

  return (
    <div className={styles.page}>
      {errorInfo && <ErrorCallout message={errorInfo.message} requestId={errorInfo.requestId} />}

      <div className={styles.headerRow}>
        <div>
          <h2>Recommendations</h2>
          <div className={cn(util.muted, util.small)}>
            Best-effort from video titles that look like buy recommendations.
          </div>
        </div>
      </div>

      {listQuery.isLoading && <LoadingLine label="Loading recommendation tickers…" />}

      {!listQuery.isLoading && tickers.length === 0 && (
        <EmptyState
          title="No recommendation events yet"
          body="Run the pipeline/backfill or wait for new videos to be ingested."
        />
      )}

      {!listQuery.isLoading && tickers.length > 0 && (
        <div className={styles.contentCol}>
          <section className={ui.card} aria-label="Ticker selection">
            <div className={cn(ui.cardHeader, styles.tickerHeader)}>
              <div>
                <h3>Ticker</h3>
                {selectedSymbol && <div className={cn(util.muted, util.small)}>Selected: {selectedSymbol}</div>}
              </div>

              <div className={styles.headerActions}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="ticker-search">
                    Search
                  </label>
                  <input
                    id="ticker-search"
                    className={styles.input}
                    value={tickerSearch}
                    onChange={(e) => setTickerSearch(e.target.value)}
                    placeholder="Search tickers…"
                    inputMode="search"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>

            <div className={styles.tickerChips} role="list">
              {(filteredTickers.length ? filteredTickers : tickers).map((t) => {
                const active = selectedSymbol === t.symbol
                return (
                  <button
                    key={t.symbol}
                    type="button"
                    className={cn(ui.chip, styles.tickerChip, active && styles.tickerChipActive)}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      const next = new URLSearchParams(params)
                      next.set('symbol', t.symbol)
                      setParams(next, { replace: true })
                    }}
                  >
                    <span className={styles.tickerSym}>{t.symbol}</span>
                    <span className={styles.tickerCount}>{t.count}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <main className={styles.main}>
            {selectedSymbol ? (
              <section className={ui.card} aria-label="Recommendation overlay">
                <div className={ui.cardHeader}>
                  <h2>{selectedSymbol} overlay</h2>
                  <div className={ui.cardHeaderRight}>
                    <div className={cn(util.muted, util.small)}>Price series from yfinance (cached best-effort).</div>
                    <div className={styles.windowChips} role="list" aria-label="Window">
                      {([
                        ['1y', '1y'],
                        ['6m', '6m'],
                        ['3m', '3m'],
                        ['1m', '1m'],
                      ] as const).map(([key, label]) => {
                        const active = windowKey === key
                        return (
                          <button
                            key={key}
                            type="button"
                            className={cn(ui.chip, styles.windowChip, active && styles.windowChipActive)}
                            aria-current={active ? 'true' : undefined}
                            onClick={() => setWindowKey(key)}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                    {overlayQuery.data &&
                      (() => {
                        const avg = avgFinite((overlayQuery.data.events || []).map((e) => e?.return_pct ?? null))
                        if (avg == null) return null
                        return <span className={ui.chip}>Avg: {fmtPct(avg)}</span>
                      })()}
                  </div>
                </div>

                {overlayQuery.isLoading && <LoadingLine label={`Loading ${selectedSymbol} overlay…`} />}

                {overlayQuery.data && (
                  <>
                    <RecommendationOverlayChart
                      symbol={selectedSymbol}
                      prices={overlayQuery.data.prices || []}
                      events={overlayQuery.data.events || []}
                    />

                    {(overlayQuery.data.events?.length || 0) === 0 ? (
                      <div className={cn(util.muted, util.small)} style={{ marginTop: 12 }}>
                        No recommendation-style videos found for this ticker.
                      </div>
                    ) : (
                      <div className={styles.eventList}>
                        {overlayQuery.data.events.slice(0, 50).map((ev: RecommendationEvent) => {
                          const title = String(ev?.title || 'Video').trim()
                          const channel = ev?.channel ? String(ev.channel).trim() : null
                          const published = ev?.published_at
                            ? formatDateTime(String(ev.published_at), {
                                timeZone: intlTimeZone,
                                shiftMinutes: effectiveShiftMinutes,
                              })
                            : null
                          const url = ev?.video_url
                            ? safeExternalHref(ev.video_url)
                            : ev?.video_id
                              ? buildYouTubeWatchUrl(ev.video_id)
                              : null

                          const thumbUrlRaw = ev?.thumbnail_url ? safeExternalHref(ev.thumbnail_url) : null
                          const thumbUrl = thumbUrlRaw && thumbUrlRaw !== '#' ? thumbUrlRaw : null
                          const safeVideoUrl = url && url !== '#' ? url : null

                          const subtitle = [channel, published].filter(Boolean).join(' • ') || null

                          return (
                            <div key={`${ev.video_id}:${ev.ticker}`} className={styles.eventRow}>
                              <div className={styles.eventHeader}>
                                <div className={styles.eventLeft}>
                                  {thumbUrl &&
                                    (safeVideoUrl ? (
                                      <a
                                        className={styles.eventThumbLink}
                                        href={safeVideoUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                      >
                                        <img
                                          className={styles.eventThumb}
                                          src={thumbUrl}
                                          alt=""
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      </a>
                                    ) : (
                                      <span className={styles.eventThumbLink}>
                                        <img
                                          className={styles.eventThumb}
                                          src={thumbUrl}
                                          alt=""
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      </span>
                                    ))}

                                  <div className={styles.eventText}>
                                    {safeVideoUrl ? (
                                      <a
                                        className={styles.eventTitle}
                                        href={safeVideoUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                      >
                                        {title}
                                      </a>
                                    ) : (
                                      <div className={styles.eventTitle}>{title}</div>
                                    )}
                                    {subtitle && <div className={styles.eventMeta}>{subtitle}</div>}
                                  </div>
                                </div>

                                <div className={styles.chips}>
                                  <span className={ui.chip}>Now: {fmtPct(ev?.return_pct)}</span>
                                  <span className={ui.chip}>7d: {fmtPct(ev?.return_7d_pct)}</span>
                                  <span className={ui.chip}>30d: {fmtPct(ev?.return_30d_pct)}</span>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </section>
            ) : (
              <div className={cn(util.muted, util.small)} style={{ marginTop: 8 }}>
                Select a ticker to view its overlay.
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
