import { useQuery } from '@tanstack/react-query'
import type { DailySummary, EntityChunkRow, TopMover, VideoDetail, VideoInfographicItem, VideoListItem } from '../types'
import {
  fetchEntityChunks,
  fetchLatestDailySummary,
  fetchTopMovers,
  fetchVideoDetail,
  fetchVideoInfographic,
  fetchVideos,
} from './api'

/**
 * Query hooks isolate server-contract details from UI components.
 * This keeps pages clean and makes it easy to add caching, pagination, and prefetching later.
 */

export function useLatestDailySummary() {
  return useQuery({
    queryKey: ['daily', 'latest'],
    queryFn: fetchLatestDailySummary,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
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
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
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
    refetchOnWindowFocus: true,
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
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  })
}

export type { DailySummary, EntityChunkRow, TopMover, VideoDetail, VideoInfographicItem, VideoListItem }
