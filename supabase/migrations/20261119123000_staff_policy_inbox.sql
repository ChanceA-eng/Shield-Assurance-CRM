begin;

create function public.can_administer_policies(p_actor uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from agency_members m
    join auth.users u on u.id=m.user_id
    cross join team_access_rollout r
    where r.singleton and m.user_id=p_actor and m.active and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
      and (m.role='owner'
        or (not r.enabled and m.invitation_id is null and m.role='admin')
        or (r.enabled and m.team_role_id='admin' and public.team_effective_access(p_actor)
          @> '{"accounts.view":"agency","policies.view":"agency","policies.edit":"agency"}'::jsonb))
  );
$$;

create or replace function public.team_request_access() returns jsonb
language sql stable security definer set search_path=public as $$
  select (case
    when actor.role='owner' and actor.active then '{"mode":"legacy"}'::jsonb
    when actor.invitation_id is not null or rollout.enabled then
      jsonb_build_object('mode','restricted','grants',
        case when rollout.enabled then public.team_effective_access(auth.uid()) else '{}'::jsonb end)
    else '{"mode":"legacy"}'::jsonb
  end) || jsonb_build_object('policyAdmin',public.can_administer_policies(auth.uid()))
  from public.team_access_rollout rollout
  left join public.agency_members actor on actor.user_id=auth.uid()
  where rollout.singleton;
$$;

revoke insert,update,delete,truncate on public.policies from public,anon,authenticated;

create table public.staff_policy_requests (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete restrict,
  account_id uuid not null references public.clients(id) on delete restrict,
  requested_by uuid not null references auth.users(id),
  description text not null check(length(btrim(description)) between 1 and 4000),
  priority smallint not null check(priority between 1 and 3),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  outcome text check(outcome in ('handled','declined')),
  check ((resolved_at is null and resolved_by is null and outcome is null)
     or (resolved_at is not null and resolved_by is not null and outcome is not null))
);
create index staff_policy_requests_queue on public.staff_policy_requests(priority desc,created_at,id) where outcome is null;
alter table public.staff_policy_requests enable row level security;
revoke all on public.staff_policy_requests from public,anon,authenticated,service_role;

create function public.submit_staff_policy_request(p_actor uuid,p_policy uuid,p_priority smallint,p_description text)
returns uuid language plpgsql security definer set search_path=public as $$
declare grants jsonb; account_id_found uuid; saved uuid;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from team_access_rollout where singleton and enabled) then
    raise exception 'Staff policy requests are not enabled.' using errcode='42501';
  end if;
  grants:=public.team_effective_access(p_actor);
  if coalesce(grants->>'accounts.view','') not in ('agency','assigned')
    or coalesce(grants->>'policies.view','') not in ('agency','assigned')
    or coalesce(grants->>'policies.edit','') not in ('agency','assigned') then
    raise exception 'You cannot submit policy changes.' using errcode='42501';
  end if;
  select a.id into account_id_found from policies p join clients a on a.id=p.client_id
  where p.id=p_policy and (
    (grants->>'accounts.view'='agency' and grants->>'policies.view'='agency' and grants->>'policies.edit'='agency')
    or a.agent_user_id=p_actor
  ) for share of p,a;
  if not found then raise exception 'Policy not found.' using errcode='P0002'; end if;
  insert into staff_policy_requests(policy_id,account_id,requested_by,priority,description)
  values(p_policy,account_id_found,p_actor,p_priority,btrim(p_description)) returning id into saved;
  return saved;
end;
$$;

create function public.list_staff_policy_requests(p_actor uuid,p_page integer,p_closed boolean)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_administer_policies(p_actor) then
    raise exception 'Only administrators can open this inbox.' using errcode='42501';
  end if;
  return query select jsonb_build_object('id',r.id,'policy_id',r.policy_id,'account_id',r.account_id,
    'account_name',a.full_name,'policy_number',p.policy_number,'carrier',p.carrier,'policy_linked',p.id is not null,
    'requested_by',u.email,'priority',r.priority,'description',r.description,
    'created_at',r.created_at,'outcome',r.outcome,'resolved_at',r.resolved_at)
  from staff_policy_requests r join clients a on a.id=r.account_id
  left join policies p on p.id=r.policy_id and p.client_id=r.account_id
  join auth.users u on u.id=r.requested_by
  where (r.outcome is not null)=p_closed
  order by case when p_closed then r.resolved_at end desc, r.priority desc,r.created_at,r.id
  limit 26 offset (p_page*25);
end;
$$;

create function public.resolve_staff_policy_request(p_actor uuid,p_request uuid,p_outcome text)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not public.can_administer_policies(p_actor) then
    raise exception 'Only administrators can resolve these requests.' using errcode='42501';
  end if;
  if p_outcome is null or p_outcome not in ('handled','declined') then
    raise exception 'Choose a review outcome.' using errcode='22023';
  end if;
  update staff_policy_requests set outcome=p_outcome,resolved_at=clock_timestamp(),resolved_by=p_actor
  where id=p_request and outcome is null;
  if not found then raise exception 'This request is no longer open. Refresh the inbox.' using errcode='PT409'; end if;
end;
$$;

create function public.correct_staff_request_policy(p_actor uuid,p_request uuid,p_carrier text,p_number text)
returns void language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not public.can_administer_policies(p_actor) then
    raise exception 'Only administrators can change policy records.' using errcode='42501';
  end if;
  if coalesce(length(btrim(p_carrier)),0) not between 1 and 200
    or coalesce(length(btrim(p_number)),0) not between 1 and 100 then
    raise exception 'Enter a carrier and policy number.' using errcode='22023';
  end if;
  select p.id into target from staff_policy_requests r join policies p on p.id=r.policy_id and p.client_id=r.account_id
  where r.id=p_request and r.outcome is null for update of r,p;
  if not found then raise exception 'This request or its policy is no longer available.' using errcode='P0002'; end if;
  perform public.update_policy_record_atomic(target,jsonb_build_object('carrier',btrim(p_carrier),'policy_number',btrim(p_number)),p_actor::text);
end;
$$;

revoke all on function public.can_administer_policies(uuid),public.submit_staff_policy_request(uuid,uuid,smallint,text),
  public.list_staff_policy_requests(uuid,integer,boolean),public.resolve_staff_policy_request(uuid,uuid,text),
  public.correct_staff_request_policy(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.submit_staff_policy_request(uuid,uuid,smallint,text),
  public.list_staff_policy_requests(uuid,integer,boolean),public.resolve_staff_policy_request(uuid,uuid,text),
  public.correct_staff_request_policy(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
