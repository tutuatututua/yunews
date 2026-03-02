import { useQuery } from '@tanstack/react-query'

import { fetchVideoDetail, fetchVideoInfographic, fetchVideos } from './api'

export function useVideos(anchorDate: string | undefined, days: number, limit: number, enabled: boolean = true) {
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
