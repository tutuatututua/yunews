import type { RecommendationEvent, RecommendationListData, RecommendationOverlay } from '../../types'
import { apiGet } from '../../api/client'

export async function fetchRecommendationOverlay(symbol: string, opts?: { days?: number }): Promise<RecommendationOverlay> {
  const qs = new URLSearchParams()
  qs.set('symbol', String(symbol || '').trim().toUpperCase())
  if (opts?.days != null) qs.set('days', String(opts.days))
  const r = await apiGet<{ data: RecommendationOverlay }>(`/recommendations/overlay?${qs.toString()}`)
  return r.data
}

export async function fetchRecommendationsList(opts?: {
  symbol?: string
  days?: number
  limit?: number
}): Promise<RecommendationEvent[]> {
  const qs = new URLSearchParams()
  if (opts?.symbol) qs.set('symbol', String(opts.symbol).trim().toUpperCase())
  if (opts?.days != null) qs.set('days', String(opts.days))
  qs.set('limit', String(opts?.limit ?? 200))
  const r = await apiGet<{ data: RecommendationListData }>(`/recommendations?${qs.toString()}`)
  return r.data.items || []
}
