begin;

create view public.active_workspace_tasks
with (security_invoker = true) as
select t.*
from public.tasks t
where not exists (
  select 1 from public.leads l
  where t.related_type = 'lead' and l.id = t.related_id and l.archived_at is not null
);

revoke all on public.active_workspace_tasks from public, anon, authenticated;
grant select on public.active_workspace_tasks to service_role;

create or replace function public.crm_shell_summary()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  result jsonb;
  agency_zone text;
  next_midnight timestamptz;
begin
  select timezone into strict agency_zone from public.outreach_settings where id=1;
  if agency_zone is null then raise exception 'Agency time zone is missing.'; end if;
  next_midnight := (date_trunc('day',now() at time zone agency_zone)+interval '1 day') at time zone agency_zone;
  perform public.dispatch_due_reminders();
  select jsonb_build_object(
    'overdueCount',count(*) filter(where due_date<now()),
    'dueTodayCount',count(*) filter(where due_date<next_midnight)
  ) into result from public.active_workspace_tasks where status='open';
  return result||jsonb_build_object(
    'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id) from (
      select id,type,message,href,read,created_at from public.notifications order by created_at desc,id limit 100
    ) n),'[]'::jsonb),
    'unreadCount',(select count(*) from public.notifications where read=false),
    'unreadMessages',public.unread_message_summary());
end;
$$;
revoke all on function public.crm_shell_summary() from public,anon,authenticated;
grant execute on function public.crm_shell_summary() to service_role;

notify pgrst, 'reload schema';

commit;
