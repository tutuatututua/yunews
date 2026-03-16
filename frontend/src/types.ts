export type DailySummary = {
  id: string
  market_date: string
  title: string
  overall_summarize?: string
  key_points: string[]
  risks: string[]
  opportunities: string[]
  sentiment?: string | null
  sentiment_score?: number | null
  sentiment_reason?: string
  per_entity_summaries?: Array<{ symbol: string; summary_markdown: string; key_claims: string[] }>
  model: string
  generated_at: string
}

type VideoMover = { symbol: string; direction: 'up' | 'down' | 'mixed'; reason: string }

export type TopMover = {
  symbol: string
  direction: 'bullish' | 'bearish' | 'mixed'
  reason: string
}

export type VideoListItem = {
  id: string
  video_id: string
  title: string
  channel: string | null
  published_at: string
  video_url: string | null
  thumbnail_url: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  duration_seconds: number | null
  overall_explanation?: string | null
  sentiment?: string | null
}

export type VideoDetail = {
  video: any
  summary: {
    id: string
    summary_markdown: string
    overall_explanation: string
    movers: VideoMover[]
    risks?: string[]
    opportunities?: string[]
    key_points: string[]
    tickers: string[]
    sentiment: string | null
    events?: Array<{ date: string | null; timeframe: string | null; description: string; tickers: string[] }>
    model: string
    summarized_at: string

    // From `video_summaries` table (when present)
    video_titles?: string | null
    published_at?: string | null
  } | null

  // Per-ticker details sourced from normalized `summaries` rows
  ticker_details?: Array<{
    ticker: string
    summary: any
    sentiment: 'positive' | 'negative' | 'neutral'
    key_points: string[]
  }>
}

export type VideoInfographicItem = {
  id: string
  video_id: string
  title: string
  channel: string | null
  published_at: string
  video_url: string | null
  thumbnail_url: string | null
  edges: Array<{ ticker: string; sentiment: 'positive' | 'negative' | 'neutral'; key_points: string[] }>
}

export type EntityChunkRow = {
  entities?: Array<{ type: string; symbol?: string }>
  computed_at?: string
  market_date?: string | null
  keypoints_by_sentiment?: {
    positive?: string[]
    negative?: string[]
    neutral?: string[]
  } | null
  videos?: {
    video_url?: string | null
    video_id?: string
    channel?: string | null
    title?: string
    published_at?: string
  } | null
}

export type QueryPlan = {
  is_stock_related: boolean
  rewritten_prompt: string
  tickers: string[] | null
}

export type PriceBar = {
  date: string
  close: number | null
  adj_close?: number | null
}

export type RecommendationEvent = {
  video_id: string
  ticker: string
  action: 'buy'
  title?: string | null
  channel?: string | null
  published_at?: string | null
  video_url?: string | null
  thumbnail_url?: string | null
  positive_keypoints?: string[]
  entry_date?: string | null
  entry_close?: number | null
  latest_date?: string | null
  latest_close?: number | null
  return_pct?: number | null
  return_7d_pct?: number | null
  return_30d_pct?: number | null
}

export type RecommendationOverlay = {
  symbol: string
  prices: PriceBar[]
  events: RecommendationEvent[]
}

export type RecommendationListData = {
  items: RecommendationEvent[]
}

// Chat (SSE)
export type ChatRole = 'user' | 'assistant'

export type ChatHistoryMessage = {
  role: ChatRole
  content: string
}

export type ChatSource = {
  chunk: number
  document_type: string
  ticker?: string | null
  video_title?: string | null
  thumbnail_url?: string | null
  similarity?: number | null
  retrieval_method?: string | null
}

export type ChatRetrievalChunk = {
  document_type: string
  text: string
  retrieval_method?: string | null

  // Optional metadata (kept for backward/forward compatibility)
  ticker?: string | null
  video_title?: string | null
  thumbnail_url?: string | null
  similarity?: number | null
}

export type ChatStreamEvent =
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'query_plan'; query_plan: QueryPlan }
  | { type: 'retrieval'; chunks: ChatRetrievalChunk[]; context?: string }
  | { type: 'delta'; delta: string }
  | { type: 'done' }
  | { type: 'error'; message: string; details?: { hint?: string; fix?: string; request_id?: string } }
