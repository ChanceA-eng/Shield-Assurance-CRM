-- Outreach engine settings: one-row config for send caps, windows, and safety rails.
create table if not exists public.outreach_settings (
  id integer primary key default 1 check (id = 1),
  approval_mode boolean not null default true,       -- drafts require human approval before send
  daily_send_cap integer not null default 20,
  send_window_start integer not null default 8,      -- hour of day, agency local time
  send_window_end integer not null default 17,
  opt_out_footer text not null default 'If you''d prefer not to receive these emails, reply "unsubscribe" and we''ll remove you right away. Shield Assurance, Tucson, AZ.',
  updated_at timestamptz not null default now()
);

insert into public.outreach_settings (id) values (1) on conflict (id) do nothing;

-- Opt-out list: never contact these addresses again.
create table if not exists public.outreach_opt_outs (
  email text primary key,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.outreach_settings enable row level security;
alter table public.outreach_opt_outs enable row level security;
create policy "Authenticated agency users can manage outreach_settings" on public.outreach_settings for all to authenticated using (true) with check (true);
create policy "Authenticated agency users can manage outreach_opt_outs" on public.outreach_opt_outs for all to authenticated using (true) with check (true);
