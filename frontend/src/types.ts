export type DailySummary = {
  id: string
  market_date: string
  title: string
  summary_markdown: string
  movers: Array<{ symbol: string; direction: 'up' | 'down' | 'mixed'; reason: string }>
  risks: string[]
  opportunities: string[]
  per_entity_summaries?: Array<{ symbol: string; summary_markdown: string; key_claims: string[] }>
  anomaly_section?: DailyAnomalySectionItem[]
  chunks_total?: number
  chunks_used?: number
  anomaly_threshold?: number
  model: string
  generated_at: string
}

export type DailyAnomalySectionItem = {
  video_url: string
  channel: string | null
  timestamp_start: number
  timestamp_end: number
  claim: string | null
  explanation: string
  scores: {
    final: number
    embedding_outlier: number
    sentiment_deviation: number
    llm_speculation: number
  }
  flags: string[]
}

export type VideoListItem = {
  id: string
  video_id: string
  title: string
  channel_title: string | null
  published_at: string
  video_url: string
  thumbnail_url: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  duration_seconds: number | null
}

export type VideoDetail = {
  video: any
  transcript: { id: string; transcript_text: string; transcript_language: string | null } | null
  summary: {
    id: string
    summary_markdown: string
    key_points: string[]
    tickers: string[]
    sentiment: string | null
    model: string
    summarized_at: string
  } | null
}

// Backend extra endpoints (PostgREST nested shapes)
export type ChunkAnomalyRow = {
  final_anomaly_score: number
  embedding_outlier_score?: number
  sentiment_deviation_score?: number
  llm_speculation_score?: number
  flags?: string[]
  explanation?: string
  computed_at?: string
}

export type ChunkFeatureRow = {
  entities?: Array<any>
  sentiment_label?: 'positive' | 'negative' | 'neutral'
  sentiment_score?: number
  fact_score?: number
  opinion_score?: number
  speculation_score?: number
}

export type VideoNested = {
  video_url?: string
  video_id?: string
  channel_title?: string | null
  title?: string
}

export type DailyAnomalousChunk = {
  id: string
  market_date: string
  channel_title: string | null
  start_seconds: number
  end_seconds: number
  claim: string | null
  topic: string | null
  stance: 'fact' | 'opinion' | 'speculation' | null
  videos?: VideoNested | null
  chunk_anomalies?: ChunkAnomalyRow | null
  chunk_features?: ChunkFeatureRow | null
}

export type EntityChunkRow = {
  chunk_id: string
  entities?: Array<any>
  sentiment_label?: 'positive' | 'negative' | 'neutral'
  sentiment_score?: number
  fact_score?: number
  opinion_score?: number
  speculation_score?: number
  computed_at?: string
  chunks?: {
    market_date: string
    channel_title: string | null
    start_seconds: number
    end_seconds: number
    claim: string | null
    topic: string | null
    stance: 'fact' | 'opinion' | 'speculation' | null
    videos?: VideoNested | null
  } | null
  chunk_anomalies?: ChunkAnomalyRow | null
}
