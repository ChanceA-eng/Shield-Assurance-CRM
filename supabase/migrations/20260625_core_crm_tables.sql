create extension if not exists pgcrypto;

alter table if exists public.clients
  add column if not exists source text;

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  insured_name text not null,
  phone text,
  email text,
  address text,
  carrier text not null,
  line_of_business text not null,
  premium numeric(12,2) not null default 0,
  policy_number text,
  effective_date date not null,
  renewal_date date not null,
  status text not null default 'issued',
  created_at timestamptz not null default now()
);

alter table if exists public.policies
  add column if not exists policy_number text;

create index if not exists policies_client_id_idx on public.policies(client_id);
create index if not exists policies_renewal_date_idx on public.policies(renewal_date);
create index if not exists policies_status_idx on public.policies(status);

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

create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_created_at_idx on public.leads(created_at desc);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  type text not null,
  status text not null default 'open',
  description text,
  date_of_loss date not null,
  created_at timestamptz not null default now()
);

create index if not exists claims_policy_id_idx on public.claims(policy_id);
create index if not exists claims_client_id_idx on public.claims(client_id);
create index if not exists claims_status_idx on public.claims(status);

create table if not exists public.endorsements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  type text not null,
  description text,
  effective_date date not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists endorsements_policy_id_idx on public.endorsements(policy_id);
create index if not exists endorsements_client_id_idx on public.endorsements(client_id);
create index if not exists endorsements_status_idx on public.endorsements(status);

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  certificate_holder text not null,
  description text,
  issue_date date not null,
  status text not null default 'issued',
  created_at timestamptz not null default now()
);

create index if not exists certificates_policy_id_idx on public.certificates(policy_id);
create index if not exists certificates_client_id_idx on public.certificates(client_id);
create index if not exists certificates_status_idx on public.certificates(status);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  description text,
  due_date date,
  status text not null default 'open',
  priority text not null default 'medium',
  related_type text,
  related_id uuid,
  event_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_due_date_idx on public.tasks(due_date);
create index if not exists tasks_related_idx on public.tasks(related_type, related_id);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  subject text not null,
  title text,
  description text,
  event_date date not null,
  event_time text,
  all_day boolean not null default true,
  status text not null default 'scheduled',
  related_type text,
  related_id uuid,
  task_id uuid,
  created_at timestamptz not null default now()
);

alter table if exists public.events
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists events_event_date_idx on public.events(event_date);
create index if not exists events_status_idx on public.events(status);
create index if not exists events_related_idx on public.events(related_type, related_id);
create index if not exists events_client_id_idx on public.events(client_id);
