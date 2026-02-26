import type { ChatMessage, PersistedChatStateV1 } from './chatTypes'

export const CHAT_STORAGE_KEY = 'yunews_chat_v1' as const

function safeGetLocalStorage(): Storage | null {
  try {
    const ls = (globalThis as any)?.localStorage as Storage | undefined
    return ls ?? null
  } catch {
    return null
  }
}

export function readPersistedChatMessages(): ChatMessage[] {
  const ls = safeGetLocalStorage()
  if (!ls) return []

  try {
    const raw = ls.getItem(CHAT_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as PersistedChatStateV1
    if (!parsed || parsed.v !== 1) return []
    return Array.isArray(parsed.messages) ? parsed.messages : []
  } catch {
    return []
  }
}

export function writePersistedChatMessages(messages: ChatMessage[]): void {
  const ls = safeGetLocalStorage()
  if (!ls) return

  try {
    const payload: PersistedChatStateV1 = {
      v: 1,
      messages: (messages || []).slice(-50),
    }
    ls.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / storage errors
  }
}

export function clearPersistedChat(): void {
  const ls = safeGetLocalStorage()
  if (!ls) return

  try {
    ls.removeItem(CHAT_STORAGE_KEY)
  } catch {
    // ignore
  }
}
