begin;

create function public.read_team_contact(p_actor uuid,p_target uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare manager agency_members; target agency_members;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then raise exception 'Team administration is required.' using errcode='42501'; end if;
  select * into manager from agency_members where user_id=p_actor;
  select * into target from agency_members where user_id=p_target;
  if target.user_id is null or target.role='owner' or (target.role='admin' and manager.role<>'owner')
    or (manager.direct_grants is not null and (target.direct_grants is null
      or not team_access_within(target.direct_grants,manager.direct_grants))) then
    raise exception 'You cannot view this member profile.' using errcode='42501';
  end if;
  return jsonb_build_object('name',target.team_name,'phone',target.contact_phone,
    'address',target.mailing_address,'version',target.access_version);
end;
$$;

create function public.save_team_contact(p_actor uuid,p_target uuid,p_version integer,p_name text,p_phone text,p_address text)
returns void language plpgsql security definer set search_path=public as $$
declare manager agency_members; target agency_members;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then raise exception 'Team administration is required.' using errcode='42501'; end if;
  select * into manager from agency_members where user_id=p_actor;
  select * into target from agency_members where user_id=p_target for update;
  if target.user_id is null or target.role='owner' or (target.role='admin' and manager.role<>'owner')
    or (manager.direct_grants is not null and (target.direct_grants is null
      or not team_access_within(target.direct_grants,manager.direct_grants))) then
    raise exception 'You cannot change this membership.' using errcode='42501';
  end if;
  if target.access_version<>p_version or p_version is null then
    raise exception 'This member changed. Reload Team before saving.' using errcode='PT409';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120
    or (p_phone is not null and length(btrim(p_phone))>32)
    or (p_address is not null and length(btrim(p_address))>300) then
    raise exception 'Enter a name and valid contact details.' using errcode='22023';
  end if;
  update agency_members set team_name=btrim(p_name),contact_phone=nullif(btrim(p_phone),''),
    mailing_address=nullif(btrim(p_address),''),access_version=access_version+1,updated_at=now() where user_id=p_target;
  insert into agency_audit(actor_id,target_id,action) values(p_actor,p_target,'team_contact_updated');
end;
$$;

create function public.authorize_team_reset(p_actor uuid,p_target uuid) returns text
language plpgsql security definer set search_path=public as $$
declare manager agency_members; target agency_members;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then raise exception 'Team administration is required.' using errcode='42501'; end if;
  select * into manager from agency_members where user_id=p_actor;
  select * into target from agency_members where user_id=p_target for share;
  if target.user_id is null or not target.active or target.role='owner'
    or (target.role='admin' and manager.role<>'owner')
    or (manager.direct_grants is not null and (target.direct_grants is null
      or not team_access_within(target.direct_grants,manager.direct_grants)))
    or not exists(select 1 from auth.users u where u.id=p_target and lower(u.email)=lower(target.email)
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'You cannot reset this member account.' using errcode='42501';
  end if;
  return target.email;
end;
$$;

create function public.record_team_reset(p_actor uuid,p_target uuid,p_sent boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if p_sent is null then raise exception 'Choose a delivery result.' using errcode='22023'; end if;
  perform authorize_team_reset(p_actor,p_target);
  insert into agency_audit(actor_id,target_id,action) values(p_actor,p_target,
    case when p_sent then 'team_reset_email_accepted' else 'team_reset_email_unconfirmed' end);
end;
$$;

revoke all on function public.read_team_contact(uuid,uuid),public.save_team_contact(uuid,uuid,integer,text,text,text),public.authorize_team_reset(uuid,uuid),
  public.record_team_reset(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.read_team_contact(uuid,uuid),public.save_team_contact(uuid,uuid,integer,text,text,text),public.authorize_team_reset(uuid,uuid),
  public.record_team_reset(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
