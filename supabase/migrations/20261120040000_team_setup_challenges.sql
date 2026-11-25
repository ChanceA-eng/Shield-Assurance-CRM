begin;

alter table public.agency_members
  add column if not exists contact_phone text,
  add column if not exists mailing_address text;

create function public.require_pending_team_grants() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.direct_grants is not null and new.direct_grants='{}'::jsonb
    and new.setup_state in ('pending','delivery_failed','sent') then
    raise exception 'Choose at least one permission for this member.' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger require_pending_team_grants before insert or update of direct_grants,setup_state on public.agency_members
  for each row execute function public.require_pending_team_grants();

create table public.team_setup_challenges (
  user_id uuid primary key references public.agency_members(user_id) on delete cascade,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  sent boolean not null default false
);
alter table public.team_setup_challenges enable row level security;
revoke all on public.team_setup_challenges from public, anon, authenticated, service_role;

create function public.begin_team_setup(p_actor uuid, p_target uuid, p_digest text) returns void
language plpgsql security definer set search_path=public as $$
declare manager agency_members; target agency_members;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then raise exception 'Team administration is required.' using errcode='42501'; end if;
  select * into manager from agency_members where user_id=p_actor;
  select * into target from agency_members where user_id=p_target for update;
  if target.user_id is null or target.active or coalesce(target.setup_state,'') not in ('pending','delivery_failed','sent')
    or (manager.direct_grants is not null and (target.direct_grants is null
      or not team_access_within(target.direct_grants,manager.direct_grants))) then
    raise exception 'You cannot manage this pending setup.' using errcode='42501';
  end if;
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid setup challenge.' using errcode='22023';
  end if;
  insert into team_setup_challenges(user_id,digest,expires_at,sent)
    values(p_target,p_digest,now()+interval '24 hours',false)
    on conflict(user_id) do update set digest=excluded.digest,expires_at=excluded.expires_at,sent=false;
  update agency_members set setup_state='pending',team_invited_by=p_actor,access_version=access_version+1,updated_at=now() where user_id=p_target;
end;
$$;

create function public.finish_team_setup(p_actor uuid,p_target uuid,p_digest text,p_sent boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if p_sent is null then raise exception 'Choose a delivery result.' using errcode='22023'; end if;
  if not exists(select 1 from team_setup_challenges where user_id=p_target and digest=p_digest and expires_at>now() for update) then
    raise exception 'This setup link was replaced or expired. Use the latest invitation.' using errcode='PT409';
  end if;
  perform record_team_setup_email(p_actor,p_target,p_sent);
  update team_setup_challenges set sent=p_sent where user_id=p_target and digest=p_digest;
end;
$$;

create function public.verify_team_setup(p_actor uuid,p_digest text) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists (
    select 1 from team_setup_challenges c
    join agency_members m on m.user_id=c.user_id
    join agency_members inviter on inviter.user_id=m.team_invited_by
    join auth.users u on u.id=m.user_id
    where c.user_id=p_actor and c.digest=p_digest and c.sent and c.expires_at>now()
      and not m.active and m.setup_state='sent' and team_profile_manager(m.team_invited_by)
      and (inviter.direct_grants is null or team_access_within(m.direct_grants,inviter.direct_grants))
      and lower(u.email)=lower(m.email) and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
  ) then raise exception 'This setup link is expired, replaced or unavailable. Ask your administrator for a new link.' using errcode='42501'; end if;
end;
$$;

create function public.claim_team_setup(p_target uuid,p_digest text) returns text
language plpgsql security definer set search_path=public as $$
declare address text;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  select m.email into address from team_setup_challenges c
    join agency_members m on m.user_id=c.user_id
    join agency_members inviter on inviter.user_id=m.team_invited_by
    join auth.users u on u.id=m.user_id
    where c.user_id=p_target and c.digest=p_digest and c.sent and c.expires_at>now()
      and not m.active and m.setup_state='sent' and team_profile_manager(m.team_invited_by)
      and (inviter.direct_grants is null or team_access_within(m.direct_grants,inviter.direct_grants))
      and lower(u.email)=lower(m.email) and (u.banned_until is null or u.banned_until<=now());
  if address is null then raise exception 'This setup link is expired, replaced or unavailable. Ask your administrator for a new link.' using errcode='42501'; end if;
  return address;
end;
$$;

create function public.complete_team_setup(p_actor uuid,p_digest text,p_phone text,p_address text) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  perform verify_team_setup(p_actor,p_digest);
  if p_phone is null or length(btrim(p_phone)) not between 7 and 32
    or (p_address is not null and length(btrim(p_address))>300) then
    raise exception 'Enter a phone number and an optional mailing address.' using errcode='22023';
  end if;
  perform accept_team_profile(p_actor);
  update agency_members set contact_phone=btrim(p_phone),mailing_address=nullif(btrim(p_address),'') where user_id=p_actor;
  delete from team_setup_challenges where user_id=p_actor;
end;
$$;

revoke execute on function public.accept_team_profile(uuid) from service_role;
revoke all on function public.begin_team_setup(uuid,uuid,text),public.finish_team_setup(uuid,uuid,text,boolean),
  public.verify_team_setup(uuid,text),public.claim_team_setup(uuid,text),public.complete_team_setup(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.begin_team_setup(uuid,uuid,text),public.finish_team_setup(uuid,uuid,text,boolean),
  public.verify_team_setup(uuid,text),public.claim_team_setup(uuid,text),public.complete_team_setup(uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
