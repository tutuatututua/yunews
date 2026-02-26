-- Required for the `vector` type used by `rag_documents.embedding`.
create extension if not exists vector with schema extensions;

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

create table if not exists public.youtuber_recommendations (
  id bigserial primary key,
  video_id text not null references public.videos(video_id) on delete cascade,
  published_at timestamptz not null,
  ticker text not null,
  action text not null default 'buy',
  source text null,
  unique(video_id, ticker, action)
);

create index if not exists idx_youtuber_recommendations_ticker on public.youtuber_recommendations(ticker);
create index if not exists idx_youtuber_recommendations_published_at on public.youtuber_recommendations(published_at);

create table if not exists public.rag_documents (
  id bigserial primary key,
  document_type text not null,
  -- Note: not all RAG documents map 1:1 to a YouTube video (e.g. `daily_summary`).
  -- We still keep a `video_id` field for compatibility with existing code, but do
  -- not enforce a foreign key constraint.
  video_id text not null,
  ticker text not null default '',
  source_key text not null default '',
  video_title text null,
  thumbnail_url text null,
  summary_text text not null,
  model text not null,
  dimension int not null,
  embedding vector not null,
  created_at timestamptz not null default now(),
  unique(document_type, video_id, ticker, source_key, model)
);

-- Backward compatibility: if an existing deployment created rag_documents.video_id
-- with a foreign key to videos(video_id), drop it so we can store non-video docs.
do $$
declare
  fk_name text;
begin
  select c.conname
    into fk_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'rag_documents'
    and c.contype = 'f'
    and pg_get_constraintdef(c.oid) ilike '%(video_id)%references%videos%';

  if fk_name is not null then
    execute format('alter table public.rag_documents drop constraint %I', fk_name);
  end if;
end $$;

create index if not exists idx_rag_documents_video_id on public.rag_documents(video_id);
create index if not exists idx_rag_documents_ticker on public.rag_documents(ticker);
create index if not exists idx_rag_documents_type on public.rag_documents(document_type);
create index if not exists idx_rag_documents_created_at on public.rag_documents(created_at);

-- Supabase RPC used by the backend for RAG retrieval.
-- The parameter names must match the JSON payload keys sent from the API.
create or replace function public.match_rag_documents(
  query_embedding vector,
  match_count integer,
  filter_ticker text default null,
  filter_document_type text default null
)
returns table (
  id bigint,
  document_type text,
  video_id text,
  ticker text,
  source_key text,
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
    d.video_id,
    nullif(d.ticker, '') as ticker,
    d.source_key,
    d.video_title,
    d.thumbnail_url,
    d.summary_text,
    (1 - (d.embedding <=> query_embedding))::double precision as similarity
  from public.rag_documents d
  where
    -- Guard against mixed embedding dimensions.
    d.dimension = vector_dims(query_embedding)
    and (filter_document_type is null or filter_document_type = '' or d.document_type = filter_document_type)
    and (filter_ticker is null or filter_ticker = '' or d.ticker = filter_ticker)
  order by d.embedding <=> query_embedding
  limit greatest(coalesce(match_count, 5), 1);
$$;
