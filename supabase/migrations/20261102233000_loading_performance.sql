begin;

create function public.crm_shell_summary()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.dispatch_due_reminders();
  select jsonb_build_object(
    'overdueCount',count(*) filter(where due_date<now()),
    'dueTodayCount',count(*) filter(where due_date<(
      date_trunc('day',now() at time zone 'America/Phoenix')+interval '1 day') at time zone 'America/Phoenix')
  ) into result from public.tasks where status='open';
  return result||jsonb_build_object(
    'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id) from (
      select id,type,message,href,read,created_at from public.notifications order by created_at desc,id limit 100
    ) n),'[]'::jsonb),
    'unreadCount',(select count(*) from public.notifications where read=false),
    'unreadMessages',public.unread_message_summary());
end;
$$;

create function public.home_premium_summary(p_first_month date)
returns jsonb language sql stable security definer set search_path=public as $$
with months as (
  select generate_series(p_first_month::timestamp,p_first_month::timestamp+interval '11 months',interval '1 month')::date as month
), premiums as (
  select date_trunc('month',effective_date)::date as month,sum(coalesce(premium,0)) as premium
  from public.policies group by 1
)
select jsonb_build_object(
  'total',(select coalesce(sum(premium),0) from premiums),
  'months',(select jsonb_agg(jsonb_build_object('month',to_char(m.month,'YYYY-MM'),'premium',coalesce(p.premium,0)) order by m.month)
    from months m left join premiums p on p.month=m.month));
$$;

revoke all on function public.crm_shell_summary(),public.home_premium_summary(date) from public,anon,authenticated;
grant execute on function public.crm_shell_summary(),public.home_premium_summary(date) to service_role;
notify pgrst,'reload schema';
commit;
