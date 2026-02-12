-- Fix/refresh the RAG vector-search RPC.
--
-- Symptom:
-- - /chat retrieval fails with errors like:
--   "column d.video_title does not exist"
--
-- Apply this in Supabase SQL editor.

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
    (filter_ticker is null or d.ticker = filter_ticker)
    and (filter_document_type is null or d.document_type = filter_document_type)
    and (
      min_published_at is null
      or (v.published_at is not null and v.published_at >= min_published_at)
      or (v.published_at is null and d.created_at >= min_published_at)
    )
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
