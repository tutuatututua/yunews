import { useQuery } from '@tanstack/react-query'
import type { RecommendationEvent, RecommendationOverlay } from '../../types'
import { fetchRecommendationOverlay, fetchRecommendationsList } from './api'

export function useRecommendationOverlay(symbol: string | null, opts?: { days?: number }, enabled: boolean = true) {
  const sym = symbol ? String(symbol).trim().toUpperCase() : null
  return useQuery<RecommendationOverlay>({
    queryKey: ['recoOverlay', sym ?? null, opts?.days ?? null],
    queryFn: () => fetchRecommendationOverlay(sym as string, { days: opts?.days }),
    enabled: !!sym && enabled,
    staleTime: 60_000,
  })
}

export function useRecommendationsList(opts?: { symbol?: string; days?: number; limit?: number }, enabled: boolean = true) {
  const sym = opts?.symbol ? String(opts.symbol).trim().toUpperCase() : undefined
  const days = opts?.days ?? 365
  const limit = opts?.limit ?? 200

  return useQuery<RecommendationEvent[]>({
    queryKey: ['recoList', sym ?? null, days, limit],
    queryFn: () => fetchRecommendationsList({ symbol: sym, days, limit }),
    enabled,
    staleTime: 60_000,
  })
}
