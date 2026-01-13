import { useQuery } from '@tanstack/react-query'
import type { DailySummary, TopMover, VideoDetail, VideoInfographicItem, VideoListItem } from '../types'
import { fetchLatestDailySummary, fetchTopMovers, fetchVideoDetail, fetchVideoInfographic, fetchVideos } from './api'

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

export type { DailySummary, TopMover, VideoDetail, VideoInfographicItem, VideoListItem }
