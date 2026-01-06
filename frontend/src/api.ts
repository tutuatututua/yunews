import type { DailyAnomalousChunk, DailySummary, EntityChunkRow, VideoDetail, VideoListItem } from './types'

const BASE = (import.meta.env.VITE_BACKEND_BASE_URL as string) || 'http://localhost:8080'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
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

export async function fetchVideos(date?: string): Promise<VideoListItem[]> {
  const qs = new URLSearchParams()
  if (date) qs.set('date', date)
  qs.set('limit', '50')
  const r = await getJson<{ data: VideoListItem[] }>(`/videos?${qs.toString()}`)
  return r.data
}

export async function fetchVideoDetail(id: string): Promise<VideoDetail | null> {
  const r = await getJson<{ data: VideoDetail | null }>(`/videos/${encodeURIComponent(id)}`)
  return r.data
}

export async function fetchDailyAnomalies(
  marketDate: string,
  opts?: { limit?: number; threshold?: number },
): Promise<DailyAnomalousChunk[]> {
  const qs = new URLSearchParams()
  if (opts?.limit != null) qs.set('limit', String(opts.limit))
  if (opts?.threshold != null) qs.set('threshold', String(opts.threshold))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const r = await getJson<{ data: DailyAnomalousChunk[] }>(
    `/daily-summaries/${encodeURIComponent(marketDate)}/anomalies${suffix}`,
  )
  return r.data
}

export async function fetchEntityChunks(
  symbol: string,
  opts?: { date?: string; limit?: number; includeAnomalous?: boolean; anomalyThreshold?: number },
): Promise<EntityChunkRow[]> {
  const qs = new URLSearchParams()
  if (opts?.date) qs.set('date', opts.date)
  if (opts?.limit != null) qs.set('limit', String(opts.limit))
  if (opts?.includeAnomalous != null) qs.set('include_anomalous', String(opts.includeAnomalous))
  if (opts?.anomalyThreshold != null) qs.set('anomaly_threshold', String(opts.anomalyThreshold))

  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const r = await getJson<{ data: EntityChunkRow[] }>(
    `/entities/${encodeURIComponent(symbol)}/chunks${suffix}`,
  )
  return r.data
}
