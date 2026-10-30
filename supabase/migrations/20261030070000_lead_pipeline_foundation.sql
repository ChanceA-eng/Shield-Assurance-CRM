-- Lead pipeline foundation: estimated value, stage aging, lost reasons,
-- and canonical status vocabulary (new -> contacted -> quoted -> won / lost / inactive).

alter table if exists public.leads
  add column if not exists estimated_premium numeric,
  add column if not exists stage_changed_at timestamptz default now(),
  add column if not exists lost_reason text;

-- Backfill canonical statuses from legacy values.
update public.leads set status = 'contacted' where status in ('working', 'prospect');
update public.leads set status = 'won' where status in ('closed', 'bound', 'renewal');
update public.leads set status = 'new' where status = 'lead';

update public.leads set stage_changed_at = coalesce(stage_changed_at, created_at, now())
where stage_changed_at is null;

create index if not exists leads_status_stage_changed_idx
  on public.leads (status, stage_changed_at);

-- Refresh the actionable-leads counter for the new vocabulary.
create or replace function public.get_actionable_leads_count()
returns integer as $$
declare
  total_alerts integer;
begin
  select count(*) into total_alerts
  from public.leads
  where status in ('new', 'contacted')
    and (
      last_viewed_at is null
      or coalesce(last_activity_at, created_at) > last_viewed_at
      or last_viewed_at <= now() - interval '24 hours'
    );

  return total_alerts;
end;
$$ language plpgsql;
