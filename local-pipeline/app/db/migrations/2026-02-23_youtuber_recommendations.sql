-- Incremental migration: youtuber recommendation events
-- Execute in Supabase SQL editor.

create table if not exists public.youtuber_recommendations (
  id bigserial primary key,
  video_id text not null references public.videos(video_id) on delete cascade,
  ticker text not null,
  action text not null default 'buy',
  source text null,
  created_at timestamptz not null default now(),
  unique(video_id, ticker, action)
);

create index if not exists idx_youtuber_recommendations_ticker on public.youtuber_recommendations(ticker);
create index if not exists idx_youtuber_recommendations_created_at on public.youtuber_recommendations(created_at);
