import React from 'react'
import { MessageCircle, X } from 'lucide-react'
import styles from './ChatWidget.module.css'
import { streamChat } from '../../services/api'
import type { ChatHistoryMessage, ChatRetrievalChunk, ChatSource, ChatRole, QueryPlan } from '../../types'

type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  sources?: ChatSource[]
  retrievalContext?: string
  queryPlan?: QueryPlan
  retrievalChunks?: ChatRetrievalChunk[]
}

function uid() {
  return Math.random().toString(36).slice(2)
}

const STORAGE_KEY = 'yunews_chat_widget_v1'

type PersistedChatState = {
  v: 1
  open: boolean
  messages: ChatMessage[]
}

export function ChatWidget() {
  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const didInitRef = React.useRef(false)

  const pendingSourcesRef = React.useRef<ChatSource[] | undefined>(undefined)
  const pendingRetrievalRef = React.useRef<ChatMessage['retrievalChunks'] | undefined>(undefined)
  const pendingRetrievalContextRef = React.useRef<string | undefined>(undefined)
  const pendingQueryPlanRef = React.useRef<QueryPlan | undefined>(undefined)

  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)

  const resetChat = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
    }
    setMessages([])
    setInput('')
    setLoading(false)
    pendingSourcesRef.current = undefined
    pendingRetrievalRef.current = undefined
    pendingRetrievalContextRef.current = undefined
    pendingQueryPlanRef.current = undefined
  }, [])

  React.useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    if (typeof window === 'undefined') return

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as PersistedChatState
      if (!parsed || parsed.v !== 1) return
      if (Array.isArray(parsed.messages)) setMessages(parsed.messages)
      if (typeof parsed.open === 'boolean') setOpen(parsed.open)
    } catch {
      // ignore corrupt storage
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const payload: PersistedChatState = {
        v: 1,
        open,
        messages: messages.slice(-50),
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // ignore quota / storage errors
    }
  }, [open, messages])

  React.useEffect(() => {
    if (!open) return
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [open, messages, loading])

  React.useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

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

    const history: ChatHistoryMessage[] = [...messages, nextUser]
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
          pendingSourcesRef.current = src
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, sources: src } : m)))
        },
        onRetrieval: (chunks) => {
          const payload = chunks
          const parsedChunks = payload.chunks
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
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.textButton}
                aria-label="New chat"
                onClick={resetChat}
                disabled={loading || messages.length === 0}
              >
                New
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close chat"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className={styles.caution} role="note">
            Caution: Responses use only the latest 7 days of data and not a financial advice.
          </div>

          <div className={styles.messages} ref={scrollerRef}>
            {messages.length === 0 ? (
              <div className={`${styles.bubble} ${styles.assistant}`}>Ask about a ticker or recent themes.</div>
            ) : (
              messages.map((m) => {
                const visibleSources = (m.sources || []).filter((s) => s.video_title).slice(0, 5)

                return (
                  <div key={m.id} className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}>
                    <div className={styles.messageText}>{m.content}</div>
                    {m.role === 'assistant' && visibleSources.length > 0 && (
                      <div className={styles.sources}>
                        <details className={styles.sourcesDetails}>
                          <summary className={styles.sourcesSummary}>Sources ({visibleSources.length})</summary>
                          <div className={styles.sourcesList}>
                            {visibleSources.map((s, i) => (
                              <div key={`${s.video_title}-${i}`} className={styles.sourceItem}>
                                {s.thumbnail_url ? (
                                  <img
                                    className={styles.sourceThumb}
                                    src={s.thumbnail_url}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div className={styles.sourceThumbPlaceholder} aria-hidden="true" />
                                )}
                                <div className={styles.sourceBody}>
                                  <div className={styles.sourceTitle}>{s.video_title}</div>
                                  <div className={styles.sourceMeta}>
                                    {typeof s.chunk === 'number' ? (
                                      <span className={styles.badge}>#{s.chunk}</span>
                                    ) : null}
                                    {typeof s.similarity === 'number' ? (
                                      <span className={styles.badge}>sim {s.similarity.toFixed(3)}</span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
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
                )
              })
            )}
          </div>

          {loading && <div className={styles.loading}>Streaming response…</div>}

          <div className={styles.composer}>
            <textarea
              className={styles.input}
              placeholder="What did the video say about Tesla?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading}
              ref={inputRef}
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
