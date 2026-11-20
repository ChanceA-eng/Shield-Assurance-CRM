create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  address text,
  source text,
  email_consent boolean default false,
  sms_consent boolean default false,
  preferred_channel text default 'email' check (preferred_channel in ('email', 'sms', 'both')),
  created_at timestamptz default now()
);

alter table if exists public.clients
  add column if not exists source text;

create index if not exists clients_created_at_idx
  on public.clients (created_at desc);

create table if not exists public.communication_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  channel text check (channel in ('email', 'sms', 'in_app')),
  direction text check (direction in ('outbound', 'inbound')),
  subject text,
  body text,
  sent_at timestamptz default now(),
  automation_type text,
  metadata jsonb default '{}'::jsonb
);

create index if not exists communication_log_client_id_sent_at_idx
  on public.communication_log (client_id, sent_at desc);

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  send_at timestamptz not null,
  channel text check (channel in ('email', 'sms')),
  subject text,
  body text,
  automation_type text,
  status text default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  created_at timestamptz default now()
);

create index if not exists scheduled_messages_client_id_send_at_idx
  on public.scheduled_messages (client_id, send_at asc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  type text not null,
  message text not null,
  read boolean default false,
  created_at timestamptz default now()
);

create index if not exists notifications_client_id_created_at_idx
  on public.notifications (client_id, created_at desc);

create table if not exists public.typing_status (
  client_id uuid references public.clients(id) on delete cascade,
  user_id uuid,
  is_typing boolean default false,
  updated_at timestamptz default now(),
  primary key (client_id, user_id)
);

create table if not exists public.read_receipts (
  message_id uuid references public.communication_log(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  read_at timestamptz default now(),
  primary key (message_id, client_id)
);
