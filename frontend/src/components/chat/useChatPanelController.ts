import React from 'react'
import { streamChat } from '../../features/chat/api'
import type { ChatHistoryMessage, ChatRetrievalChunk, ChatSource, QueryPlan } from '../../types'
import { clearPersistedChat, readPersistedChatMessages, writePersistedChatMessages } from './chatStorage'
import type { ChatMessage } from './chatTypes'

type ChatPanelState = {
  messages: ChatMessage[]
  input: string
  isStreaming: boolean
}

type Action =
  | { type: 'setInput'; value: string }
  | { type: 'setStreaming'; value: boolean }
  | { type: 'reset' }
  | { type: 'appendMessages'; messages: ChatMessage[] }
  | { type: 'appendAssistantDelta'; id: string; delta: string }
  | { type: 'patchAssistant'; id: string; patch: Partial<Omit<ChatMessage, 'id' | 'role' | 'content'>> }
  | { type: 'setAssistantContent'; id: string; content: string }

function initialState(): ChatPanelState {
  return {
    messages: readPersistedChatMessages(),
    input: '',
    isStreaming: false,
  }
}

function reducer(state: ChatPanelState, action: Action): ChatPanelState {
  switch (action.type) {
    case 'setInput':
      return { ...state, input: action.value }
    case 'setStreaming':
      return { ...state, isStreaming: action.value }
    case 'reset':
      return { messages: [], input: '', isStreaming: false }
    case 'appendMessages':
      return { ...state, messages: [...state.messages, ...action.messages] }
    case 'appendAssistantDelta':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, content: (m.content || '') + action.delta } : m,
        ),
      }
    case 'patchAssistant':
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      }
    case 'setAssistantContent':
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.id ? { ...m, content: action.content } : m)),
      }
    default:
      return state
  }
}

function makeId(): string {
  try {
    const uuid = (globalThis as any)?.crypto?.randomUUID?.() as string | undefined
    if (uuid) return uuid
  } catch {
    // ignore
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function buildHistory(messages: ChatMessage[], nextUser: ChatMessage): ChatHistoryMessage[] {
  return [...messages, nextUser]
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }))
}

function isAbortError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object' && 'name' in err && (err as any).name === 'AbortError') return true
  const msg = err instanceof Error ? err.message : String(err)
  return msg.toLowerCase().includes('aborted')
}

export function useChatPanelController() {
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState)

  const stateRef = React.useRef(state)
  React.useEffect(() => {
    stateRef.current = state
  }, [state])

  const abortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    writePersistedChatMessages(state.messages)
  }, [state.messages])

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const resetChat = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null

    clearPersistedChat()
    dispatch({ type: 'reset' })
  }, [])

  const setInput = React.useCallback((value: string) => {
    dispatch({ type: 'setInput', value })
  }, [])

  const send = React.useCallback(async () => {
    const { input, isStreaming, messages } = stateRef.current
    const question = String(input || '').trim()
    if (!question || isStreaming) return

    const userMessage: ChatMessage = { id: makeId(), role: 'user', content: question }
    const assistantId = makeId()
    const assistantMessage: ChatMessage = { id: assistantId, role: 'assistant', content: '' }

    dispatch({ type: 'appendMessages', messages: [userMessage, assistantMessage] })
    dispatch({ type: 'setInput', value: '' })
    dispatch({ type: 'setStreaming', value: true })

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const pending: {
      sources?: ChatSource[]
      retrievalChunks?: ChatRetrievalChunk[]
      retrievalContext?: string
      queryPlan?: QueryPlan
    } = {}

    const applyPending = () => {
      dispatch({
        type: 'patchAssistant',
        id: assistantId,
        patch: {
          sources: pending.sources,
          retrievalChunks: pending.retrievalChunks,
          retrievalContext: pending.retrievalContext,
          queryPlan: pending.queryPlan,
        },
      })
    }

    try {
      const history = buildHistory(messages, userMessage)

      await streamChat({
        question,
        history,
        signal: controller.signal,
        onQueryPlan: (qp) => {
          pending.queryPlan = qp
          dispatch({ type: 'patchAssistant', id: assistantId, patch: { queryPlan: qp } })
        },
        onSources: (src) => {
          pending.sources = src
          dispatch({ type: 'patchAssistant', id: assistantId, patch: { sources: src } })
        },
        onRetrieval: (payload) => {
          pending.retrievalChunks = payload.chunks
          pending.retrievalContext = typeof payload.context === 'string' ? payload.context : undefined
          dispatch({
            type: 'patchAssistant',
            id: assistantId,
            patch: { retrievalChunks: pending.retrievalChunks, retrievalContext: pending.retrievalContext },
          })
        },
        onDelta: (delta) => {
          dispatch({ type: 'appendAssistantDelta', id: assistantId, delta })
        },
        onDone: () => {
          applyPending()
        },
      })
    } catch (err) {
      if (!isAbortError(err)) {
        const msg = err instanceof Error ? err.message : 'Chat request failed'
        dispatch({ type: 'setAssistantContent', id: assistantId, content: `Error: ${msg}` })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      dispatch({ type: 'setStreaming', value: false })
    }
  }, [])

  return {
    messages: state.messages,
    input: state.input,
    isStreaming: state.isStreaming,
    setInput,
    send,
    resetChat,
  }
}
