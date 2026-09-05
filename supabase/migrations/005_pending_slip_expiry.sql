alter table public.pending_slips
  add column if not exists expires_at timestamptz;

update public.pending_slips
set expires_at = created_at + interval '15 minutes'
where expires_at is null;

create index if not exists pending_slips_expiry_idx
  on public.pending_slips (id, line_user_id, expires_at);
