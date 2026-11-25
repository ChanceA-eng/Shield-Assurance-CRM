begin;

create table public.team_profile_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 80),
  grants jsonb not null,
  active boolean not null default true,
  version integer not null default 1 check(version>0),
  updated_at timestamptz not null default now()
);
create unique index team_profile_presets_name on public.team_profile_presets(lower(btrim(name)));
alter table public.team_profile_presets enable row level security;
revoke all on public.team_profile_presets from public,anon,authenticated,service_role;

create function public.list_team_profile_presets(p_actor uuid)
returns table(id uuid,name text,grants jsonb,active boolean,version integer)
language plpgsql stable security definer set search_path=public as $$
declare ceiling jsonb;
begin
  if not team_profile_manager(p_actor) then
    raise exception 'Team administration is required.' using errcode='42501';
  end if;
  select direct_grants into ceiling from agency_members where user_id=p_actor;
  return query select p.id,p.name,p.grants,p.active,p.version from team_profile_presets p
    where ceiling is null or team_access_within(p.grants,ceiling)
    order by lower(p.name),p.id;
end;
$$;

create function public.save_team_profile_preset(
  p_actor uuid,p_id uuid,p_name text,p_grants jsonb,p_active boolean,p_version integer
) returns void language plpgsql security definer set search_path=public as $$
declare ceiling jsonb; previous team_profile_presets; saved_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then
    raise exception 'Team administration is required.' using errcode='42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_active is null then
    raise exception 'Enter a preset name and status.' using errcode='22023';
  end if;
  perform team_validate_access(p_grants);
  if p_grants='{}'::jsonb then raise exception 'Choose at least one permission.' using errcode='22023'; end if;
  select direct_grants into ceiling from agency_members where user_id=p_actor;
  if ceiling is not null and not team_access_within(p_grants,ceiling) then
    raise exception 'You cannot grant access beyond your own permissions.' using errcode='42501';
  end if;
  if p_id is null then
    if p_version is not null then raise exception 'Reload presets before saving.' using errcode='PT409'; end if;
    insert into team_profile_presets(name,grants,active) values(btrim(p_name),p_grants,p_active) returning id into saved_id;
  else
    select * into previous from team_profile_presets where id=p_id for update;
    if not found or p_version is null or previous.version<>p_version then
      raise exception 'This preset changed. Reload Team before saving.' using errcode='PT409';
    end if;
    if ceiling is not null and not team_access_within(previous.grants,ceiling) then
      raise exception 'You cannot manage this preset.' using errcode='42501';
    end if;
    update team_profile_presets set name=btrim(p_name),grants=p_grants,active=p_active,
      version=version+1,updated_at=now() where id=p_id returning id into saved_id;
  end if;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,saved_id,'team_preset_saved',jsonb_build_object('name',btrim(p_name),'active',p_active));
end;
$$;
revoke all on function public.list_team_profile_presets(uuid),
  public.save_team_profile_preset(uuid,uuid,text,jsonb,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_team_profile_presets(uuid),
  public.save_team_profile_preset(uuid,uuid,text,jsonb,boolean,integer) to service_role;
notify pgrst,'reload schema';
commit;
