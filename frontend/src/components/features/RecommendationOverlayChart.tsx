import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PriceBar, RecommendationEvent } from '../../types'
import styles from './RecommendationOverlayChart.module.css'

type ChartData = {
  pts: Array<{ date: string; ms: number; price: number }>
  minX: number
  maxX: number
  minY: number
  maxY: number
  x: (ms: number) => number
  invX: (px: number) => number
  y: (v: number) => number
  W: number
  H: number
  padL: number
  padR: number
  padT: number
  padB: number
  path: string
  areaPath: string
}

type TrendDir = 'up' | 'down' | 'flat'

type Marker = {
  entry: string
  ms: number
  title: string
  channel: string
  entryClose: number | null
  ret: number | null
  thumbnailUrl: string | null
}

type MarkerDayGroup = {
  day: string
  ms: number | null
  list: Marker[]
}

type RangeInfo = {
  leftPx: number
  rightPx: number
  startMs: number
  endMs: number
  startPrice: number
  endPrice: number
  pct: number
  label: string
  dir: TrendDir
}

type TooltipBox = {
  x: number
  y: number
  w: number
  h: number
  pad: number
}

type HoverInfo = {
  x: number
  ms: number
  price: number
  y: number
  dateLabel: string
  priceLabel: string
  tooltip: TooltipBox
}

const DAY_MS = 24 * 60 * 60 * 1000

const CHART_W = 900
const CHART_H = 220
const CHART_PAD_L = 64
const CHART_PAD_R = 18
const CHART_PAD_T = 12
const CHART_PAD_B = 28

const TOOLTIP_W = 178
const TOOLTIP_H = 48
const TOOLTIP_PAD = 10

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

function fmtRangeDateEng(ms: number): string {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return '—'

  // Match reference style but in English: "Tue 24 Feb 2026"
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(d)

  const wk = parts.find((p) => p.type === 'weekday')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const year = parts.find((p) => p.type === 'year')?.value

  return [wk, day, month, year].filter(Boolean).join(' ')
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—'
  // Keep it compact; user asked for price, not currency formatting.
  const abs = Math.abs(n)
  const digits = abs < 10 ? 3 : abs < 100 ? 2 : 2
  return n.toFixed(digits)
}

function fmtDelta(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs < 10 ? 2 : abs < 100 ? 2 : 2
  const s = n.toFixed(digits)
  return n > 0 ? `+${s}` : s
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

function trendFromValue(v: number): TrendDir {
  if (!Number.isFinite(v)) return 'flat'
  return v > 1e-9 ? 'up' : v < -1e-9 ? 'down' : 'flat'
}

function buildChartData(prices: PriceBar[]): ChartData | null {
  const raw = (prices || [])
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

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) return null

  const range = maxY - minY
  if (Number.isFinite(range) && range > 0) {
    const mid = (minY + maxY) / 2
    const pad = Math.max(range * 0.12, 0.6, Math.abs(mid) * 0.003)
    minY -= pad
    maxY += pad
  } else {
    minY = minY - 1
    maxY = maxY + 1
  }

  const W = CHART_W
  const H = CHART_H
  const padL = CHART_PAD_L
  const padR = CHART_PAD_R
  const padT = CHART_PAD_T
  const padB = CHART_PAD_B

  const spanX = maxX - minX
  // Keep the series tight to the visible plot area; avoid large left/right gaps.
  const padX = 0
  const scaleMinX = minX - padX
  const scaleMaxX = maxX + padX

  const x = (ms: number) => {
    const denom = scaleMaxX - scaleMinX
    const t = denom === 0 ? 0.5 : (ms - scaleMinX) / denom
    return padL + t * (W - padL - padR)
  }

  const invX = (px: number) => {
    const denom = W - padL - padR
    const t = denom === 0 ? 0.5 : (px - padL) / denom
    return scaleMinX + t * (scaleMaxX - scaleMinX)
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

  const baseY = H - padB
  const firstPx = x(pts[0].ms)
  const lastPx = x(pts[pts.length - 1].ms)
  const areaPath = `${d} L ${lastPx.toFixed(2)} ${baseY.toFixed(2)} L ${firstPx.toFixed(2)} ${baseY.toFixed(2)} Z`

  return { pts, minX, maxX, minY, maxY, x, invX, y, W, H, padL, padR, padT, padB, path: d, areaPath }
}

function buildMarkers(events: RecommendationEvent[]): Marker[] {
  const out = (events || [])
    .map((ev) => {
      const publishedAt = String(ev?.published_at || '').trim()
      const publishedDayEt = publishedAt ? toEtIsoDay(publishedAt) : null
      const entry = String(ev?.entry_date || '').trim()
      // Prefer the computed market entry day (aligns with price bars). Fall back to
      // the YouTube publish day when we don't have an entry day.
      const dayKey = entry || publishedDayEt
      const title = String(ev?.title || '').trim()
      const channel = String(ev?.channel || '').trim()
      const entryClose = ev?.entry_close == null ? null : Number(ev.entry_close)
      const ret = ev?.return_pct == null ? null : Number(ev.return_pct)
      const thumbnailUrl = ev?.thumbnail_url ? String(ev.thumbnail_url).trim() : null

      const ms = dayKey ? toMs(dayKey) : null
      if (!dayKey || ms == null) return null
      return { entry: dayKey, ms, title, channel, entryClose, ret, thumbnailUrl }
    })
    .filter(Boolean) as Marker[]

  out.sort((a, b) => a.ms - b.ms)
  return out
}

function groupMarkersByDay(markers: Marker[]): MarkerDayGroup[] {
  const groups = new Map<string, Marker[]>()
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
}

function computeTooltipBox(opts: {
  x: number
  y: number
  W: number
  padL: number
  padR: number
  plotMinY: number
  plotMaxY: number
}): TooltipBox {
  const { x, y, W, padL, padR, plotMinY, plotMaxY } = opts

  const preferRight = x < W * 0.62
  const x0 = preferRight ? x + 10 : x - 10 - TOOLTIP_W
  const y0 = clamp(y - TOOLTIP_H / 2, plotMinY + 6, plotMaxY - TOOLTIP_H - 6)
  const xClamped = clamp(x0, padL + 6, W - padR - TOOLTIP_W - 6)

  return { x: xClamped, y: y0, w: TOOLTIP_W, h: TOOLTIP_H, pad: TOOLTIP_PAD }
}

function computeRangeInfo(data: ChartData, rangePx: { a: number; b: number } | null): RangeInfo | null {
  if (!rangePx) return null
  // Clamp range to the actual data-domain, not the padded scale domain.
  // This prevents selecting in the left/right empty space where the line doesn't exist.
  const plotMinX = data.x(data.minX)
  const plotMaxX = data.x(data.maxX)

  const a = clamp(rangePx.a, plotMinX, plotMaxX)
  const b = clamp(rangePx.b, plotMinX, plotMaxX)
  const leftPx = Math.min(a, b)
  const rightPx = Math.max(a, b)
  if (!Number.isFinite(leftPx) || !Number.isFinite(rightPx) || rightPx - leftPx < 2) return null

  const startMs = clamp(data.invX(leftPx), data.minX, data.maxX)
  const endMs = clamp(data.invX(rightPx), data.minX, data.maxX)
  const startPrice = priceAtMs(data.pts, startMs)
  const endPrice = priceAtMs(data.pts, endMs)
  if (startPrice == null || endPrice == null || !Number.isFinite(startPrice) || !Number.isFinite(endPrice) || startPrice === 0) return null

  const pct = endPrice / startPrice - 1
  const fromLabel = `${fmtRangeDateEng(startMs)} ${fmtPrice(startPrice)}`
  const toLabel = `${fmtRangeDateEng(endMs)} ${fmtPrice(endPrice)}`
  const label = `${fromLabel} → ${toLabel} (${fmtPct(pct)})`
  const dir = trendFromValue(pct)

  return { leftPx, rightPx, startMs, endMs, startPrice, endPrice, pct, label, dir }
}

function computeHoverInfo(data: ChartData, hoverPx: number | null): HoverInfo | null {
  if (hoverPx == null) return null
  // Clamp hover to the actual data-domain.
  const plotMinX = data.x(data.minX)
  const plotMaxX = data.x(data.maxX)
  const plotMinY = data.padT
  const plotMaxY = data.H - data.padB

  const x = clamp(hoverPx, plotMinX, plotMaxX)
  const ms = clamp(data.invX(x), data.minX, data.maxX)
  const price = priceAtMs(data.pts, ms)
  if (price == null || !Number.isFinite(price)) return null
  const y = data.y(price)
  const tooltip = computeTooltipBox({ x, y, W: data.W, padL: data.padL, padR: data.padR, plotMinY, plotMaxY })

  return {
    x,
    ms,
    price,
    y,
    dateLabel: fmtRangeDateEng(ms),
    priceLabel: `${fmtPrice(price)}`,
    tooltip,
  }
}

export default function RecommendationOverlayChart(props: {
  symbol: string
  prices: PriceBar[]
  events: RecommendationEvent[]
  headerRight?: ReactNode
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const draggingRef = useRef(false)
  const [rangePx, setRangePx] = useState<{ a: number; b: number; dragging: boolean } | null>(null)
  const [hoverPx, setHoverPx] = useState<number | null>(null)

  const data = useMemo<ChartData | null>(() => buildChartData(props.prices || []), [props.prices])
  const markers = useMemo<Marker[]>(() => buildMarkers(props.events || []), [props.events])
  const byDay = useMemo<MarkerDayGroup[]>(() => groupMarkersByDay(markers), [markers])

  const rangeInfo = useMemo<RangeInfo | null>(() => {
    if (!data) return null
    return computeRangeInfo(data, rangePx)
  }, [data, rangePx])

  const hoverInfo = useMemo<HoverInfo | null>(() => {
    if (!data) return null
    return computeHoverInfo(data, hoverPx)
  }, [data, hoverPx])

  if (!data) {
    return (
      <div className={styles.wrap}>
        <div className={styles.svg} aria-label={`Price chart for ${props.symbol}`} />
      </div>
    )
  }

  const plotMinX = data.padL
  const plotMaxX = data.W - data.padR
  const plotMinY = data.padT
  const plotMaxY = data.H - data.padB

  const domainMinX = data.x(data.minX)
  const domainMaxX = data.x(data.maxX)

  const clientToSvgPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (!Number.isFinite(rect.width) || rect.width <= 0) return null
    if (!Number.isFinite(rect.height) || rect.height <= 0) return null
    const tx = (clientX - rect.left) / rect.width
    const ty = (clientY - rect.top) / rect.height
    const x = tx * data.W
    const y = ty * data.H
    return {
      // Use padded plot bounds for y (vertical), but data-domain bounds for x (horizontal).
      x: clamp(x, domainMinX, domainMaxX),
      // Keep y raw so we can detect “outside plot”.
      y,
    }
  }

  const latest = data.pts[data.pts.length - 1]
  const first = data.pts[0]
  const seriesPct = first.price !== 0 ? latest.price / first.price - 1 : NaN
  const trend: TrendDir = trendFromValue(seriesPct)
  const lineClass = trend === 'up' ? styles.priceLineUp : trend === 'down' ? styles.priceLineDown : styles.priceLine
  const areaClass = trend === 'up' ? styles.areaUp : trend === 'down' ? styles.areaDown : styles.area

  const headerDeltaAbs = latest.price - first.price
  const headerDeltaPct = first.price !== 0 ? latest.price / first.price - 1 : NaN
  const headerDeltaDir: TrendDir = trendFromValue(headerDeltaPct)

  const headerDeltaClass =
    headerDeltaDir === 'up' ? styles.deltaUp : headerDeltaDir === 'down' ? styles.deltaDown : styles.deltaFlat

  const rangeShadeClass =
    rangeInfo?.dir === 'up'
      ? styles.rangeShadeUp
      : rangeInfo?.dir === 'down'
        ? styles.rangeShadeDown
        : styles.rangeShade

  const rangeEdgeClass =
    rangeInfo?.dir === 'up' ? styles.rangeEdgeUp : rangeInfo?.dir === 'down' ? styles.rangeEdgeDown : styles.rangeEdge

  const rangeLabelClass =
    rangeInfo?.dir === 'up' ? styles.rangeLabelUp : rangeInfo?.dir === 'down' ? styles.rangeLabelDown : styles.rangeLabel

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
      <div className={styles.header} aria-label="Price summary">
        <div className={styles.headerLeft}>
          <div className={styles.priceRow}>
            <span className={styles.symbol}>{props.symbol}</span>
            <span className={styles.priceValue}>{fmtPrice(latest.price)}</span>
            <span className={styles.priceUnit}>USD</span>
          </div>
          <div className={headerDeltaClass}>
            {fmtDelta(headerDeltaAbs)} ({fmtPct(headerDeltaPct)})
          </div>

          <div className={styles.rangeText}>
            {fmtRangeDateEng(first.ms)} → {fmtRangeDateEng(latest.ms)}
          </div>
        </div>

        {props.headerRight ? <div className={styles.headerRight}>{props.headerRight}</div> : null}
      </div>

      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox={`0 0 ${data.W} ${data.H}`}
        role="img"
        aria-label={`Price chart for ${props.symbol}`}
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const pt = clientToSvgPoint(e.clientX, e.clientY)
          if (!pt) return
          // Only start drag if the initial press is inside the plot area.
          if (pt.y < plotMinY || pt.y > plotMaxY) return
          ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
          draggingRef.current = true
          setRangePx({ a: pt.x, b: pt.x, dragging: true })
          setHoverPx(pt.x)
        }}
        onPointerMove={(e) => {
          const pt = clientToSvgPoint(e.clientX, e.clientY)
          if (!pt) return
          // If not dragging, hide hover when pointer isn't in the plot area.
          if (!draggingRef.current && (pt.y < plotMinY || pt.y > plotMaxY)) {
            setHoverPx(null)
            return
          }

          setHoverPx(pt.x)
          setRangePx((prev) => (prev?.dragging ? { ...prev, b: pt.x } : prev))
        }}
        onPointerUp={(e) => {
          try {
            ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
          } catch {
            // ignore
          }
          draggingRef.current = false
          setRangePx((prev) => (prev ? { ...prev, dragging: false } : prev))
        }}
        onPointerCancel={() => {
          draggingRef.current = false
          setRangePx((prev) => (prev ? { ...prev, dragging: false } : prev))
        }}
        onPointerLeave={() => {
          setHoverPx(null)
        }}
      >
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

        {/* Area + price line */}
        <path className={areaClass} d={data.areaPath} />
        <path className={lineClass} d={data.path} />

        {/* Hover guide + tooltip */}
        {hoverInfo && (
          <g>
            <line className={styles.hoverLine} x1={hoverInfo.x} x2={hoverInfo.x} y1={plotMinY} y2={plotMaxY} />
            <circle className={styles.hoverDot} cx={hoverInfo.x} cy={hoverInfo.y} r={4.2} />

            <g>
              <rect
                className={styles.tooltipBox}
                x={hoverInfo.tooltip.x}
                y={hoverInfo.tooltip.y}
                width={hoverInfo.tooltip.w}
                height={hoverInfo.tooltip.h}
                rx={10}
                ry={10}
              />
              <text
                className={styles.tooltipPrice}
                x={hoverInfo.tooltip.x + hoverInfo.tooltip.pad}
                y={hoverInfo.tooltip.y + 20}
                textAnchor="start"
              >
                {hoverInfo.priceLabel}
              </text>
              <text
                className={styles.tooltipDate}
                x={hoverInfo.tooltip.x + hoverInfo.tooltip.pad}
                y={hoverInfo.tooltip.y + 38}
                textAnchor="start"
              >
                {hoverInfo.dateLabel}
              </text>
            </g>
          </g>
        )}

        {/* Drag-to-select range window */}
        {rangeInfo && (
          <g>
            <rect
              className={rangeShadeClass}
              x={rangeInfo.leftPx}
              y={plotMinY}
              width={Math.max(0, rangeInfo.rightPx - rangeInfo.leftPx)}
              height={Math.max(0, plotMaxY - plotMinY)}
            />
            <line className={rangeEdgeClass} x1={rangeInfo.leftPx} x2={rangeInfo.leftPx} y1={plotMinY} y2={plotMaxY} />
            <line className={rangeEdgeClass} x1={rangeInfo.rightPx} x2={rangeInfo.rightPx} y1={plotMinY} y2={plotMaxY} />
            <text
              className={rangeLabelClass}
              x={(rangeInfo.leftPx + rangeInfo.rightPx) / 2}
              y={plotMinY + 26}
              textAnchor="middle"
            >
              {rangeInfo.label}
            </text>
          </g>
        )}

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
