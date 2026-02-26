import React from 'react'
import styles from './ChatPanel.module.css'
import { useChatPanelController } from './useChatPanelController'
import type { ChatMessage } from './chatTypes'

function getVisibleSources(m: ChatMessage) {
  return (m.sources || []).filter((s) => s.video_title).slice(0, 5)
}

function formatQueryPlanText(m: ChatMessage): string {
  const qp = m.queryPlan
  if (!qp) return ''
  const tickers = Array.isArray(qp.tickers) && qp.tickers.length > 0 ? qp.tickers.join(',') : '-'
  return `rewritten_prompt=${qp.rewritten_prompt || ''}\nstock_related=${qp.is_stock_related ? 'true' : 'false'}\ntickers=${tickers}`
}

function formatRetrievalText(m: ChatMessage): string {
  const context = m.retrievalContext ? String(m.retrievalContext) : ''
  const chunks = m.retrievalChunks || []
  const chunksText =
    chunks.length > 0
      ? `\n\n---\n\n${chunks
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
      : ''

  return `${context}${chunksText}`.trim()
}

export function ChatPanel() {
  const { messages, input, isStreaming, setInput, send, resetChat } = useChatPanelController()

  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)

  React.useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, isStreaming])

  React.useEffect(() => {
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [])

  const onReset = React.useCallback(() => {
    resetChat()
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [resetChat])

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <section className={styles.panel} aria-label="Chat">
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Ask yuNews</div>
          <div className={styles.subtitle}>Ask about stocks, themes, or what videos said recently.</div>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.textButton}
            aria-label="New chat"
            onClick={onReset}
            disabled={isStreaming || messages.length === 0}
          >
            New
          </button>
        </div>
      </div>

      <div className={styles.messages} ref={scrollerRef}>
        {messages.length === 0 ? (
          <div className={`${styles.bubble} ${styles.assistant}`}>Try: “What did the video say about Tesla?”</div>
        ) : (
          messages.map((m) => {
            const visibleSources = getVisibleSources(m)
            const queryPlanText = formatQueryPlanText(m)
            const retrievalText =
              (m.retrievalContext && m.retrievalContext.trim()) || (m.retrievalChunks && m.retrievalChunks.length > 0)
                ? formatRetrievalText(m)
                : null

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
                                {typeof s.chunk === 'number' ? <span className={styles.badge}>#{s.chunk}</span> : null}
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
                      <pre>{queryPlanText}</pre>
                    </details>
                  </div>
                )}

                {m.role === 'assistant' && retrievalText && (
                  <div className={styles.retrieval}>
                    <details>
                      <summary>What the model read</summary>
                      <pre>{retrievalText}</pre>
                    </details>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {isStreaming && <div className={styles.loading}>Streaming response…</div>}
      <div className={styles.caution} role="note">
        Caution: Responses use only the latest 7 days of data and are not financial advice.
      </div>
      <div className={styles.composer}>
        <textarea
          className={styles.input}
          placeholder="What did the video say about Tesla?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isStreaming}
          ref={inputRef}
        />
        <button
          type="button"
          className={styles.send}
          onClick={() => void send()}
          disabled={isStreaming || !input.trim()}
        >
          Send
        </button>
      </div>
    </section>
  )
}
