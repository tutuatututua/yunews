-- Migration: Create feedback table for in-app feedback submissions

begin;

create table if not exists public.feedback (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  ip text not null,
  request_id text null,
  email text null,
  message text not null,
  path text not null,
  user_agent text null,
  referrer text null
);

create index if not exists idx_feedback_created_at on public.feedback(created_at desc);
create index if not exists idx_feedback_ip on public.feedback(ip);
create index if not exists idx_feedback_path on public.feedback(path);

commit;
