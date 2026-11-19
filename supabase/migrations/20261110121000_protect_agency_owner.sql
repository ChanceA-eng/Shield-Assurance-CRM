begin;

create function public.protect_agency_owner_access()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then
    if old.role='owner' then
      raise exception 'Owner access cannot be removed.' using errcode='42501';
    end if;
    return old;
  end if;
  if new.role is distinct from old.role and (old.role='owner' or new.role='owner') then
    raise exception 'Owner access cannot be changed through Team.' using errcode='42501';
  end if;
  if old.role='owner' and (
    new.user_id is distinct from old.user_id or new.active is distinct from old.active
    or new.team_role_id is distinct from old.team_role_id
    or new.access_exceptions is distinct from old.access_exceptions
    or new.access_version is distinct from old.access_version
  ) then
    raise exception 'Owner access cannot be changed through Team.' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger protect_agency_owner_access
before update or delete on public.agency_members
for each row execute function public.protect_agency_owner_access();
revoke all on function public.protect_agency_owner_access() from public,anon,authenticated,service_role;

commit;
