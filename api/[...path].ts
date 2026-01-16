declare const process: { env: Record<string, string | undefined> }

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
  url?: string
  body?: unknown
}

type Res = {
  status: (code: number) => Res
  setHeader: (name: string, value: string) => void
  json: (body: unknown) => void
  send: (body: unknown) => void
}

function normalizeBaseUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null

  return url.toString().replace(/\/+$/, '')
}

function pickBackendBaseUrl(): string | null {
  // Prefer a server-only env var so you don't accidentally expose internals.
  // (We also support VITE_BACKEND_BASE_URL as a fallback.)
  return (
    normalizeBaseUrl(process.env.BACKEND_BASE_URL) ??
    normalizeBaseUrl(process.env.VITE_BACKEND_BASE_URL)
  )
}

function buildTargetUrl(req: Req, baseUrl: string): string {
  const pathParam = req.query.path
  const path = Array.isArray(pathParam) ? pathParam.join('/') : String(pathParam ?? '')

  const reqUrl = req.url ?? ''
  const queryIndex = reqUrl.indexOf('?')
  const search = queryIndex >= 0 ? reqUrl.slice(queryIndex) : ''

  return `${baseUrl}/${path}${search}`
}

function sanitizeHeaders(headers: Req['headers']): Record<string, string> {
  const blocked = new Set([
    'host',
    'connection',
    'content-length',
    'accept-encoding',
    'x-forwarded-proto',
    'x-forwarded-host',
    'x-forwarded-for',
  ])

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (blocked.has(lower)) continue
    if (value == null) continue
    out[key] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return out
}

function coerceBody(req: Req): string | undefined {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return undefined

  const body = req.body
  if (body == null) return undefined

  if (typeof body === 'string') return body

  // Vercel may give parsed JSON.
  return JSON.stringify(body)
}

export default async function handler(req: Req, res: Res) {
  const baseUrl = pickBackendBaseUrl()
  if (!baseUrl) {
    res.status(500).json({
      error: 'Missing BACKEND_BASE_URL env var (server-side).',
      hint: 'Set BACKEND_BASE_URL to your public backend origin, e.g. https://api.example.com',
    })
    return
  }

  const targetUrl = buildTargetUrl(req, baseUrl)
  const headers = sanitizeHeaders(req.headers)

  // If we stringified a JSON object, ensure content-type is set.
  const body = coerceBody(req)
  if (body && typeof body === 'string' && !headers['content-type'] && !headers['Content-Type']) {
    headers['content-type'] = 'application/json'
  }

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
    redirect: 'manual',
  })

  res.status(upstream.status)
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'transfer-encoding') return
    res.setHeader(key, value)
  })
  res.setHeader('x-proxied-by', 'vercel')

  const bytes = new Uint8Array(await upstream.arrayBuffer())
  res.send(bytes)
}
