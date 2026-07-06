alter table if exists public.clients
  add column if not exists policy_effective_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists last_activity_at timestamptz default now();

create index if not exists idx_clients_notification_tracking
  on public.clients (policy_effective_at, last_viewed_at, last_activity_at);

create or replace function public.get_actionable_clients_count()
returns integer as $$
declare
  total_alerts integer;
begin
  select count(*) into total_alerts
  from public.clients
  where (
    coalesce(last_activity_at, created_at) > coalesce(last_viewed_at, to_timestamp(0))
    or (
      policy_effective_at <= now() - interval '30 days'
      and (last_viewed_at is null or last_viewed_at < policy_effective_at + interval '30 days')
    )
    or (
      policy_effective_at <= now() - interval '45 days'
      and (last_viewed_at is null or last_viewed_at < policy_effective_at + interval '45 days')
    )
  );

  return total_alerts;
end;
$$ language plpgsql;