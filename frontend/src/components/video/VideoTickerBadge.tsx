import React from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'
import styles from './VideoDetailPanel.module.css'

export type EdgeSentiment = 'positive' | 'negative' | 'neutral'

function buildTickerHref(symbol: string, days: number): string {
  const sym = String(symbol || '').trim().toUpperCase()
  return `/ticker?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(String(days))}`
}

export default function VideoTickerBadge(props: {
  symbol: string
  days: number
  sentiment?: EdgeSentiment | null
  selected?: boolean
  asLink?: boolean
  title?: string
  onClick?: () => void
}) {
  const sym = String(props.symbol || '').trim().toUpperCase()
  if (!sym) return null

  const sentiment = props.sentiment || null
  const className = cn(
    styles.edgeChip,
    sentiment ? styles[`edgeChip_${sentiment}`] : null,
    props.selected ? styles.edgeChipSelected : null,
  )

  const title = props.title
  const onClick = props.onClick

  if (props.asLink === false) {
    return (
      <span className={className} title={title} onClick={onClick}>
        {sym}
      </span>
    )
  }

  return (
    <Link className={className} title={title} to={buildTickerHref(sym, props.days)} onClick={onClick}>
      {sym}
    </Link>
  )
}
