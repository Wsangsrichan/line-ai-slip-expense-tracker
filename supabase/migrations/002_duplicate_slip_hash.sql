-- Apply after 001_mvp_transactions.sql. Existing rows remain valid and are
-- protected as soon as newly uploaded slips include their content hash.
alter table public.transactions
  add column if not exists slip_content_sha256 text;

alter table public.pending_slips
  add column if not exists content_hash text;

create unique index if not exists transactions_user_slip_hash_uidx
  on public.transactions (line_user_id, slip_content_sha256)
  where slip_content_sha256 is not null;