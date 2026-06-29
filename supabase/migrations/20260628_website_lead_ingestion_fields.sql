create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  line_of_business text,
  source text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table if exists public.leads
  add column if not exists zip text,
  add column if not exists state text,
  add column if not exists business text,
  add column if not exists primary_coverage text,
  add column if not exists vehicle_details text,
  add column if not exists details text,
  add column if not exists bundles text[] not null default array[]::text[],
  add column if not exists form_payload jsonb;

create index if not exists leads_state_idx on public.leads(state);
create index if not exists leads_email_idx on public.leads(email);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_created_at_idx on public.leads(created_at desc);
