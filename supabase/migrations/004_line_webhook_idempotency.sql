alter table public.pending_slips
  add column if not exists line_event_id text,
  add column if not exists line_message_id text,
  add column if not exists extraction jsonb;

create unique index if not exists pending_slips_line_event_uidx
  on public.pending_slips (line_event_id)
  where line_event_id is not null;

create table if not exists public.webhook_events (
  event_id text primary key,
  line_user_id text not null,
  line_message_id text not null,
  created_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
