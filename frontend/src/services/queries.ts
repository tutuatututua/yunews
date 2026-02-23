import { useQuery } from '@tanstack/react-query'
import type { EntityChunkRow, YoutuberRecommendationEvent, YoutuberRecommendationOverlay } from '../types'
import {
  fetchEntityChunks,
  fetchDailySummary,
  fetchDailySummaries,
  fetchLatestDailySummary,
  fetchTopMovers,
  fetchVideoDetail,
  fetchVideoInfographic,
  fetchVideos,
  fetchYoutuberRecommendations,
  fetchYoutuberRecommendationOverlay,
} from './api'

/**
 * Query hooks isolate server-contract details from UI components.
 * This keeps pages clean and makes it easy to add caching, pagination, and prefetching later.
 */

export function useLatestDailySummary() {
  return useQuery({
    queryKey: ['daily', 'latest'],
    queryFn: fetchLatestDailySummary,
  })
}

export function useDailySummary(marketDate?: string | null) {
  const key = marketDate ? marketDate : 'latest'
  return useQuery({
    queryKey: ['daily', key],
    queryFn: () => (marketDate ? fetchDailySummary(marketDate) : fetchLatestDailySummary()),
    refetchOnWindowFocus: !marketDate,
    refetchOnMount: marketDate ? false : 'always',
  })
}

export function useDailySummariesList(limit: number = 120) {
  return useQuery({
    queryKey: ['daily', 'list', limit],
    queryFn: () => fetchDailySummaries(limit),
  })
}

export function useVideos(
  anchorDate: string | undefined,
  days: number,
  limit: number,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['videos', anchorDate ?? null, days, limit],
    queryFn: () => fetchVideos(anchorDate, { days, limit }),
    enabled,
  })
}

export function useVideoInfographic(
  anchorDate: string | undefined,
  days: number,
  limit: number,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['infographic', anchorDate ?? null, days, limit],
    queryFn: () => fetchVideoInfographic(anchorDate, { days, limit }),
    enabled,
  })
}

export function useVideoDetail(selectedId: string | null) {
  return useQuery({
    queryKey: ['videoDetail', selectedId ?? null],
    queryFn: () => (selectedId ? fetchVideoDetail(selectedId) : Promise.resolve(null)),
    enabled: !!selectedId,
  })
}

export function useEntityChunks(
  symbol: string | null,
  opts?: { days?: number; limit?: number },
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['entityChunks', symbol ?? null, opts?.days ?? null, opts?.limit ?? null],
    queryFn: () => (symbol ? fetchEntityChunks(symbol, opts) : Promise.resolve([] as EntityChunkRow[])),
    enabled: !!symbol && enabled,
  })
}

export function useTopMovers(
  anchorDate: string | undefined,
  days: number,
  limit: number = 8,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['topMovers', anchorDate ?? null, days, limit],
    queryFn: () => fetchTopMovers({ date: anchorDate, days, limit }),
    enabled,
  })
}

export function useYoutuberRecommendationOverlay(symbol: string | null, opts?: { days?: number }, enabled: boolean = true) {
  const sym = symbol ? String(symbol).trim().toUpperCase() : null
  return useQuery<YoutuberRecommendationOverlay>({
    queryKey: ['youtuberRecoOverlay', sym ?? null, opts?.days ?? null],
    queryFn: () => fetchYoutuberRecommendationOverlay(sym as string, { days: opts?.days }),
    enabled: !!sym && enabled,
    staleTime: 60_000,
  })
}

export function useYoutuberRecommendationsList(
  opts?: { symbol?: string; days?: number; limit?: number },
  enabled: boolean = true,
) {
  const sym = opts?.symbol ? String(opts.symbol).trim().toUpperCase() : undefined
  const days = opts?.days ?? 365
  const limit = opts?.limit ?? 200

  return useQuery<YoutuberRecommendationEvent[]>({
    queryKey: ['youtuberRecoList', sym ?? null, days, limit],
    queryFn: () => fetchYoutuberRecommendations({ symbol: sym, days, limit }),
    enabled,
    staleTime: 60_000,
  })
}
