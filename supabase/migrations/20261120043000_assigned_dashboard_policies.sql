begin;

create function public.require_assigned_dashboard_policies(p_actor uuid) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.team_has_permission(p_actor,'accounts.view','assigned')
    or not public.team_has_permission(p_actor,'policies.view','assigned') then
    raise exception 'Assigned account and policy access is required.' using errcode='42501';
  end if;
end;
$$;

create function public.team_assigned_premium_summary(p_actor uuid,p_first_month date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform public.require_assigned_dashboard_policies(p_actor);
  if p_first_month is null then raise exception 'A valid reporting month is required.' using errcode='22023'; end if;
  with months as (
    select generate_series(p_first_month::timestamp,p_first_month::timestamp+interval '11 months',interval '1 month')::date as month
  ), premiums as (
    select date_trunc('month',p.effective_date)::date as month,sum(coalesce(p.premium,0)) as premium
    from public.policies p join public.clients c on c.id=p.client_id
    where c.agent_user_id=p_actor group by 1
  )
  select jsonb_build_object(
    'total',(select coalesce(sum(premium),0) from premiums),
    'months',(select jsonb_agg(jsonb_build_object('month',to_char(m.month,'YYYY-MM'),'premium',coalesce(p.premium,0)) order by m.month)
      from months m left join premiums p on p.month=m.month)) into result;
  return result;
end;
$$;

create function public.team_assigned_dashboard_renewals(p_actor uuid) returns setof public.renewals
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_assigned_dashboard_policies(p_actor);
  return query select r.* from public.renewals r
    join public.clients c on c.id=r.client_id where c.agent_user_id=p_actor;
end;
$$;

create function public.team_assigned_dashboard_claims(p_actor uuid) returns setof public.claims
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_assigned_dashboard_policies(p_actor);
  return query select cl.* from public.claims cl
    join public.policies p on p.id=cl.policy_id and p.client_id=cl.client_id
    join public.clients c on c.id=p.client_id where c.agent_user_id=p_actor;
end;
$$;

revoke all on function public.require_assigned_dashboard_policies(uuid),public.team_assigned_premium_summary(uuid,date),
  public.team_assigned_dashboard_renewals(uuid),public.team_assigned_dashboard_claims(uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_assigned_premium_summary(uuid,date),public.team_assigned_dashboard_renewals(uuid),
  public.team_assigned_dashboard_claims(uuid) to service_role;
notify pgrst,'reload schema';
commit;
