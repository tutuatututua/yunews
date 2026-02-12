import React from 'react'
import { MessageCircle, X } from 'lucide-react'
import styles from './ChatWidget.module.css'
import { streamChat } from '../../services/api'
import type { QueryPlan } from '../../types'

type Role = 'user' | 'assistant'

type Source = {
  chunk?: number | null
  document_type: string
  ticker?: string | null
  video_title?: string | null
  thumbnail_url?: string | null
  similarity?: number | null
}

type ChatMessage = {
  id: string
  role: Role
  content: string
  sources?: Source[]
  retrievalContext?: string
  queryPlan?: QueryPlan
  retrievalChunks?: Array<{
    document_type: string
    ticker?: string | null
    video_title?: string | null
    thumbnail_url?: string | null
    similarity?: number | null
    text: string
  }>
}

function uid() {
  return Math.random().toString(36).slice(2)
}

export function ChatWidget() {
  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const pendingSourcesRef = React.useRef<Source[] | undefined>(undefined)
  const pendingRetrievalRef = React.useRef<ChatMessage['retrievalChunks'] | undefined>(undefined)
  const pendingRetrievalContextRef = React.useRef<string | undefined>(undefined)
  const pendingQueryPlanRef = React.useRef<QueryPlan | undefined>(undefined)

  const scrollerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [open, messages, loading])

  const send = async () => {
    const q = input.trim()
    if (!q || loading) return

    const nextUser: ChatMessage = { id: uid(), role: 'user', content: q }
    const assistantId = uid()
    const nextAssistant: ChatMessage = { id: assistantId, role: 'assistant', content: '' }

    setMessages((prev) => [...prev, nextUser, nextAssistant])
    setInput('')
    setLoading(true)
    pendingSourcesRef.current = undefined
    pendingRetrievalRef.current = undefined
    pendingRetrievalContextRef.current = undefined
    pendingQueryPlanRef.current = undefined

    const history = [...messages, nextUser]
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      await streamChat({
        question: q,
        history,
        onQueryPlan: (qp) => {
          pendingQueryPlanRef.current = qp
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, queryPlan: qp } : m)))
        },
        onSources: (src) => {
          pendingSourcesRef.current = src as any
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, sources: src as any } : m)),
          )
        },
        onRetrieval: (chunks) => {
          // Backward/forward compatible: backend may send either an array of chunks
          // or an object with { chunks, context }.
          const payload = Array.isArray(chunks) ? { chunks } : (chunks as any)

          const parsedChunks = (payload?.chunks ?? payload) as any
          pendingRetrievalRef.current = parsedChunks
          pendingRetrievalContextRef.current = typeof payload?.context === 'string' ? payload.context : undefined
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    retrievalContext: pendingRetrievalContextRef.current,
                    retrievalChunks: parsedChunks,
                  }
                : m,
            ),
          )
        },
        onDelta: (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: (m.content || '') + delta } : m)),
          )
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    sources: pendingSourcesRef.current,
                    retrievalContext: pendingRetrievalContextRef.current,
                    retrievalChunks: pendingRetrievalRef.current,
                    queryPlan: pendingQueryPlanRef.current,
                  }
                : m,
            ),
          )
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat request failed'
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `Error: ${msg}` } : m)),
      )
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <>
      {open && (
        <div className={styles.panel} aria-label="Chat panel">
          <div className={styles.header}>
            <div className={styles.title}>Ask yuNews</div>
            <button type="button" className={styles.iconButton} aria-label="Close chat" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className={styles.messages} ref={scrollerRef}>
            {messages.length === 0 ? (
              <div className={`${styles.bubble} ${styles.assistant}`}>Ask about a ticker or recent themes.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}>
                  {m.content}
                  {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                    <div className={styles.sources}>
                      Sources:{' '}
                      {m.sources
                        .filter((s) => s.video_title)
                        .slice(0, 5)
                        .map((s, i) => (
                          <div key={`${s.video_title}-${i}`}>
                            {typeof s.chunk === 'number' ? <span>[#{s.chunk}] </span> : null}
                            {s.thumbnail_url ? (
                              <img src={s.thumbnail_url} alt="" loading="lazy" decoding="async" />
                            ) : null}{' '}
                            <span>{s.video_title}</span>
                            {typeof s.similarity === 'number' ? <span> (sim {s.similarity.toFixed(3)})</span> : null}
                          </div>
                        ))}
                    </div>
                  )}

                  {m.role === 'assistant' && m.queryPlan && (
                    <div className={styles.retrieval}>
                      <details>
                        <summary>Query plan</summary>
                        <pre>
{`rewritten_prompt=${m.queryPlan.rewritten_prompt || ''}
stock_related=${m.queryPlan.is_stock_related ? 'true' : 'false'}
tickers=${Array.isArray(m.queryPlan.tickers) && m.queryPlan.tickers.length > 0 ? m.queryPlan.tickers.join(',') : '-'}`}
                        </pre>
                      </details>
                    </div>
                  )}

                  {m.role === 'assistant' && ((m.retrievalContext && m.retrievalContext.trim()) || (m.retrievalChunks && m.retrievalChunks.length > 0)) && (
                    <div className={styles.retrieval}>
                      <details>
                        <summary>What the model read</summary>
                        <pre>
{m.retrievalContext ? `${m.retrievalContext}` : ''}

{m.retrievalChunks && m.retrievalChunks.length > 0
  ? `\n\n---\n\n${m.retrievalChunks
      .map((c, idx) => {
        const sim = typeof c.similarity === 'number' ? `similarity=${c.similarity.toFixed(3)}` : null
        const header = [
          `#${idx + 1}`,
          `type=${c.document_type}`,
          c.ticker ? `ticker=${c.ticker}` : null,
          c.video_title ? `video=${c.video_title}` : null,
          c.thumbnail_url ? `thumbnail_url=${c.thumbnail_url}` : null,
          sim,
        ]
          .filter(Boolean)
          .join(' ')
        return `${header}\n${c.text}`
      })
      .join('\n\n')}`
  : ''}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {loading && <div className={styles.loading}>Streaming response…</div>}

          <div className={styles.composer}>
            <textarea
              className={styles.input}
              placeholder="Ask: What did the video say about Tesla?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading}
            />
            <button type="button" className={styles.send} onClick={() => void send()} disabled={loading || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className={styles.floatingButton}
        aria-label={open ? 'Close chat' : 'Open chat'}
        onClick={() => setOpen((v) => !v)}
      >
        <MessageCircle size={20} />
      </button>
    </>
  )
}
