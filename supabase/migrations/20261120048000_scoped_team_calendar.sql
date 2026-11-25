begin;

create function public.team_calendar_allowed(p_actor uuid,p_owner uuid,p_type text,p_related uuid,p_client uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare assigned_only boolean;
begin
  if p_owner is distinct from p_actor or p_permission not in ('calendar.view','calendar.edit')
    or not exists(select 1 from agency_members m join auth.users u on u.id=m.user_id
      where m.user_id=p_actor and m.active and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=now()))
    or not team_has_permission(p_actor,p_permission,'self') then return false; end if;
  assigned_only:=team_has_permission(p_actor,p_permission,'assigned')
    and not team_has_permission(p_actor,p_permission,'agency');
  if (p_type is null)<>(p_related is null) then return false; end if;
  if p_type='lead' then
    if not exists(select 1 from leads l where l.id=p_related
      and (team_has_permission(p_actor,'leads.view','agency')
        or (team_has_permission(p_actor,'leads.view','assigned') and l.agent_user_id=p_actor))
      and (not assigned_only or l.agent_user_id=p_actor)
      and (l.account_id is null or exists(select 1 from clients c where c.id=l.account_id
        and (team_has_permission(p_actor,'accounts.view','agency')
          or (team_has_permission(p_actor,'accounts.view','assigned') and c.agent_user_id=p_actor))
        and (not assigned_only or c.agent_user_id=p_actor)))) then return false; end if;
  elsif p_type='client' then
    if not exists(select 1 from clients c where c.id=p_related
      and (team_has_permission(p_actor,'accounts.view','agency')
        or (team_has_permission(p_actor,'accounts.view','assigned') and c.agent_user_id=p_actor))
      and (not assigned_only or c.agent_user_id=p_actor)) then return false; end if;
  elsif p_type is not null then
    return false;
  end if;
  if p_client is not null and not exists(select 1 from clients c where c.id=p_client
    and (team_has_permission(p_actor,'accounts.view','agency')
      or (team_has_permission(p_actor,'accounts.view','assigned') and c.agent_user_id=p_actor))
    and (not assigned_only or c.agent_user_id=p_actor)) then return false; end if;
  return true;
end;
$$;

create function public.team_calendar_events(p_actor uuid) returns setof public.events
language plpgsql stable security definer set search_path=public as $$
begin
  if not team_has_permission(p_actor,'calendar.view','self') then
    raise exception 'Calendar access is required.' using errcode='42501';
  end if;
  return query select e.* from events e where e.user_id=p_actor
    and team_calendar_allowed(p_actor,e.user_id,e.related_type,e.related_id,e.client_id,'calendar.view');
end;
$$;

create function public.assert_team_calendar_access(p_actor uuid,p_event uuid,p_permission text) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from events e where e.id=p_event
    and team_calendar_allowed(p_actor,e.user_id,e.related_type,e.related_id,e.client_id,p_permission)) then
    raise exception 'This appointment is outside your calendar or record access.' using errcode='42501';
  end if;
end;
$$;

do $migration$
declare target regprocedure; definition text; patch record;
begin
  for patch in select * from (values
    ('public.save_calendar_event(uuid,jsonb,boolean,text,uuid)',
      '  select role into member_role from agency_members where user_id=p_user and active;',
      '  perform pg_advisory_xact_lock(hashtext(''agency-membership''));' || chr(10) ||
      '  select role into member_role from agency_members where user_id=p_user and active;'),
    ('public.save_calendar_event(uuid,jsonb,boolean,text,uuid)',
      '  saved.client_id:=account;',
      '  if not public.team_calendar_allowed(p_user,p_user,saved.related_type,saved.related_id,account,''calendar.edit'') then raise exception ''Calendar editing and linked record access are required.'' using errcode=''42501''; end if;' || chr(10) ||
      '  if original.id is not null then perform public.assert_team_calendar_access(p_user,p_id,''calendar.edit''); end if;' || chr(10) ||
      '  saved.client_id:=account;'),
    ('public.claim_appointment_sync(uuid,uuid,uuid)',
      '  perform pg_advisory_xact_lock(hashtextextended(''calendar-owner:''||p_user::text,0));',
      '  perform public.assert_team_calendar_access(p_user,p_id,''calendar.edit'');' || chr(10) ||
      '  perform pg_advisory_xact_lock(hashtextextended(''calendar-owner:''||p_user::text,0));'),
    ('public.claim_appointment_notification(uuid,uuid,integer,uuid)',
      '  perform pg_advisory_xact_lock(hashtextextended(''calendar-owner:''||p_user::text,0));',
      '  perform public.assert_team_calendar_access(p_user,p_id,''calendar.edit'');' || chr(10) ||
      '  perform pg_advisory_xact_lock(hashtextextended(''calendar-owner:''||p_user::text,0));')
  ) as changes(signature,old_text,new_text)
  loop
    target:=to_regprocedure(patch.signature);
    if target is null then raise exception 'Required calendar contract missing: %',patch.signature; end if;
    definition:=replace(pg_get_functiondef(target),chr(13)||chr(10),chr(10));
    if strpos(definition,patch.old_text)=0 then raise exception 'Calendar contract changed: %',patch.signature; end if;
    execute replace(definition,patch.old_text,patch.new_text);
  end loop;
end;
$migration$;

revoke all on function public.team_calendar_allowed(uuid,uuid,text,uuid,uuid,text),
  public.team_calendar_events(uuid),public.assert_team_calendar_access(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.team_calendar_events(uuid),public.assert_team_calendar_access(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
