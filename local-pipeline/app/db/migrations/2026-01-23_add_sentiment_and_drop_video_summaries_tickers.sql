-- Incremental migration for older Supabase schemas.
-- Safe to re-run (uses IF EXISTS / IF NOT EXISTS).

-- 1) Remove denormalized `tickers` column (ticker relationships come from `summaries`).
alter table if exists public.video_summaries
  drop column if exists tickers;

-- 2) Add daily sentiment fields used by newer API/UI.
alter table if exists public.daily_summaries
  add column if not exists sentiment text null;

alter table if exists public.daily_summaries
  add column if not exists sentiment_score double precision null;

alter table if exists public.daily_summaries
  add column if not exists sentiment_reason text not null default '';
