begin;

create function public.team_dispatch_allowed(p_actor uuid,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
  select case
    when actor.user_id is null or not actor.active then false
    when actor.role='owner' then true
    when not rollout.enabled then actor.invitation_id is null
    else coalesce(public.team_effective_access(p_actor)->>p_permission='agency',false)
  end
  from public.team_access_rollout rollout
  left join public.agency_members actor on actor.user_id=p_actor
  where rollout.singleton;
$$;
revoke all on function public.team_dispatch_allowed(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.team_dispatch_allowed(uuid,text) to service_role;

create function public.team_record_dispatch_allowed(p_actor uuid,p_lead uuid,p_client uuid) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare actor agency_members; rollout team_access_rollout; grants jsonb; send_scope text;
begin
  select * into actor from agency_members where user_id=p_actor;
  select * into rollout from team_access_rollout where singleton;
  if actor.user_id is null or not actor.active then return false; end if;
  if rollout.enabled and not exists(select 1 from auth.users u where u.id=p_actor
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then return false; end if;
  if actor.role='owner' or (not rollout.enabled and actor.invitation_id is null) then return true; end if;
  if not rollout.enabled then return false; end if;
  grants:=team_effective_access(p_actor);
  send_scope:=grants->>'messages.send';
  if send_scope not in ('agency','assigned') or send_scope is null then return false; end if;
  if p_lead is null and p_client is null then
    -- An unmatched address may have since acquired a CRM record.
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
revoke all on function public.team_record_dispatch_allowed(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_record_dispatch_allowed(uuid,uuid,uuid) to service_role;

-- Unattributed legacy manual schedules remain usable only before Team enforcement.
create function public.team_scheduled_dispatch_allowed(p_actor uuid,p_lead uuid,p_client uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select case when p_actor is null then
    coalesce((select not enabled from team_access_rollout where singleton),false)
  else team_record_dispatch_allowed(p_actor,p_lead,p_client) end;
$$;
revoke all on function public.team_scheduled_dispatch_allowed(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_scheduled_dispatch_allowed(uuid,uuid,uuid) to service_role;

create function public.check_team_social_dispatch() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not coalesce(public.team_dispatch_allowed(new.approved_by,'social.publish'),false) then
    raise exception 'Publishing access changed before dispatch.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.check_team_social_dispatch() from public,anon,authenticated,service_role;
create trigger check_team_social_dispatch before update of publish_dispatched_at on public.social_intents
  for each row when (old.publish_dispatched_at is null and new.publish_dispatched_at is not null)
  execute function public.check_team_social_dispatch();

notify pgrst,'reload schema';
commit;
