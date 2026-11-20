begin;

alter table public.tasks
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

create or replace function public.save_team_profile(p_actor uuid,p_target uuid,p_email text,p_name text,p_title text,
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

create or replace function public.team_dispatch_allowed(p_actor uuid,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
  select case
    when actor.user_id is null or not actor.active then false
    when rollout.enabled and not exists(select 1 from auth.users u where u.id=p_actor
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then false
    when actor.role='owner' then true
    when actor.direct_grants is not null then coalesce(actor.direct_grants->>p_permission='agency',false)
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
  if actor.user_id is null or not actor.active then return false; end if;
  if rollout.enabled and not exists(select 1 from auth.users u where u.id=p_actor
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then return false; end if;
  if actor.role='owner' or (not rollout.enabled and actor.invitation_id is null and actor.direct_grants is null) then return true; end if;
  if not rollout.enabled and actor.direct_grants is null then return false; end if;
  grants:=coalesce(actor.direct_grants,public.team_effective_access(p_actor));
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

do $$
declare target record;
begin
  for target in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and c.relrowsecurity and (
      (n.nspname='public' and c.relname not in ('agency_members'))
      or (n.nspname='storage' and c.relname='objects')
    )
      and not exists (
        select 1 from pg_policy policy
        where policy.polrelid=c.oid and policy.polname='team_legacy_database_access'
      )
  loop
    execute format('create policy team_legacy_database_access on %I.%I as restrictive for all to authenticated using ((select public.team_legacy_database_access())) with check ((select public.team_legacy_database_access()))',
      target.nspname,target.relname);
  end loop;
end;
$$;

revoke all on function public.team_dispatch_allowed(uuid,text),
  public.team_record_dispatch_allowed(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_dispatch_allowed(uuid,text),
  public.team_record_dispatch_allowed(uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
