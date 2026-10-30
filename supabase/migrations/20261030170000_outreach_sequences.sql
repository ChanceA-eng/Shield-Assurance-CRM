-- Outreach sequence engine: enrollments drive timed AI-drafted emails through an approval outbox.

create table if not exists public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','replied','completed','cancelled','opted_out')),
  current_step integer not null default 0,          -- last email step that was actually sent
  total_steps integer not null default 3,
  step_gap_days integer not null default 5,
  next_send_at timestamptz,
  last_sent_at timestamptz,
  enrolled_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text
);

create index if not exists sequence_enrollments_due_idx on public.sequence_enrollments (status, next_send_at);
-- Only one live enrollment per lead.
create unique index if not exists sequence_enrollments_active_lead_idx
  on public.sequence_enrollments (lead_id) where status in ('active','paused');

create table if not exists public.outreach_outbox (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid references public.sequence_enrollments(id) on delete set null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  step_number integer not null default 1,
  to_email text not null,
  subject text not null,
  body text not null,
  cited_signals jsonb not null default '[]'::jsonb,
  status text not null default 'pending_approval' check (status in ('pending_approval','sent','rejected','failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists outreach_outbox_status_idx on public.outreach_outbox (status, created_at desc);
create index if not exists outreach_outbox_lead_idx on public.outreach_outbox (lead_id);

alter table public.sequence_enrollments enable row level security;
alter table public.outreach_outbox enable row level security;
create policy "Authenticated agency users can manage sequence_enrollments" on public.sequence_enrollments for all to authenticated using (true) with check (true);
create policy "Authenticated agency users can manage outreach_outbox" on public.outreach_outbox for all to authenticated using (true) with check (true);
