import React, { useMemo } from 'react'
import type { PriceBar, YoutuberRecommendationEvent } from '../../types'
import styles from './RecommendationOverlayChart.module.css'

type ChartData = {
  pts: Array<{ date: string; ms: number; close: number }>
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

function toMs(isoDate: string): number | null {
  const ms = Date.parse(`${isoDate}T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

export default function RecommendationOverlayChart(props: {
  symbol: string
  prices: PriceBar[]
  events: YoutuberRecommendationEvent[]
}) {
  const data = useMemo<ChartData | null>(() => {
    const pts = (props.prices || [])
      .map((b) => {
        const d = String(b?.date || '').trim()
        const ms = d ? toMs(d) : null
        const close = b?.close == null ? null : Number(b.close)
        if (!d || ms == null || !Number.isFinite(close)) return null
        return { date: d, ms, close }
      })
      .filter(Boolean) as Array<{ date: string; ms: number; close: number }>

    pts.sort((a, b) => a.ms - b.ms)

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const p of pts) {
      minX = Math.min(minX, p.ms)
      maxX = Math.max(maxX, p.ms)
      minY = Math.min(minY, p.close)
      maxY = Math.max(maxY, p.close)
    }

    if (!pts.length || !Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) return null

    // Avoid flat line when min==max
    if (minY === maxY) {
      minY = minY - 1
      maxY = maxY + 1
    }

    const W = 900
    const H = 160
    const padL = 48
    const padR = 18
    const padT = 12
    const padB = 22

    const x = (ms: number) => {
      const t = (ms - minX) / (maxX - minX)
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
      const py = y(p.close)
      d += i === 0 ? `M ${px.toFixed(2)} ${py.toFixed(2)}` : ` L ${px.toFixed(2)} ${py.toFixed(2)}`
    }

    return { pts, minX, maxX, minY, maxY, x, y, W, H, padL, padR, padT, padB, path: d }
  }, [props.prices])

  const markers = useMemo(() => {
    const e = (props.events || [])
      .map((ev) => {
        const entry = String(ev?.entry_date || '').trim()
        const title = String(ev?.title || '').trim()
        const channel = String(ev?.channel || '').trim()
        const ms = entry ? toMs(entry) : null
        if (!entry || ms == null) return null
        return { entry, ms, title, channel }
      })
      .filter(Boolean) as Array<{ entry: string; ms: number; title: string; channel: string }>

    e.sort((a, b) => a.ms - b.ms)
    return e
  }, [props.events])

  if (!data) {
    return (
      <div className={styles.wrap}>
        <div className={styles.svg} aria-label={`Price chart for ${props.symbol}`} />
      </div>
    )
  }

  const latest = data.pts[data.pts.length - 1]
  const first = data.pts[0]

  const fmt = (n: number) => {
    if (!Number.isFinite(n)) return '—'
    const abs = Math.abs(n)
    if (abs >= 1000) return n.toFixed(0)
    if (abs >= 100) return n.toFixed(1)
    return n.toFixed(2)
  }

  const ticks = [0, 0.5, 1].map((t) => {
    const v = data.minY + t * (data.maxY - data.minY)
    return { v, y: data.y(v) }
  })

  return (
    <div className={styles.wrap}>
      <svg className={styles.svg} viewBox={`0 0 ${data.W} ${data.H}`} role="img" aria-label={`Price chart for ${props.symbol}`}>
        {/* Y ticks */}
        {ticks.map((tk, i) => (
          <g key={`y-${i}`}>
            <text className={styles.axisText} x={8} y={tk.y + 4}>
              {fmt(tk.v)}
            </text>
          </g>
        ))}

        {/* Price line */}
        <path className={styles.priceLine} d={data.path} />

        {/* Dots for endpoints */}
        <circle className={styles.dot} cx={data.x(first.ms)} cy={data.y(first.close)} r={3} />
        <circle className={styles.dot} cx={data.x(latest.ms)} cy={data.y(latest.close)} r={3} />

        {/* Recommendation markers */}
        {markers.map((m, i) => {
          const t = (m.ms - data.minX) / (data.maxX - data.minX)
          const clamped = clamp(t, 0, 1)
          const x = data.padL + clamped * (data.W - data.padL - data.padR)
          const label = [m.entry, m.channel ? `• ${m.channel}` : '', m.title ? `• ${m.title}` : ''].filter(Boolean).join(' ')
          return (
            <g key={`m-${i}`}>
              <line className={styles.markerLine} x1={x} x2={x} y1={data.padT} y2={data.H - data.padB}>
                <title>{label}</title>
              </line>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
