begin;

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
  if exists (select 1 from jsonb_object_keys(p_grants) as g(permission) where permission not in
    ('leads.view','accounts.view','accounts.edit','policies.view','policies.edit','documents.view','documents.edit','social.view','social.edit','knowledge.view','team.manage')) then
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

notify pgrst,'reload schema';
commit;
