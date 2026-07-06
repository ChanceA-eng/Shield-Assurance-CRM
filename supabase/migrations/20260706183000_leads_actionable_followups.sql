alter table if exists public.leads
  add column if not exists last_viewed_at timestamptz,
  add column if not exists last_activity_at timestamptz default now();

create index if not exists idx_leads_followup_tracking
  on public.leads (status, last_activity_at, last_viewed_at);

create or replace function public.get_actionable_leads_count()
returns integer as $$
declare
  total_alerts integer;
begin
  select count(*) into total_alerts
  from public.leads
  where status in ('new', 'working', 'prospect')
    and (
      last_viewed_at is null
      or coalesce(last_activity_at, created_at) > last_viewed_at
      or last_viewed_at <= now() - interval '24 hours'
    );

  return total_alerts;
end;
$$ language plpgsql;