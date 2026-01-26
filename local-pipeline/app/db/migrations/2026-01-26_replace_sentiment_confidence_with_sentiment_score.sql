-- Replace legacy sentiment_confidence with signed sentiment_score.
-- Safe to re-run (uses IF EXISTS / IF NOT EXISTS).

alter table if exists public.daily_summaries
  add column if not exists sentiment_score double precision null;

-- Optional: enforce score range when present.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_summaries_sentiment_score_range'
  ) then
    alter table public.daily_summaries
      add constraint daily_summaries_sentiment_score_range
      check (sentiment_score is null or (sentiment_score >= -1 and sentiment_score <= 1));
  end if;
end $$;

alter table if exists public.daily_summaries
  drop column if exists sentiment_confidence;
