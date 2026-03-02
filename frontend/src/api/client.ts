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

export async function apiGet<T>(path: string, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 15_000

  // Prefer native request timeouts without timers.
  const timeoutFn = (AbortSignal as any)?.timeout as ((ms: number) => AbortSignal) | undefined
  const timeoutSignal = timeoutFn ? timeoutFn(timeoutMs) : undefined

  // If a caller supplies a signal (e.g. React Query cancellation), prefer it.
  // We intentionally avoid AbortSignal.any() for broader runtime compatibility.
  const signal = opts?.signal ?? timeoutSignal

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
    throw new ApiRequestError({ status: res.status, code: 'invalid_json', message: 'Invalid JSON response' })
  }

  return json as T
}
