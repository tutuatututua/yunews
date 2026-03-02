import type {
  ChatHistoryMessage,
  ChatRetrievalChunk,
  ChatSource,
  ChatStreamEvent,
  QueryPlan,
} from '../../types'
import { getBackendBaseUrl } from '../../config/env'

export async function streamChat(args: {
  question: string
  history: ChatHistoryMessage[]
  signal?: AbortSignal
  onQueryPlan?: (queryPlan: QueryPlan) => void
  onSources?: (sources: ChatSource[]) => void
  onRetrieval?: (payload: { chunks: ChatRetrievalChunk[]; context?: string }) => void
  onDelta: (delta: string) => void
  onDone?: () => void
}): Promise<void> {
  const base = getBackendBaseUrl().replace(/\/+$/, '')
  const res = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ question: args.question, history: args.history }),
    signal: args.signal,
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
    let text = ''
    try {
      text = await res.text()
    } catch {
      // ignore
    }
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
