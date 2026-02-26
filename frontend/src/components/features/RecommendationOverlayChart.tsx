import React, { useMemo } from 'react'
import type { PriceBar, RecommendationEvent } from '../../types'
import styles from './RecommendationOverlayChart.module.css'

type ChartData = {
  pts: Array<{ date: string; ms: number; price: number }>
  minX: number
  maxX: number
  minY: number
  maxY: number
  x: (ms: number) => number
  y: (v: number) => number
  W: number
  H: number
  padL: number
  padR: number
  padT: number
  padB: number
  path: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function toMs(isoDate: string): number | null {
  const ms = Date.parse(`${isoDate}T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

function toEtIsoDay(isoDateTime: string): string | null {
  const d = new Date(String(isoDateTime || '').trim())
  if (!Number.isFinite(d.getTime())) return null

  // Convert to ET calendar day. Use formatToParts to avoid locale string parsing.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (!y || !m || !day) return null
  return `${y}-${m}-${day}`
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

function fmtMonthYear(ms: number): string {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return '—'
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(d.getUTCFullYear()).slice(-2)
  return `${mm}/${yy}`
}

function fmtMonthDay(ms: number): string {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return '—'
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${mm}/${dd}`
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—'
  // Keep it compact; user asked for price, not currency formatting.
  const abs = Math.abs(n)
  const digits = abs < 10 ? 3 : abs < 100 ? 2 : 2
  return n.toFixed(digits)
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const pct = n * 100
  const digits = Math.abs(pct) < 1 ? 1 : 0
  const s = pct.toFixed(digits)
  return `${pct > 0 ? '+' : ''}${s}%`
}

function stackYs(opts: {
  baseY: number
  count: number
  step: number
  minY: number
  maxY: number
}): number[] {
  const { baseY, count, step, minY, maxY } = opts
  if (!Number.isFinite(baseY) || count <= 0) return []
  const ys = Array.from({ length: count }, (_, i) => baseY - i * step)

  const top = ys[count - 1]
  let shift = 0
  if (top < minY) shift += minY - top
  for (let i = 0; i < ys.length; i++) ys[i] += shift

  const bottom = ys[0]
  if (bottom > maxY) {
    const up = bottom - maxY
    for (let i = 0; i < ys.length; i++) ys[i] -= up
  }

  for (let i = 0; i < ys.length; i++) ys[i] = clamp(ys[i], minY, maxY)
  return ys
}

function priceAtMs(pts: Array<{ ms: number; price: number }>, ms: number): number | null {
  if (!Number.isFinite(ms) || !pts.length) return null
  if (ms <= pts[0].ms) return pts[0].price
  if (ms >= pts[pts.length - 1].ms) return pts[pts.length - 1].price

  // Find the segment [a,b] that contains ms, then linearly interpolate.
  // This matches the SVG path (straight lines between points) since x is linear in ms.
  let lo = 0
  let hi = pts.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].ms === ms) return pts[mid].price
    if (pts[mid].ms < ms) lo = mid
    else hi = mid
  }

  const a = pts[lo]
  const b = pts[hi]
  const denom = b.ms - a.ms
  if (!Number.isFinite(denom) || denom === 0) return a.price
  const t = (ms - a.ms) / denom
  return a.price + t * (b.price - a.price)
}

export default function RecommendationOverlayChart(props: {
  symbol: string
  prices: PriceBar[]
  events: RecommendationEvent[]
}) {
  const data = useMemo<ChartData | null>(() => {
    const raw = (props.prices || [])
      .map((b) => {
        const d = String(b?.date || '').trim()
        const ms = d ? toMs(d) : null
        const pxRaw = b?.adj_close ?? b?.close
        const price = pxRaw == null ? null : Number(pxRaw)
        if (!d || ms == null || !Number.isFinite(price)) return null
        return { date: d, ms, price }
      })
      .filter(Boolean) as Array<{ date: string; ms: number; price: number }>

    raw.sort((a, b) => a.ms - b.ms)

    if (!raw.length) return null

    const pts = raw

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const p of pts) {
      minX = Math.min(minX, p.ms)
      maxX = Math.max(maxX, p.ms)
      minY = Math.min(minY, p.price)
      maxY = Math.max(maxY, p.price)
    }

    if (!pts.length || !Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) return null

    // Add padding so the line isn't glued to borders.
    const range = maxY - minY
    if (Number.isFinite(range) && range > 0) {
      const mid = (minY + maxY) / 2
      const pad = Math.max(range * 0.12, 0.6, Math.abs(mid) * 0.003)
      minY -= pad
      maxY += pad
    } else {
      // Avoid flat line when min==max
      minY = minY - 1
      maxY = maxY + 1
    }

    const W = 900
    const H = 220
    const padL = 64
    const padR = 18
    const padT = 12
    const padB = 28

    // Add a little x padding so right/left-most points (and bubble columns)
    // aren't visually glued to the border.
    const spanX = maxX - minX
    const padX = Math.max(DAY_MS, Math.min(DAY_MS * 4, spanX * 0.06))
    const scaleMinX = minX - padX
    const scaleMaxX = maxX + padX

    const x = (ms: number) => {
      const denom = scaleMaxX - scaleMinX
      const t = denom === 0 ? 0.5 : (ms - scaleMinX) / denom
      return padL + t * (W - padL - padR)
    }

    const y = (v: number) => {
      const t = (v - minY) / (maxY - minY)
      return padT + (1 - t) * (H - padT - padB)
    }

    let d = ''
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const px = x(p.ms)
      const py = y(p.price)
      d += i === 0 ? `M ${px.toFixed(2)} ${py.toFixed(2)}` : ` L ${px.toFixed(2)} ${py.toFixed(2)}`
    }

    return { pts, minX, maxX, minY, maxY, x, y, W, H, padL, padR, padT, padB, path: d }
  }, [props.prices])

  const markers = useMemo(() => {
    const e = (props.events || [])
      .map((ev) => {
        const publishedAt = String(ev?.published_at || '').trim()
        const publishedDayEt = publishedAt ? toEtIsoDay(publishedAt) : null
        const entry = String(ev?.entry_date || '').trim()
        const dayKey = publishedDayEt || entry
        const title = String(ev?.title || '').trim()
        const channel = String(ev?.channel || '').trim()
        const entryClose = ev?.entry_close == null ? null : Number(ev.entry_close)
        const ret = ev?.return_pct == null ? null : Number(ev.return_pct)
        const thumbnailUrl = ev?.thumbnail_url ? String(ev.thumbnail_url).trim() : null

        const ms = dayKey ? toMs(dayKey) : null
        if (!dayKey || ms == null) return null
        return { entry: dayKey, ms, title, channel, entryClose, ret, thumbnailUrl }
      })
      .filter(Boolean) as Array<{
        entry: string
        ms: number
        title: string
        channel: string
        entryClose: number | null
        ret: number | null
        thumbnailUrl: string | null
      }>

    e.sort((a, b) => a.ms - b.ms)
    return e
  }, [props.events])

  const byDay = useMemo(() => {
    const groups = new Map<string, typeof markers>()
    for (const m of markers) {
      const key = String(m.entry || '').trim()
      if (!key) continue
      const arr = groups.get(key)
      if (arr) arr.push(m)
      else groups.set(key, [m])
    }

    const out = Array.from(groups.entries()).map(([day, list]) => ({ day, ms: list[0]?.ms ?? null, list }))
    out.sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0) || a.day.localeCompare(b.day))
    return out
  }, [markers])

  if (!data) {
    return (
      <div className={styles.wrap}>
        <div className={styles.svg} aria-label={`Price chart for ${props.symbol}`} />
      </div>
    )
  }

  const latest = data.pts[data.pts.length - 1]
  const first = data.pts[0]

  const ticks = [data.minY, (data.minY + data.maxY) / 2, data.maxY]
    .filter((v, i, arr) => arr.findIndex((x) => Math.abs(x - v) < 1e-9) === i)
    .map((v) => ({ v, y: data.y(v) }))

  const midPt = data.pts[Math.floor(data.pts.length / 2)]
  const xTickMs = [first.ms, midPt?.ms ?? (data.minX + data.maxX) / 2, latest.ms]
    .filter((v) => Number.isFinite(v))
    .filter((v, i, arr) => arr.indexOf(v) === i)

  const minD = new Date(data.minX)
  const maxD = new Date(data.maxX)
  const sameMonthYear =
    Number.isFinite(minD.getTime()) &&
    Number.isFinite(maxD.getTime()) &&
    minD.getUTCFullYear() === maxD.getUTCFullYear() &&
    minD.getUTCMonth() === maxD.getUTCMonth()

  const xTickLabels = xTickMs.map((ms) => ({
    ms,
    x: data.x(ms),
    label: sameMonthYear ? fmtMonthDay(ms) : fmtMonthYear(ms),
  }))
  const bubbleR = 11

  const symbolKey = props.symbol.replace(/[^a-z0-9_-]/gi, '')
  const stackStep = bubbleR * 2 + 6
  const stackMinY = data.padT + bubbleR
  const stackMaxY = data.H - data.padB - bubbleR

  return (
    <div className={styles.wrap}>
      <svg className={styles.svg} viewBox={`0 0 ${data.W} ${data.H}`} role="img" aria-label={`Price chart for ${props.symbol}`}>
        <defs>
          {byDay.map((g) => {
            const ms = g.ms
            if (ms == null) return null
            const x = data.x(ms)

            // Bubbles are stacked at the bottom of the chart.
            const ys = stackYs({ baseY: stackMaxY, count: g.list.length, step: stackStep, minY: stackMinY, maxY: stackMaxY })
            const clipBase = `thumb-${symbolKey}-${g.day}`
            return g.list.map((m, i) => {
              const y = ys[i]
              const clipId = `${clipBase}-${i}`
              if (y == null || !m.thumbnailUrl) return null
              return (
                <clipPath key={clipId} id={clipId}>
                  <circle cx={x} cy={y} r={bubbleR - 1} />
                </clipPath>
              )
            })
          })}
        </defs>

        {/* Y ticks */}
        {ticks.map((tk, i) => (
          <g key={`y-${i}`}>
            <text className={styles.axisText} x={8} y={tk.y + 4}>
              {fmtPrice(tk.v)}
            </text>
          </g>
        ))}

        {/* X ticks (Month/Year) */}
        {xTickLabels.map((tk, i) => (
          <text
            key={`x-${i}`}
            className={styles.axisText}
            x={tk.x}
            y={data.H - 6}
            textAnchor={i === 0 ? 'start' : i === xTickLabels.length - 1 ? 'end' : 'middle'}
          >
            {tk.label}
          </text>
        ))}

        {/* Price line */}
        <path className={styles.priceLine} d={data.path} />

        {/* Recommendation bubbles (grouped and stacked per day) */}
        {byDay.map((g) => {
          const ms = g.ms
          if (ms == null) return null

          const x = data.x(ms)

          // Draw a dot on the actual history line (prefer exact bar price; fall back to event entry close).
          const linePrice = priceAtMs(data.pts, ms)
          const dotPrice =
            linePrice != null && Number.isFinite(linePrice)
              ? linePrice
              : (g.list.find((m) => m.entryClose != null && Number.isFinite(m.entryClose))?.entryClose ?? null)
          const dotY = dotPrice != null && Number.isFinite(dotPrice) ? data.y(dotPrice) : null

          let dayRetSum = 0
          let dayRetN = 0
          for (const m of g.list) {
            const r = m.ret
            if (r != null && Number.isFinite(r)) {
              dayRetSum += r
              dayRetN += 1
            }
          }
          const dayRetAvg = dayRetN > 0 ? dayRetSum / dayRetN : null
          const dayProfitState: 'up' | 'down' | 'flat' =
            dayRetAvg == null || !Number.isFinite(dayRetAvg) ? 'flat' : dayRetAvg >= 0 ? 'up' : 'down'
          const dayLineClass =
            dayProfitState === 'up'
              ? styles.profitLineUp
              : dayProfitState === 'down'
                ? styles.profitLineDown
                : styles.profitLine

          const ys = stackYs({ baseY: stackMaxY, count: g.list.length, step: stackStep, minY: stackMinY, maxY: stackMaxY })
          const clipBase = `thumb-${symbolKey}-${g.day}`

          return (
            <g key={`day-${g.day}`}>
              {/* One vertical marker per day */}
              <line className={styles.markerLine} x1={x} x2={x} y1={data.padT} y2={data.H - data.padB} />

              {/* Dot on the history line for this day */}
              {dotY != null && (
                <circle className={styles.markerDot} cx={x} cy={dotY} r={3.5}>
                  <title>{`${g.day} • ${fmtPrice(dotPrice ?? NaN)}`}</title>
                </circle>
              )}

              {/* Projection from the history-line dot to latest (right) */}
              {dotY != null && (
                <line className={dayLineClass} x1={x} y1={dotY} x2={data.x(latest.ms)} y2={dotY}>
                  <title>
                    {[g.day, dayRetAvg != null && Number.isFinite(dayRetAvg) ? `Avg now ${fmtPct(dayRetAvg)}` : null]
                      .filter(Boolean)
                      .join(' • ')}
                  </title>
                </line>
              )}

              {g.list.map((m, i) => {
                const y = ys[i]
                if (y == null) return null

                const mRet = m.ret
                const mProfitState: 'up' | 'down' | 'flat' =
                  mRet == null || !Number.isFinite(mRet) ? 'flat' : mRet >= 0 ? 'up' : 'down'
                const ringClass =
                  mProfitState === 'up'
                    ? styles.thumbRingUp
                    : mProfitState === 'down'
                      ? styles.thumbRingDown
                      : styles.thumbRing

                const clipId = `${clipBase}-${i}`
                const retLabel = mRet != null && Number.isFinite(mRet) ? `Now ${fmtPct(mRet)}` : null
                const label = [m.entry, m.channel || null, m.title || null, retLabel].filter(Boolean).join(' • ')

                return (
                  <g key={`b-${g.day}-${i}`}>
                    <circle className={ringClass} cx={x} cy={y} r={bubbleR}>
                      <title>{label}</title>
                    </circle>

                    {m.thumbnailUrl && (
                      <image
                        href={m.thumbnailUrl}
                        x={x - (bubbleR - 1)}
                        y={y - (bubbleR - 1)}
                        width={(bubbleR - 1) * 2}
                        height={(bubbleR - 1) * 2}
                        clipPath={`url(#${clipId})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* Dots for endpoints */}
        <circle className={styles.dot} cx={data.x(first.ms)} cy={data.y(first.price)} r={3}>
          <title>{`${first.date} • ${fmtPrice(first.price)}`}</title>
        </circle>
        <circle className={styles.dot} cx={data.x(latest.ms)} cy={data.y(latest.price)} r={3}>
          <title>{`${latest.date} • ${fmtPrice(latest.price)}`}</title>
        </circle>

      </svg>
    </div>
  )
}
