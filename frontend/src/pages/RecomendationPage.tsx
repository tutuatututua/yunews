import React, { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import RecommendationOverlayChart from '../components/features/RecommendationOverlayChart'
import { ErrorCallout, EmptyState } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { cn } from '../lib/cn'
import { getUiErrorInfo } from '../lib/errors'
import { safeExternalHref } from '../lib/safeUrl'
import { useYoutuberRecommendationOverlay, useYoutuberRecommendationsList } from '../services/queries'
import type { YoutuberRecommendationEvent } from '../types'
import { ui, util } from '../styles'
import styles from './RecomendationPage.module.css'

function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || '').trim())}`
}

function fmtPct(x: unknown): string {
  const n = typeof x === 'number' ? x : Number(x)
  if (!Number.isFinite(n)) return '—'
  const s = (n * 100).toFixed(Math.abs(n) < 0.1 ? 1 : 0)
  return `${s}%`
}

export default function RecomendationPage() {
  const [params, setParams] = useSearchParams()

  const selectedSymbol = useMemo(() => {
    const raw = params.get('symbol')
    const sym = String(raw || '').trim().toUpperCase()
    return sym || null
  }, [params])

  const listQuery = useYoutuberRecommendationsList({ days: 365, limit: 600 })

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

  useEffect(() => {
    if (selectedSymbol) return
    if (!tickers.length) return

    const next = new URLSearchParams(params)
    next.set('symbol', tickers[0].symbol)
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol, tickers.map((t) => t.symbol).join('|')])

  const overlayQuery = useYoutuberRecommendationOverlay(selectedSymbol, { days: 365 }, !!selectedSymbol)

  const errorInfo = getUiErrorInfo(listQuery.error) || getUiErrorInfo(overlayQuery.error) || null

  return (
    <div className={styles.page}>
      {errorInfo && <ErrorCallout message={errorInfo.message} requestId={errorInfo.requestId} />}

      <div className={styles.headerRow}>
        <div>
          <h2>Recomendation</h2>
          <div className={cn(util.muted, util.small)}>
            Best-effort from video titles that look like buy recommendations.
          </div>
        </div>

        <div className={styles.headerActions}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Ticker</span>
            <select
              className={styles.select}
              value={selectedSymbol || ''}
              onChange={(e) => {
                const sym = String(e.target.value || '').trim().toUpperCase()
                const next = new URLSearchParams(params)
                if (sym) next.set('symbol', sym)
                else next.delete('symbol')
                setParams(next, { replace: true })
              }}
              aria-busy={listQuery.isLoading}
            >
              <option value="">Select…</option>
              {tickers.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.symbol} ({t.count})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {listQuery.isLoading && <LoadingLine label="Loading recommendation tickers…" />}

      {!listQuery.isLoading && tickers.length === 0 && (
        <EmptyState
          title="No recommendation events yet"
          body="Run the pipeline/backfill or wait for new videos to be ingested."
        />
      )}

      {selectedSymbol && (
        <section className={ui.card} aria-label="Recommendation overlay">
          <div className={ui.cardHeader}>
            <h2>{selectedSymbol} overlay</h2>
            <div className={cn(util.muted, util.small)}>Price series from yfinance (cached best-effort).</div>
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
                  {overlayQuery.data.events.slice(0, 50).map((ev: YoutuberRecommendationEvent) => {
                    const title = String(ev?.title || 'Video').trim()
                    const channel = ev?.channel ? String(ev.channel).trim() : null
                    const entry = ev?.entry_date ? String(ev.entry_date) : null
                    const url = ev?.video_url
                      ? safeExternalHref(ev.video_url)
                      : ev?.video_id
                        ? buildYouTubeWatchUrl(ev.video_id)
                        : null

                    const subtitle = [channel, entry].filter(Boolean).join(' • ') || null

                    return (
                      <div key={`${ev.video_id}:${ev.ticker}`} className={styles.eventRow}>
                        <div className={styles.eventHeader}>
                          <div>
                            {url ? (
                              <a className={styles.eventTitle} href={url} target="_blank" rel="noreferrer noopener">
                                {title}
                              </a>
                            ) : (
                              <div className={styles.eventTitle}>{title}</div>
                            )}
                            {subtitle && <div className={styles.eventMeta}>{subtitle}</div>}
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
      )}
    </div>
  )
}
