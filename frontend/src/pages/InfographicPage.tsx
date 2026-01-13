import React, { Suspense, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ErrorCallout } from '../components/ui/Callout'
import { LoadingLine } from '../components/ui/Loading'
import { cn } from '../lib/cn'
import { parseDays } from '../lib/format'
import { useLatestDailySummary, useVideoInfographic } from '../services/queries'
import { ui, util } from '../styles'
import styles from './InfographicPage.module.css'

const VideoTickerInfographic = React.lazy(() => import('../components/features/VideoTickerInfographic'))

export default function InfographicPage() {
  const [params, setParams] = useSearchParams()
  const days = useMemo(() => parseDays(params.get('days'), 7), [params])

  const onChangeDays: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    const next = new URLSearchParams(params)
    next.set('days', e.target.value)
    setParams(next)
  }

  const dailyQuery = useLatestDailySummary()
  const anchorDate = dailyQuery.data?.market_date
  const infographicQuery = useVideoInfographic(anchorDate, days, 250, !dailyQuery.isLoading)

  const error = (dailyQuery.error as any)?.message || (infographicQuery.error as any)?.message || null

  return (
    <div className={util.stack}>
      <div className={styles.pageHeader}>
        <div>
          <h2>Infographic</h2>
          <div className={cn(util.muted, util.small)}>
            {anchorDate ? `Anchored to ${anchorDate}` : 'Latest'}
          </div>
        </div>
        <div className={styles.headerRight}>
          <select
            className={styles.headerSelect}
            value={String(days)}
            onChange={onChangeDays}
            aria-label="Select day window"
          >
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <Link className={cn(ui.button, ui.ghost)} to={`/` + (days ? `?days=${encodeURIComponent(String(days))}` : '')}>
            Back
          </Link>
        </div>
      </div>

      {error && <ErrorCallout message={error} />}
      {(dailyQuery.isLoading || infographicQuery.isLoading) && <LoadingLine label="Loading infographic…" />}

      <div className={ui.card}>
        <Suspense fallback={<LoadingLine label="Loading visualization…" />}>
          <VideoTickerInfographic items={infographicQuery.data || []} days={days} enablePopout={false} showRangeLabel={false} />
        </Suspense>
      </div>
    </div>
  )
}
