-- Migration: Add youtuber_recommendations.published_at and drop created_at
-- Run this in Supabase SQL editor (or psql) against your target database.

begin;

-- 1) Add the new column (nullable initially for backfill)
alter table if exists public.youtuber_recommendations
  add column if not exists published_at timestamptz;

-- 2) Backfill from videos (videos.published_at is the canonical publish time)
update public.youtuber_recommendations r
set published_at = v.published_at
from public.videos v
where v.video_id = r.video_id
  and r.published_at is null;

-- 3) Ensure no nulls remain (should be true if all video_id values exist in videos)
-- If this fails, inspect orphan rows and either delete them or set a value.
alter table public.youtuber_recommendations
  alter column published_at set not null;

-- 4) Add an index for efficient filtering/sorting
create index if not exists idx_youtuber_recommendations_published_at
  on public.youtuber_recommendations(published_at);

-- 5) Drop the old created_at column + its index (if present)
drop index if exists public.idx_youtuber_recommendations_created_at;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'youtuber_recommendations'
      and column_name = 'created_at'
  ) then
    alter table public.youtuber_recommendations drop column created_at;
  end if;
end $$;

commit;
