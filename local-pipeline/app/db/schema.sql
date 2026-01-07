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
  channel_id text null,
  channel_title text null,
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
  id bigserial primary key,
  video_id text not null references public.videos(video_id) on delete cascade,
  chunk_index int not null,
  chunk_start_time double precision not null,
  chunk_end_time double precision not null,
  chunk_text text not null,
  created_at timestamptz not null default now(),
  unique(video_id, chunk_index)
);

-- Per-chunk extracted tickers/topics + chunk-level summary
create table if not exists public.chunk_analysis (
  id bigserial primary key,
  video_id text not null references public.videos(video_id) on delete cascade,
  chunk_index int not null,
  tickers text[] not null default '{}',
  topics text[] not null default '{}',
  chunk_summary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(video_id, chunk_index)
);

-- Aggregated summaries by (video_id, ticker, topic)
create table if not exists public.summaries (
  id bigserial primary key,
  video_id text not null references public.videos(video_id) on delete cascade,
  ticker text not null,
  topic text not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(video_id, ticker, topic)
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
  updated_at timestamptz not null default now(),
  unique(summary_id, model)
);

-- Optional metadata key/value store
create table if not exists public.metadata (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_transcript_chunks_video_id on public.transcript_chunks(video_id);
create index if not exists idx_chunk_analysis_video_id on public.chunk_analysis(video_id);
create index if not exists idx_summaries_video_id on public.summaries(video_id);
create index if not exists idx_embeddings_summary_id on public.embeddings(summary_id);

-- Vector index for semantic search (choose one)
-- HNSW is recommended when available.
-- If your Supabase project doesn't support HNSW, use IVFFLAT.
-- create index if not exists idx_embeddings_embedding_hnsw on public.embeddings using hnsw (embedding vector_cosine_ops);
-- create index if not exists idx_embeddings_embedding_ivfflat on public.embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
