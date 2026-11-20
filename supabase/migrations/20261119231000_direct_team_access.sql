begin;

alter table public.agency_members
  add column team_name text check (length(btrim(team_name)) between 1 and 120),
  add column role_title text check (length(btrim(role_title)) between 1 and 80),
  add column direct_grants jsonb,
  add column team_invited_by uuid references auth.users(id),
  add column setup_state text check (setup_state in ('pending','delivery_failed','sent','accepted','revoked')),
  add constraint direct_team_member check (direct_grants is null or
    (role='agent' and jsonb_typeof(direct_grants)='object' and setup_state is not null
      and (not active or setup_state='accepted')));

create function public.team_profile_manager(p_actor uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from agency_members m join auth.users u on u.id=m.user_id
    where m.user_id=p_actor and m.active and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
      and (m.role='owner' or (m.role='admin' and m.invitation_id is null
        and not exists(select 1 from team_access_rollout where enabled))
        or m.direct_grants->>'team.manage'='agency')
  );
$$;

create function public.save_team_profile(p_actor uuid,p_target uuid,p_email text,p_name text,p_title text,
  p_grants jsonb,p_active boolean,p_version integer) returns void
language plpgsql security definer set search_path=public as $$
declare target agency_members; owner_actor boolean; ceiling jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then
    raise exception 'Team administration is required.' using errcode='42501';
  end if;
  select role='owner' into owner_actor from agency_members where user_id=p_actor;
  if p_title is null or length(btrim(p_title)) not between 1 and 80 or p_active is null or p_grants is null then
    raise exception 'Enter a role title and choose access.' using errcode='22023';
  end if;
  perform team_validate_access(p_grants);
  if exists (select 1 from jsonb_object_keys(p_grants) as g(permission) where permission not in
    ('leads.view','accounts.view','accounts.edit','policies.view','policies.edit','documents.view','documents.edit','social.view','social.edit','team.manage')) then
    raise exception 'Choose only permissions supported by the staff workspace.' using errcode='22023';
  end if;
  select direct_grants into ceiling from agency_members where user_id=p_actor;
  if ceiling is not null and not team_access_within(p_grants,ceiling) then
    raise exception 'You cannot grant access beyond your own permissions.' using errcode='42501';
  end if;
  select * into target from agency_members where user_id=p_target for update;
  if p_version is null then
    if found or p_active or p_name is null or length(btrim(p_name)) not between 1 and 120 or not exists (
      select 1 from auth.users where id=p_target and lower(email)=p_email and email_confirmed_at is null
    ) then raise exception 'The recipient already has access or could not be verified.' using errcode='PT409'; end if;
    insert into agency_members(user_id,email,role,active,team_name,role_title,direct_grants,setup_state,team_invited_by)
      values(p_target,p_email,'agent',false,btrim(p_name),btrim(p_title),p_grants,'pending',p_actor);
  else
    if not found or target.role='owner' or target.invitation_id is not null and target.direct_grants is null
      or (target.role='admin' and not owner_actor) or (ceiling is not null
        and (target.direct_grants is null or not team_access_within(target.direct_grants,ceiling))) then
      raise exception 'You cannot change this membership.' using errcode='42501';
    end if;
    if target.access_version<>p_version then
      raise exception 'This member changed. Reload Team before saving.' using errcode='PT409';
    end if;
    if p_active and target.setup_state <> 'accepted' then
      raise exception 'The recipient must complete setup first.' using errcode='PT409';
    end if;
    update agency_members set role='agent',team_role_id=null,access_exceptions='{}',active=p_active,
      role_title=btrim(p_title),direct_grants=p_grants,setup_state=coalesce(target.setup_state,'accepted'),
      access_version=access_version+1,updated_at=now() where user_id=p_target;
  end if;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,p_target,case when p_version is null then 'team_profile_invited' else 'team_profile_updated' end,
      jsonb_build_object('role_title',btrim(p_title),'grants',p_grants,'active',p_active));
end;
$$;

create function public.revoke_team_profile(p_actor uuid,p_target uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then raise exception 'Team administration is required.' using errcode='42501'; end if;
  if exists(select 1 from agency_members a cross join agency_members t
    where a.user_id=p_actor and t.user_id=p_target and a.direct_grants is not null
      and (t.direct_grants is null or not team_access_within(t.direct_grants,a.direct_grants))) then
    raise exception 'You cannot manage access beyond your own permissions.' using errcode='42501';
  end if;
  update agency_members set setup_state='revoked',access_version=access_version+1,updated_at=now()
    where user_id=p_target and not active and setup_state in ('pending','delivery_failed','sent');
  if not found then raise exception 'Only pending setup links can be revoked.' using errcode='PT409'; end if;
  insert into agency_audit(actor_id,target_id,action) values(p_actor,p_target,'team_profile_revoked');
end;
$$;

create function public.record_team_setup_email(p_actor uuid,p_target uuid,p_sent boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then raise exception 'Team administration is required.' using errcode='42501'; end if;
  if exists(select 1 from agency_members a cross join agency_members t
    where a.user_id=p_actor and t.user_id=p_target and a.direct_grants is not null
      and (t.direct_grants is null or not team_access_within(t.direct_grants,a.direct_grants))) then
    raise exception 'You cannot manage access beyond your own permissions.' using errcode='42501';
  end if;
  update agency_members set setup_state=case when p_sent then 'sent' else 'delivery_failed' end,
    access_version=access_version+1,updated_at=now()
    where user_id=p_target and not active and setup_state in ('pending','delivery_failed','sent');
  if not found then raise exception 'This account has already completed setup.' using errcode='PT409'; end if;
  insert into agency_audit(actor_id,target_id,action) values(p_actor,p_target,
    case when p_sent then 'team_setup_email_accepted' else 'team_setup_email_unconfirmed' end);
end;
$$;

create function public.accept_team_profile(p_actor uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  update agency_members m set active=true,setup_state='accepted',access_version=access_version+1,updated_at=now()
    where m.user_id=p_actor and m.setup_state='sent' and not m.active
      and team_profile_manager(m.team_invited_by)
      and exists (select 1 from agency_members inviter where inviter.user_id=m.team_invited_by
        and (inviter.direct_grants is null or team_access_within(m.direct_grants,inviter.direct_grants)))
      and exists (select 1 from auth.users u where u.id=m.user_id and lower(u.email)=lower(m.email)
        and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()));
  if not found then raise exception 'An emailed invitation and verified recipient are required.' using errcode='42501'; end if;
  insert into agency_audit(actor_id,target_id,action) values(p_actor,p_actor,'team_profile_activated');
end;
$$;

-- New members are always restricted; existing memberships retain their current behavior until edited.
create or replace function public.team_request_access() returns jsonb
language sql stable security definer set search_path=public as $$
  select (case
    when actor.role='owner' and actor.active then '{"mode":"legacy"}'::jsonb
    when actor.direct_grants is not null then jsonb_build_object('mode','restricted','grants',
      case when actor.active and exists(select 1 from auth.users u where u.id=actor.user_id
        and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))
        then actor.direct_grants else '{}'::jsonb end)
    when actor.invitation_id is not null or rollout.enabled then
      jsonb_build_object('mode','restricted','grants',
        case when rollout.enabled then public.team_effective_access(auth.uid()) else '{}'::jsonb end)
    else '{"mode":"legacy"}'::jsonb
  end) || jsonb_build_object('policyAdmin',public.can_administer_policies(auth.uid()))
  from public.team_access_rollout rollout
  left join public.agency_members actor on actor.user_id=auth.uid()
  where rollout.singleton;
$$;

create or replace function public.submit_staff_policy_request(p_actor uuid,p_policy uuid,p_priority smallint,p_description text)
returns uuid language plpgsql security definer set search_path=public as $$
declare grants jsonb; account_id_found uuid; saved uuid;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  select m.direct_grants into grants from agency_members m join auth.users u on u.id=m.user_id
    where m.user_id=p_actor and m.active and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now());
  if grants is null then
    if not exists(select 1 from team_access_rollout where singleton and enabled) then
      raise exception 'Staff policy requests are not enabled.' using errcode='42501';
    end if;
    grants:=public.team_effective_access(p_actor);
  end if;
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

create or replace function public.team_dispatch_allowed(p_actor uuid,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
  select case
    when actor.user_id is null or not actor.active or actor.direct_grants is not null then false
    when actor.role='owner' then true
    when not rollout.enabled then actor.invitation_id is null
    else coalesce(public.team_effective_access(p_actor)->>p_permission='agency',false)
  end
  from public.team_access_rollout rollout
  left join public.agency_members actor on actor.user_id=p_actor
  where rollout.singleton;
$$;

create or replace function public.team_record_dispatch_allowed(p_actor uuid,p_lead uuid,p_client uuid) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare actor agency_members; rollout team_access_rollout; grants jsonb; send_scope text;
begin
  select * into actor from agency_members where user_id=p_actor;
  select * into rollout from team_access_rollout where singleton;
  if actor.user_id is null or not actor.active or actor.direct_grants is not null then return false; end if;
  if rollout.enabled and not exists(select 1 from auth.users u where u.id=p_actor
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then return false; end if;
  if actor.role='owner' or (not rollout.enabled and actor.invitation_id is null) then return true; end if;
  if not rollout.enabled then return false; end if;
  grants:=team_effective_access(p_actor);
  send_scope:=grants->>'messages.send';
  if send_scope not in ('agency','assigned') or send_scope is null then return false; end if;
  if p_lead is null and p_client is null then
    return coalesce(send_scope='agency' and grants->>'messages.view'='agency'
      and grants->>'leads.view'='agency' and grants->>'accounts.view'='agency',false);
  end if;
  if p_lead is not null and not exists (
    select 1 from leads l where l.id=p_lead
      and (send_scope='agency' or l.agent_user_id=p_actor)
      and (grants->>'leads.view'='agency' or (grants->>'leads.view'='assigned' and l.agent_user_id=p_actor))
  ) then return false; end if;
  if p_client is not null and not exists (
    select 1 from clients c where c.id=p_client
      and (send_scope='agency' or c.agent_user_id=p_actor)
      and (grants->>'accounts.view'='agency' or (grants->>'accounts.view'='assigned' and c.agent_user_id=p_actor))
  ) then return false; end if;
  return true;
end;
$$;

revoke all on function public.team_profile_manager(uuid),public.save_team_profile(uuid,uuid,text,text,text,jsonb,boolean,integer),
  public.record_team_setup_email(uuid,uuid,boolean),public.accept_team_profile(uuid),public.revoke_team_profile(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_profile_manager(uuid),public.save_team_profile(uuid,uuid,text,text,text,jsonb,boolean,integer),
  public.record_team_setup_email(uuid,uuid,boolean),public.accept_team_profile(uuid),public.revoke_team_profile(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
