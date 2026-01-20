import type { DailySummary, EntityChunkRow, TopMover, VideoDetail, VideoInfographicItem, VideoListItem } from '../types'

import { getBackendBaseUrl } from '../config/env'

const BASE = getBackendBaseUrl()

type BackendErrorEnvelope = {
  error?: {
    code?: string
    message?: string
    request_id?: string
    details?: unknown
  }
}

export class ApiRequestError extends Error {
  status: number
  code: string
  requestId?: string
  details?: unknown

  constructor(args: { status: number; code: string; message: string; requestId?: string; details?: unknown }) {
    super(args.message)
    this.name = 'ApiRequestError'
    this.status = args.status
    this.code = args.code
    this.requestId = args.requestId
    this.details = args.details
  }
}

function buildUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`API path must start with "/": ${path}`)
  }
  return `${BASE}${path}`
}

async function readResponseBody(res: Response): Promise<{ text: string; json: unknown | null }> {
  const ct = res.headers.get('content-type') || ''
  const text = await res.text()
  if (!text) return { text: '', json: null }
  if (!ct.includes('application/json')) return { text, json: null }
  try {
    return { text, json: JSON.parse(text) }
  } catch {
    return { text, json: null }
  }
}

async function getJson<T>(path: string, opts?: { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = opts?.timeoutMs ?? 15_000
  const t = window.setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(buildUrl(path), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (err) {
    window.clearTimeout(t)

    const message = err instanceof Error ? err.message : 'Network error'
    const code = (err as any)?.name === 'AbortError' ? 'timeout' : 'network_error'
    throw new ApiRequestError({ status: 0, code, message })
  }

  window.clearTimeout(t)

  const { text, json } = await readResponseBody(res)

  if (!res.ok) {
    const env = (json && typeof json === 'object' ? (json as BackendErrorEnvelope) : null) || null
    const code = env?.error?.code || 'http_error'
    const message = env?.error?.message || text || `HTTP ${res.status}`
    throw new ApiRequestError({
      status: res.status,
      code,
      message,
      requestId: env?.error?.request_id,
      details: env?.error?.details,
    })
  }

  if (json == null) {
    // Backend should always return JSON; handle unexpected plain-text responses.
    throw new ApiRequestError({ status: res.status, code: 'invalid_json', message: 'Invalid JSON response' })
  }

  return json as T
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
