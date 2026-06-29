create extension if not exists pgcrypto;

create table if not exists public.client_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  asset_type text not null default 'general',
  value text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_assets_client_id_idx on public.client_assets(client_id);
create index if not exists client_assets_type_idx on public.client_assets(asset_type);

create table if not exists public.client_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  subject text not null,
  description text,
  due_date date,
  status text not null default 'open',
  priority text not null default 'medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_tasks_client_id_idx on public.client_tasks(client_id);
create index if not exists client_tasks_status_idx on public.client_tasks(status);
create index if not exists client_tasks_due_date_idx on public.client_tasks(due_date);

create table if not exists public.client_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  file_name text not null,
  file_url text,
  file_type text,
  file_size bigint,
  status text not null default 'uploaded',
  metadata jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists client_files_client_id_idx on public.client_files(client_id);
create index if not exists client_files_uploaded_at_idx on public.client_files(uploaded_at desc);

create table if not exists public.client_tags (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  tag text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (client_id, tag)
);

create index if not exists client_tags_client_id_idx on public.client_tags(client_id);

create table if not exists public.client_activities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  activity_type text not null,
  title text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists client_activities_client_id_idx on public.client_activities(client_id);
create index if not exists client_activities_occurred_at_idx on public.client_activities(occurred_at desc);
