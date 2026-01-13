import type { DailySummary, EntityChunkRow, TopMover, VideoDetail, VideoInfographicItem, VideoListItem } from '../types'

const BASE = (import.meta.env.VITE_BACKEND_BASE_URL as string) || 'http://localhost:8080'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export async function fetchLatestDailySummary(): Promise<DailySummary | null> {
  const r = await getJson<{ data: DailySummary | null }>(`/daily-summaries/latest`)
  return r.data
}

export async function fetchVideos(
  date?: string,
  opts?: { days?: number; limit?: number },
): Promise<VideoListItem[]> {
  const qs = new URLSearchParams()
  if (date) qs.set('date', date)
  if (opts?.days != null) qs.set('days', String(opts.days))
  qs.set('limit', String(opts?.limit ?? 50))
  const r = await getJson<{ data: VideoListItem[] }>(`/videos?${qs.toString()}`)
  return r.data
}

export async function fetchVideoInfographic(
  date?: string,
  opts?: { days?: number; limit?: number },
): Promise<VideoInfographicItem[]> {
  const qs = new URLSearchParams()
  if (date) qs.set('date', date)
  if (opts?.days != null) qs.set('days', String(opts.days))
  if (opts?.limit != null) qs.set('limit', String(opts.limit))

  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const r = await getJson<{ data: VideoInfographicItem[] }>(`/videos/infographic${suffix}`)
  return r.data
}

export async function fetchVideoDetail(id: string): Promise<VideoDetail | null> {
  const r = await getJson<{ data: VideoDetail | null }>(`/videos/${encodeURIComponent(id)}`)
  return r.data
}

export async function fetchEntityChunks(
  symbol: string,
  opts?: { days?: number; limit?: number; date?: string },
): Promise<EntityChunkRow[]> {
  const qs = new URLSearchParams()
  // Backend supports `days`; keep `date` as a no-op passthrough for older code.
  if (opts?.days != null) qs.set('days', String(opts.days))
  if (opts?.date) qs.set('date', opts.date)
  if (opts?.limit != null) qs.set('limit', String(opts.limit))

  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const r = await getJson<{ data: EntityChunkRow[] }>(
    `/entities/${encodeURIComponent(symbol)}/chunks${suffix}`,
  )
  return r.data
}

export async function fetchTopMovers(opts?: { days?: number; limit?: number; date?: string }): Promise<TopMover[]> {
  const qs = new URLSearchParams()
  if (opts?.date) qs.set('date', opts.date)
  if (opts?.days != null) qs.set('days', String(opts.days))
  if (opts?.limit != null) qs.set('limit', String(opts.limit))

  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const r = await getJson<{ data: TopMover[] }>(`/entities/top-movers${suffix}`)
  return r.data
}
