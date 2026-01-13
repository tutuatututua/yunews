-- Supabase / Postgres schema for the local batch pipeline.
-- Assumptions:
-- - pgvector extension is available (Supabase "Vector" feature).
-- - Execute this in the Supabase SQL editor.

create extension if not exists vector;

-- Videos discovered from YouTube
create table if not exists public.videos (
  video_id text primary key,
  title text not null,
  channel text not null,
  published_at timestamptz not null,
  description text not null,
  duration_seconds int null,
  video_url text null,
  thumbnail_url text null,

  view_count bigint null,
  like_count bigint null,
  comment_count bigint null,

  tags text[] null,
  category_id text null,
  default_language text null,
  default_audio_language text null,

  channel_subscriber_count bigint null,
  channel_video_count bigint null,
  discovered_at timestamptz not null default now(),
  processed_at timestamptz null
);


-- Time-windowed transcript chunks (<= 5 minutes)
create table if not exists public.transcript_chunks (
  video_id text not null references public.videos(video_id) on delete cascade,
  chunk_index int not null,
  chunk_start_time double precision not null,
  chunk_end_time double precision not null,
  chunk_text text not null,
  created_at timestamptz not null default now(),
  primary key (video_id, chunk_index)
);

-- Per-chunk extracted ticker with categorized keypoints.
-- Note: A single transcript chunk may mention multiple tickers; we store one row per
-- (video_id, chunk_index, ticker) to avoid overwriting on upsert.
-- chunk_summary structure: {positive: [string], negative: [string], neutral: [string]}
-- - positive: bullish/positive claims about the ticker
-- - negative: bearish/negative claims about the ticker
-- - neutral: neutral/factual claims about the ticker
create table if not exists public.chunk_analysis (
  video_id text not null references public.videos(video_id) on delete cascade,
  chunk_index int not null,
  ticker text not null,
  chunk_summary jsonb not null,
  created_at timestamptz not null default now(),
  primary key (video_id, chunk_index, ticker)
);

-- Aggregated summaries by (video_id, ticker)
-- summary structure: {positive: [string], negative: [string], neutral: [string]}
-- Aggregates all chunk-level keypoints for a given (video_id, ticker) combination
-- - positive: aggregated bullish/positive claims
-- - negative: aggregated bearish/negative claims
-- - neutral: aggregated neutral/factual claims
create table if not exists public.summaries (
  id bigserial primary key,
  video_id text not null references public.videos(video_id) on delete cascade,
  published_at timestamptz null,
  ticker text not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  unique(video_id, ticker)
);

-- Embeddings per summary row (for semantic search)
-- We keep a `dimension` column so different embedding models can coexist.
-- Note: pgvector allows a fixed dimension. Here we store an unconstrained vector
-- by declaring `vector` (no dimension) for compatibility across environments.
-- If your pgvector version requires a dimension, change this to vector(<DIM>)
-- and keep dimension consistent.
create table if not exists public.embeddings (
  id bigserial primary key,
  summary_id bigint not null references public.summaries(id) on delete cascade,
  model text not null,
  dimension int not null,
  embedding vector not null,
  created_at timestamptz not null default now(),
  unique(summary_id, model)
);

-- Overall per-video summary for the UI (optional but recommended)
create table if not exists public.video_summaries (
  video_id text primary key references public.videos(video_id) on delete cascade,
  video_titles text not null,
  published_at timestamptz null,
  summary_markdown text not null,
  overall_explanation text not null default '',
  movers jsonb not null default '[]'::jsonb,
  risks text[] not null default '{}',
  opportunities text[] not null default '{}',
  key_points text[] not null default '{}',
  tickers text[] not null default '{}',
  sentiment text null,
  events jsonb not null default '[]'::jsonb,
  model text not null,
  summarized_at timestamptz not null default now()
);

-- Embeddings for overall per-video summaries (separate from per-(video,ticker) summaries)
create table if not exists public.video_summary_embeddings (
  id bigserial primary key,
  video_id text not null references public.videos(video_id) on delete cascade,
  published_at timestamptz null,
  model text not null,
  dimension int not null,
  embedding vector not null,
  created_at timestamptz not null default now(),
  unique(video_id, model)
);

-- Overall per-day summary for the UI (optional but recommended)
create table if not exists public.daily_summaries (
  market_date date primary key,
  title text not null,
  overall_summarize text not null default '',
  summary_markdown text not null,
  movers jsonb not null default '[]'::jsonb,
  risks text[] not null default '{}',
  opportunities text[] not null default '{}',
  model text not null,
  generated_at timestamptz not null
);


-- Helpful indexes
create index if not exists idx_transcript_chunks_video_id on public.transcript_chunks(video_id);
create index if not exists idx_chunk_analysis_video_id on public.chunk_analysis(video_id);
create index if not exists idx_summaries_video_id on public.summaries(video_id);
create index if not exists idx_embeddings_summary_id on public.embeddings(summary_id);
create index if not exists idx_video_summaries_video_id on public.video_summaries(video_id);
create index if not exists idx_video_summary_embeddings_video_id on public.video_summary_embeddings(video_id);
create index if not exists idx_daily_summaries_market_date on public.daily_summaries(market_date);

-- Vector index for semantic search (choose one)
-- HNSW is recommended when available.
-- If your Supabase project doesn't support HNSW, use IVFFLAT.
-- create index if not exists idx_embeddings_embedding_hnsw on public.embeddings using hnsw (embedding vector_cosine_ops);
-- create index if not exists idx_embeddings_embedding_ivfflat on public.embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
