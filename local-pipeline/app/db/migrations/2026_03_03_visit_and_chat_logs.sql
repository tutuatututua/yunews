create table if not exists public.visit_logs (
  id bigserial primary key,
  visited_at timestamptz not null default now(),
  ip text not null,
  path text not null,
  method text not null,
  user_agent text null,
  referer text null,
  request_id text null
);

create index if not exists idx_visit_logs_visited_at on public.visit_logs(visited_at desc);
create index if not exists idx_visit_logs_ip on public.visit_logs(ip);
create index if not exists idx_visit_logs_path on public.visit_logs(path);


create table if not exists public.chat_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  ip text not null,
  request_id text null,
  question text not null,
  history jsonb not null default '[]'::jsonb,
  response_text text null,
  sources jsonb not null default '[]'::jsonb,
  query_plan jsonb null,
  model text null,
  status text not null default 'unknown',
  error_message text null
);

create index if not exists idx_chat_logs_created_at on public.chat_logs(created_at desc);
create index if not exists idx_chat_logs_ip on public.chat_logs(ip);
