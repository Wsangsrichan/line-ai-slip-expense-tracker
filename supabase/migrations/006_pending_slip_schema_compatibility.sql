-- Keep the webhook/LIFF path deployable when an older database missed one of
-- the incremental pending-slip migrations. All statements are idempotent.
alter table public.pending_slips
  add column if not exists content_hash text,
  add column if not exists line_event_id text,
  add column if not exists line_message_id text,
  add column if not exists extraction jsonb,
  add column if not exists expires_at timestamptz;

update public.pending_slips
set expires_at = created_at + interval '15 minutes'
where expires_at is null;

create unique index if not exists pending_slips_line_event_uidx
  on public.pending_slips (line_event_id)
  where line_event_id is not null;

create index if not exists pending_slips_expiry_idx
  on public.pending_slips (id, line_user_id, expires_at);

create table if not exists public.webhook_events (
  event_id text primary key,
  line_user_id text not null,
  line_message_id text not null,
  created_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
