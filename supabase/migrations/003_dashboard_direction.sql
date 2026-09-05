-- Apply manually after 002_duplicate_slip_hash.sql when the dashboard is approved.
-- This migration is intentionally not applied by this implementation task.
alter table public.transactions
  add column if not exists direction text;

update public.transactions
set direction = type
where direction is null;

alter table public.transactions
  drop constraint if exists transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('income', 'expense', 'unknown'));

alter table public.transactions
  add constraint transactions_direction_check
  check (direction in ('income', 'expense', 'unknown'));

create index if not exists transactions_user_direction_datetime_idx
  on public.transactions (line_user_id, direction, transaction_datetime desc);
