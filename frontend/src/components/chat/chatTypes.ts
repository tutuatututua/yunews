import type { ChatRetrievalChunk, ChatRole, ChatSource, QueryPlan } from '../../types'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  sources?: ChatSource[]
  retrievalContext?: string
  queryPlan?: QueryPlan
  retrievalChunks?: ChatRetrievalChunk[]
}

export type PersistedChatStateV1 = {
  v: 1
  messages: ChatMessage[]
}
