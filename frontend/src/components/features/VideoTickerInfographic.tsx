import React, { useEffect, useMemo, useRef, useState } from 'react'
import { drag } from 'd3-drag'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import { select } from 'd3-selection'
import type { VideoInfographicItem } from '../../types'
import { cn } from '../../lib/cn'
import { util } from '../../styles'
import styles from './VideoTickerInfographic.module.css'

/**
 * Bubble / force-directed remake
 * - Videos + tickers are nodes
 * - Links connect videos -> tickers
 * - d3-force animates positions
 */

type EdgeSentiment = 'positive' | 'negative' | 'neutral'

type VideoNode = {
  id: string
  type: 'video'
  label: string
  weight: number
  thumbnailUrl?: string | null
  videoTitle?: string
  videoUrl?: string
}

type TickerNode = {
  id: string
  type: 'ticker'
  label: string
  weight: number
}

type Node = VideoNode | TickerNode

type Link = {
  source: string
  target: string
  sentiment: EdgeSentiment
  weight: number
}

export default function VideoTickerInfographicForce(props: {
  items: VideoInfographicItem[]
  days: number
  enablePopout?: boolean
  showRangeLabel?: boolean
  selectedNodeId?: string | null
  onSelectTicker?: (symbol: string) => void
  onSelectVideo?: (videoId: string) => void
}) {
  const {
    items,
    days,
    enablePopout = true,
    showRangeLabel = true,
    selectedNodeId,
    onSelectTicker,
    onSelectVideo,
  } = props
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState<number>(() => (typeof window === 'undefined' ? 800 : window.innerHeight))

  // Avoid re-creating the entire D3 viz when selection/callback props change.
  // We keep callbacks in refs and update the highlight via a separate effect.
  const onSelectTickerRef = useRef<typeof onSelectTicker>(onSelectTicker)
  const onSelectVideoRef = useRef<typeof onSelectVideo>(onSelectVideo)
  const nodeCircleSelectionRef = useRef<any>(null)

  useEffect(() => {
    onSelectTickerRef.current = onSelectTicker
    onSelectVideoRef.current = onSelectVideo
  }, [onSelectTicker, onSelectVideo])

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const tickerStats = useMemo(() => {
    const m = new Map<
      string,
      {
        symbol: string
        mentions: number
        positiveVideoIds: Set<string>
        neutralVideoIds: Set<string>
        negativeVideoIds: Set<string>
      }
    >()

    for (const v of items || []) {
      if (!v?.video_id) continue
      for (const e of v.edges || []) {
        if (!e?.ticker) continue
        const sym = String(e.ticker).toUpperCase()
        const row =
          m.get(sym) ||
          ({
            symbol: sym,
            mentions: 0,
            positiveVideoIds: new Set<string>(),
            neutralVideoIds: new Set<string>(),
            negativeVideoIds: new Set<string>(),
          } satisfies {
            symbol: string
            mentions: number
            positiveVideoIds: Set<string>
            neutralVideoIds: Set<string>
            negativeVideoIds: Set<string>
          })
        row.mentions += 1
        if (e.sentiment === 'positive') row.positiveVideoIds.add(v.video_id)
        else if (e.sentiment === 'negative') row.negativeVideoIds.add(v.video_id)
        else row.neutralVideoIds.add(v.video_id)
        m.set(sym, row)
      }
    }

    return Array.from(m.values())
      .map((r) => ({
        symbol: r.symbol,
        mentions: r.mentions,
        positiveVideos: r.positiveVideoIds.size,
        neutralVideos: r.neutralVideoIds.size,
        negativeVideos: r.negativeVideoIds.size,
        overall:
          r.positiveVideoIds.size === r.negativeVideoIds.size
            ? ('neutral' as const)
            : r.positiveVideoIds.size > r.negativeVideoIds.size
              ? ('positive' as const)
              : ('negative' as const),
      }))
      .sort(
        (a, b) =>
          b.positiveVideos - a.positiveVideos ||
          b.neutralVideos - a.neutralVideos ||
          b.negativeVideos - a.negativeVideos ||
          b.mentions - a.mentions ||
          a.symbol.localeCompare(b.symbol),
      )
  }, [items])

  const tickerOverallBySymbol = useMemo(() => {
    const m = new Map<string, EdgeSentiment>()
    for (const t of tickerStats) m.set(t.symbol, t.overall)
    return m
  }, [tickerStats])

  const popoutHref = useMemo(() => `/ticker?days=${encodeURIComponent(String(days))}`, [days])

  const onHeaderClick = () => {
    if (!enablePopout) return
    window.open(popoutHref, '_blank', 'noopener,noreferrer')
  }

  const onHeaderKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (!enablePopout) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onHeaderClick()
    }
  }

  /** ---------- Normalize data ---------- */
  const { nodes, links } = useMemo(() => {
    const tickerMap = new Map<string, number>()
    const videoMap = new Map<string, number>()
    const videoThumbMap = new Map<string, string | null | undefined>()
    const videoTitleMap = new Map<string, string | undefined>()
    const videoUrlMap = new Map<string, string | undefined>()
    const links: Link[] = []

    for (const v of items || []) {
      if (!v?.video_id) continue
      if (!videoThumbMap.has(v.video_id)) videoThumbMap.set(v.video_id, v.thumbnail_url)
      if (!videoTitleMap.has(v.video_id)) videoTitleMap.set(v.video_id, v.title)
      if (!videoUrlMap.has(v.video_id)) videoUrlMap.set(v.video_id, v.video_url)
      let vw = 0
      for (const e of v.edges || []) {
        if (!e?.ticker) continue
        const sym = String(e.ticker).toUpperCase()
        const w = Math.max(1, e.key_points?.length || 0)
        tickerMap.set(sym, (tickerMap.get(sym) || 0) + w)
        vw += w
        links.push({
          source: v.video_id,
          target: sym,
          sentiment: (e.sentiment || 'neutral') as EdgeSentiment,
          weight: w,
        })
      }
      if (vw > 0) videoMap.set(v.video_id, vw)
    }

    const nodes: Node[] = []
    for (const [id, w] of videoMap)
      nodes.push({
        id,
        type: 'video',
        label: '',
        weight: w,
        thumbnailUrl: videoThumbMap.get(id),
        videoTitle: videoTitleMap.get(id),
        videoUrl: videoUrlMap.get(id),
      })
    for (const [id, w] of tickerMap) nodes.push({ id, type: 'ticker', label: id, weight: w })

    return { nodes, links }
  }, [items])

  const viz = useMemo(() => computeVizLayout(nodes.length, viewportHeight), [nodes.length, viewportHeight])

  useEffect(() => {
    const sel = nodeCircleSelectionRef.current
    if (!sel) return

    sel
      .attr('stroke', (d: Node) => (selectedNodeId && d.id === selectedNodeId ? 'var(--primary)' : 'var(--text)'))
      .attr('stroke-opacity', (d: Node) => (selectedNodeId && d.id === selectedNodeId ? 0.85 : 0.25))
      .attr('stroke-width', (d: Node) => (selectedNodeId && d.id === selectedNodeId ? 2 : 1))
  }, [selectedNodeId])

  /** ---------- D3 force simulation ---------- */
  useEffect(() => {
    if (!svgRef.current) return

    const W = viz.width
    const H = viz.height

    const svg = select(svgRef.current)
    svg.selectAll('*').remove()

    const linkG = svg.append('g').attr('opacity', 0.6)
    const nodeG = svg.append('g')

    const sim = forceSimulation(nodes as any)
      .force(
        'link',
        forceLink(links as any)
          .id((d: any) => d.id)
          .distance(viz.linkDistance)
          .strength(0.7),
      )
      .force('charge', forceManyBody().strength(viz.chargeStrength))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collision', forceCollide().radius((d: any) => radius(d) + viz.collisionPadding).strength(0.9))

    const linkEls = linkG
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke-width', (d: any) => Math.sqrt(d.weight))
      .attr('stroke', (d: any) => sentimentColor(d.sentiment))

    const nodeEls = nodeG
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('tabindex', (d: Node) => (d.type === 'video' || d.type === 'ticker' ? 0 : -1))
      .attr('role', (d: Node) => (d.type === 'video' || d.type === 'ticker' ? 'button' : null))
      .attr('aria-label', (d: Node) => {
        if (d.type === 'video') return (d as VideoNode).videoTitle || 'Open video insight'
        return `Ticker ${d.label}`
      })
      .call(drag<any, any>()
        .on('start', dragStart)
        .on('drag', dragged)
        .on('end', dragEnd),
      )

    nodeEls
      .filter((d: Node) => d.type === 'video')
      .on('click', (event: any, d: Node) => {
        const id = (d as VideoNode).id
        if (!id) return
        onSelectVideoRef.current?.(id)
      })
      .on('keydown', (event: any, d: Node) => {
        const id = (d as VideoNode).id
        if (!id) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelectVideoRef.current?.(id)
        }
      })

    nodeEls
      .filter((d: Node) => d.type === 'ticker')
      .on('click', (event: any, d: Node) => {
        const sym = String(d.label || '').trim().toUpperCase()
        if (!sym) return
        onSelectTickerRef.current?.(sym)
      })
      .on('keydown', (event: any, d: Node) => {
        const sym = String(d.label || '').trim().toUpperCase()
        if (!sym) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelectTickerRef.current?.(sym)
        }
      })

    nodeEls
      .append('defs')
      .append('clipPath')
      .attr('id', (d: Node) => `clip-${d.id}`)
      .append('circle')
      .attr('r', (d: Node) => radius(d))

    const circleEls = nodeEls
      .append('circle')
      .attr('r', (d: Node) => radius(d))
      .attr('fill', (d: Node) => {
        if (d.type === 'video') return 'var(--node-video)'
        const overall = tickerOverallBySymbol.get(d.label) || 'neutral'
        return sentimentColor(overall)
      })
      .attr('opacity', (d: Node) => (d.type === 'video' ? 0.55 : 0.65))
      .attr('stroke', 'var(--text)')
      .attr('stroke-opacity', 0.25)
      .attr('stroke-width', 1)

    nodeCircleSelectionRef.current = circleEls

    nodeEls
      .append('title')
      .text((d: Node) => (d.type === 'video' ? (d as VideoNode).videoTitle || d.id : d.label))

    // Video thumbnail inside bubble
    nodeEls
      .filter((d: Node) => d.type === 'video')
      .append('image')
      .attr('href', (d: Node) => (d.type === 'video' ? d.thumbnailUrl || '' : ''))
      .attr('x', (d: Node) => -radius(d))
      .attr('y', (d: Node) => -radius(d))
      .attr('width', (d: Node) => radius(d) * 2)
      .attr('height', (d: Node) => radius(d) * 2)
      .attr('clip-path', (d: Node) => `url(#clip-${d.id})`)

    nodeEls
      .append('text')
      .text((d: Node) => d.label)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', 11)
      .attr('fill', 'var(--text)')

    sim.on('tick', () => {
      // Keep nodes fully inside the viewBox (no bubbles crossing the edges)
      for (const d of nodes as any[]) {
        const r = radius(d)
        d.x = clamp(d.x, r, W - r)
        d.y = clamp(d.y, r, H - r)
      }

      linkEls
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      nodeEls.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
    })

    function clamp(v: number | undefined, lo: number, hi: number) {
      if (!Number.isFinite(v as number)) return (lo + hi) / 2
      return Math.max(lo, Math.min(hi, v as number))
    }

    function dragStart(event: any) {
      if (!event.active) sim.alphaTarget(0.3).restart()
      event.subject.fx = event.subject.x
      event.subject.fy = event.subject.y
    }
    function dragged(event: any) {
      event.subject.fx = event.x
      event.subject.fy = event.y
    }
    function dragEnd(event: any) {
      if (!event.active) sim.alphaTarget(0)
      event.subject.fx = null
      event.subject.fy = null
    }

    return () => {
      sim.stop()
    }
  }, [nodes, links, viz, tickerOverallBySymbol])

  return (
    <div className={styles.infographicWrap}>
      <div
        className={styles.infographicHeader}
        onClick={onHeaderClick}
        onKeyDown={onHeaderKeyDown}
        role={enablePopout ? 'button' : undefined}
        tabIndex={enablePopout ? 0 : -1}
        style={enablePopout ? { cursor: 'pointer' } : undefined}
        title={enablePopout ? 'Open ticker in new tab' : undefined}
      >
        <div className={styles.infographicTitle}>Ticker – Bubble Graph</div>
        {showRangeLabel ? <div className={cn(util.muted, util.small)}>Last {days} days</div> : null}
      </div>

      <div className={styles.infographicBody}>
        <div className={styles.infographicViz}>
          <svg ref={svgRef} viewBox={`0 0 ${viz.width} ${viz.height}`} width="100%" height={viz.height} />
        </div>

        <div className={styles.infographicStats}>
          <div className={styles.infographicStatsTitle}>Tickers</div>
          <div className={cn(styles.infographicStatsSub, util.muted, util.small)}>Sorted by # positive videos</div>
          <div className={styles.infographicStatsList} style={{ maxHeight: viz.height }}>
            {tickerStats.length ? (
              tickerStats.map((t) => (
                <div key={t.symbol} className={styles.infographicStatsRow}>
                  <button
                    type="button"
                    className={styles.infographicStatsSymbolButton}
                    onClick={() => onSelectTicker?.(t.symbol)}
                    title={`View ${t.symbol} keypoints`}
                  >
                    {t.symbol}
                  </button>
                  <div className={cn(styles.infographicStatsNums, util.small)}>
                    <span className={util.muted}>mentions {t.mentions}</span>
                    <span className={styles.infographicStatsPos}>+ {t.positiveVideos}</span>
                    <span className={styles.infographicStatsNeu}>• {t.neutralVideos}</span>
                    <span className={styles.infographicStatsNeg}>- {t.negativeVideos}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className={cn(util.muted, util.small)}>No ticker data.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function computeVizLayout(nodeCount: number, viewportHeight: number) {
  const width = 920
  const baseHeight = 520
  const extraHeight = Math.max(0, nodeCount - 30) * 8
  const desiredHeight = baseHeight + extraHeight
  const maxHeight = Math.max(420, Math.min(820, Math.floor(viewportHeight * 0.65)))
  const height = Math.min(maxHeight, desiredHeight)

  // More nodes => slightly more room + a bit less aggressive repulsion.
  const linkDistance = nodeCount > 90 ? 70 : 90
  const chargeStrength = nodeCount > 90 ? -150 : -210
  const collisionPadding = nodeCount > 90 ? 6 : 10

  return { width, height, linkDistance, chargeStrength, collisionPadding }
}

function radius(d: { weight: number; type: 'video' | 'ticker' }) {
  const base = d.type === 'video' ? 8 : 12
  const scale = d.type === 'video' ? 2.4 : 3.2
  const cap = d.type === 'video' ? 34 : 38
  return Math.min(cap, base + scale * Math.sqrt(d.weight))
}

function sentimentColor(s: EdgeSentiment) {
  if (s === 'positive') return 'var(--sent-pos)'
  if (s === 'negative') return 'var(--sent-neg)'
  return 'var(--sent-neu)'
}
