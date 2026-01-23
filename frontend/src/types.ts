export type DailySummary = {
  id: string
  market_date: string
  title: string
  overall_summarize?: string
  summary_markdown: string
  movers: Array<{ symbol: string; direction: 'up' | 'down' | 'mixed'; reason: string }>
  risks: string[]
  opportunities: string[]
  sentiment?: string | null
  sentiment_confidence?: number | null
  sentiment_reason?: string
  per_entity_summaries?: Array<{ symbol: string; summary_markdown: string; key_claims: string[] }>
  model: string
  generated_at: string
}

export type VideoMover = { symbol: string; direction: 'up' | 'down' | 'mixed'; reason: string }

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
  transcript: { id: string; transcript_text: string; transcript_language: string | null } | null
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

export type VideoNested = {
  video_url?: string
  video_id?: string
  channel?: string | null
  title?: string
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
