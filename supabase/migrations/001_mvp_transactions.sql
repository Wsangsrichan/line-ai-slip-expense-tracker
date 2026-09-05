create extension if not exists "pgcrypto";

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(12, 2) not null check (amount > 0),
  payee_payer text not null,
  category text not null,
  transaction_datetime timestamptz not null,
  slip_image_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_datetime_idx
  on public.transactions (line_user_id, transaction_datetime desc);

alter table public.transactions enable row level security;

create table if not exists public.pending_slips (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  storage_ref text not null,
  created_at timestamptz not null default now()
);

create index if not exists pending_slips_user_idx
  on public.pending_slips (line_user_id, created_at desc);

alter table public.pending_slips enable row level security;

-- The API uses a server-side client after verifying LINE identity.
-- No public policy is added; client-side direct table access remains disabled.

insert into storage.buckets (id, name, public)
values ('slips', 'slips', false)
on conflict (id) do nothing;
