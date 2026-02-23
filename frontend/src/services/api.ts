import type {
  ChatHistoryMessage,
  ChatRetrievalChunk,
  ChatSource,
  ChatStreamEvent,
  DailySummary,
  EntityChunkRow,
  QueryPlan,
  TopMover,
  VideoDetail,
  VideoInfographicItem,
  VideoListItem,
  YoutuberRecommendationEvent,
  YoutuberRecommendationListData,
  YoutuberRecommendationOverlay,
} from '../types'

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
  const timeoutMs = opts?.timeoutMs ?? 15_000

  // Prefer native request timeouts without timers to avoid CSP/security scanner flags.
  // If AbortSignal.timeout is not supported, we proceed without a client-side timeout.
  const timeoutFn = (AbortSignal as any)?.timeout as ((ms: number) => AbortSignal) | undefined
  const signal = timeoutFn ? timeoutFn(timeoutMs) : undefined

  let res: Response
  try {
    res = await fetch(buildUrl(path), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    const code = (err as any)?.name === 'AbortError' ? 'timeout' : 'network_error'
    throw new ApiRequestError({ status: 0, code, message })
  }

  const { text, json } = await readResponseBody(res)
  const headerRequestId = res.headers.get('x-request-id') || undefined

  if (!res.ok) {
    const env = (json && typeof json === 'object' ? (json as BackendErrorEnvelope) : null) || null
    const code = env?.error?.code || 'http_error'
    const message = env?.error?.message || text || `HTTP ${res.status}`
    throw new ApiRequestError({
      status: res.status,
      code,
      message,
      requestId: env?.error?.request_id || headerRequestId,
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

export async function fetchDailySummary(marketDate: string): Promise<DailySummary | null> {
  const safe = encodeURIComponent(marketDate)
  const r = await getJson<{ data: DailySummary | null }>(`/daily-summaries/${safe}`)
  return r.data
}

export async function fetchDailySummaries(limit: number = 120): Promise<DailySummary[]> {
  const qs = new URLSearchParams()
  qs.set('limit', String(limit))
  const r = await getJson<{ data: DailySummary[] }>(`/daily-summaries?${qs.toString()}`)
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
  opts?: { days?: number; limit?: number },
): Promise<EntityChunkRow[]> {
  const qs = new URLSearchParams()
  if (opts?.days != null) qs.set('days', String(opts.days))
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

export async function fetchYoutuberRecommendationOverlay(symbol: string, opts?: { days?: number }): Promise<YoutuberRecommendationOverlay> {
  const qs = new URLSearchParams()
  qs.set('symbol', String(symbol || '').trim().toUpperCase())
  if (opts?.days != null) qs.set('days', String(opts.days))
  const r = await getJson<{ data: YoutuberRecommendationOverlay }>(`/youtuber-recommendations/overlay?${qs.toString()}`)
  return r.data
}

export async function fetchYoutuberRecommendations(opts?: {
  symbol?: string
  days?: number
  limit?: number
}): Promise<YoutuberRecommendationEvent[]> {
  const qs = new URLSearchParams()
  if (opts?.symbol) qs.set('symbol', String(opts.symbol).trim().toUpperCase())
  if (opts?.days != null) qs.set('days', String(opts.days))
  qs.set('limit', String(opts?.limit ?? 200))
  const r = await getJson<{ data: YoutuberRecommendationListData }>(`/youtuber-recommendations?${qs.toString()}`)
  return r.data.items || []
}

export async function streamChat(args: {
  question: string
  history: ChatHistoryMessage[]
  onQueryPlan?: (queryPlan: QueryPlan) => void
  onSources?: (sources: ChatSource[]) => void
  onRetrieval?: (payload: { chunks: ChatRetrievalChunk[]; context?: string }) => void
  onDelta: (delta: string) => void
  onDone?: () => void
}): Promise<void> {
  const res = await fetch(buildUrl(`/chat`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ question: args.question, history: args.history }),
  })

  const ct = res.headers.get('content-type') || ''
  if (res.ok && ct.includes('text/html')) {
    // Common Vercel misconfig: the SPA rewrite returns index.html for `/api/*`.
    // In that case the backend base URL is wrong (or backend isn't deployed).
    throw new Error(
      'Chat backend misconfigured (received HTML). On Vercel, set VITE_BACKEND_BASE_URL to your backend deployment URL (e.g. https://<backend>.vercel.app).',
    )
  }

  if (!res.ok) {
    const { text } = await readResponseBody(res)
    throw new Error(text || `HTTP ${res.status}`)
  }

  const body = res.body
  if (!body) {
    throw new Error('Missing response body')
  }

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const emit = (evt: ChatStreamEvent) => {
    if (evt.type === 'sources') args.onSources?.(evt.sources || [])
    if (evt.type === 'query_plan') args.onQueryPlan?.(evt.query_plan)
    if (evt.type === 'retrieval') args.onRetrieval?.({ chunks: evt.chunks || [], context: evt.context })
    if (evt.type === 'delta') args.onDelta(evt.delta || '')
    if (evt.type === 'done') args.onDone?.()
    if (evt.type === 'error') {
      const base = evt.message || 'Chat error'
      const hint = evt.details?.hint ? `Hint: ${evt.details.hint}` : ''
      const fix = evt.details?.fix ? `Fix: ${evt.details.fix}` : ''
      const rid = evt.details?.request_id ? `Request ID: ${evt.details.request_id}` : ''
      const extra = [hint, fix, rid].filter(Boolean).join('\n')
      throw new Error(extra ? `${base}\n${extra}` : base)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const idx = buffer.indexOf('\n\n')
      if (idx === -1) break

      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      // SSE event can have multiple lines; we only care about data:
      const dataLines = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice('data:'.length).trim())

      if (dataLines.length === 0) continue
      const data = dataLines.join('\n')

      let parsed: any
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }

      emit(parsed as ChatStreamEvent)
    }
  }
}
