create extension if not exists pgcrypto;

create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  content text not null,
  follow_up_at timestamptz,
  follow_up_completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_interactions_follow_up on public.interactions(follow_up_at, follow_up_completed);
create index if not exists idx_interactions_lead_id on public.interactions(lead_id);
