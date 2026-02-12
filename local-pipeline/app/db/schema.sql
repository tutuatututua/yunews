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

create table if not exists public.chunk_analysis (
  video_id text not null references public.videos(video_id) on delete cascade,
  chunk_index int not null,
  ticker text not null,
  chunk_summary jsonb not null,
  created_at timestamptz not null default now(),
  primary key (video_id, chunk_index, ticker)
);

create table if not exists public.summaries (
  id bigserial primary key,
  video_id text not null references public.videos(video_id) on delete cascade,
  published_at timestamptz null,
  ticker text not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  unique(video_id, ticker)
);



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
  sentiment text null,
  sentiment_score double precision null,
  sentiment_reason text not null default '',
  model text not null,
  generated_at timestamptz not null
);


create table if not exists public.rag_documents (
  id bigserial primary key,

  -- Idempotency key (e.g., ticker_summary:<video_id>:<ticker>)
  source_key text not null unique,

  document_type text not null check (document_type in ('ticker_summary','video_summary','highlight')),

  ticker text null,

  video_id text null references public.videos(video_id) on delete set null,
  summary_text text not null,

  model text not null,
  dimension int not null,
  embedding vector not null,

  created_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_transcript_chunks_video_id on public.transcript_chunks(video_id);
create index if not exists idx_chunk_analysis_video_id on public.chunk_analysis(video_id);
create index if not exists idx_summaries_video_id on public.summaries(video_id);
create index if not exists idx_embeddings_summary_id on public.embeddings(summary_id);
create index if not exists idx_video_summaries_video_id on public.video_summaries(video_id);
create index if not exists idx_video_summary_embeddings_video_id on public.video_summary_embeddings(video_id);
create index if not exists idx_daily_summaries_market_date on public.daily_summaries(market_date);

create index if not exists idx_rag_documents_type on public.rag_documents(document_type);
create index if not exists idx_rag_documents_ticker on public.rag_documents(ticker);
create index if not exists idx_rag_documents_video_id on public.rag_documents(video_id);
create index if not exists idx_rag_documents_created_at on public.rag_documents(created_at);


-- RPC: vector similarity search over rag_documents.
-- Returns the document plus video metadata (if available) for UI citations.
create or replace function public.match_rag_documents(
  query_embedding vector,
  match_count int,
  filter_ticker text default null,
  filter_document_type text default null,
  min_published_at timestamptz default null
)
returns table (
  id bigint,
  document_type text,
  ticker text,
  video_id text,
  video_title text,
  thumbnail_url text,
  summary_text text,
  similarity double precision
)
language sql
stable
as $$
  select
    d.id,
    d.document_type,
    d.ticker,
    d.video_id,
    v.title as video_title,
    v.thumbnail_url as thumbnail_url,
    d.summary_text,
    (1 - (d.embedding <=> query_embedding))::double precision as similarity
  from public.rag_documents d
  left join public.videos v on v.video_id = d.video_id
  where
    -- IMPORTANT: Prevent runtime errors when the table contains mixed embedding dimensions
    -- (e.g., switching providers/models over time). Only compare vectors of the same length.
    d.dimension = vector_dims(query_embedding)
    and (filter_ticker is null or d.ticker = filter_ticker)
    and (filter_document_type is null or d.document_type = filter_document_type)
    and (
      min_published_at is null
      or (v.published_at is not null and v.published_at >= min_published_at)
      or (v.published_at is null and d.created_at >= min_published_at)
    )
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
