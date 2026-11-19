begin;
create table public.agency_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  role text not null check(role in ('owner','admin','agent')),
  active boolean not null default true,
  sender_profile jsonb check(sender_profile is null or jsonb_typeof(sender_profile)='object'),
  gmail_ai_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.agency_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  target_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.clients add column agent_user_id uuid references public.agency_members(user_id);
alter table public.leads add column agent_user_id uuid references public.agency_members(user_id);
alter table public.agency_members enable row level security;
alter table public.agency_audit enable row level security;
create policy agency_member_self on public.agency_members for select to authenticated using(user_id=auth.uid() and active);
revoke all on public.agency_members, public.agency_audit from public,anon,authenticated;
grant select on public.agency_members to authenticated;
grant all on public.agency_members,public.agency_audit to service_role;
grant usage,select on sequence public.agency_audit_id_seq to service_role;

create function public.manage_agency_member(p_actor uuid,p_target uuid,p_role text,p_active boolean)
returns void language plpgsql security definer set search_path=public as $$
declare actor agency_members; target agency_members;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  select * into actor from agency_members where user_id=p_actor and active for update;
  if actor.user_id is null or actor.role not in ('owner','admin') then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into target from agency_members where user_id=p_target for update;
  if target.user_id is null then raise exception 'Member not found' using errcode='P0002'; end if;
  if p_role not in ('owner','admin','agent') then raise exception 'Invalid role' using errcode='22023'; end if;
  if actor.role<>'owner' and (target.role in ('owner','admin') or p_role in ('owner','admin')) then
    raise exception 'Only owners manage administrators and owners' using errcode='42501'; end if;
  if target.role='owner' and (not p_active or p_role<>'owner') and not exists(
    select 1 from agency_members where role='owner' and active and user_id<>p_target
  ) then raise exception 'The last active owner cannot be removed' using errcode='22023'; end if;
  update agency_members set role=p_role,active=p_active,updated_at=now() where user_id=p_target;
  insert into agency_audit(actor_id,target_id,action,details) values(p_actor,p_target,'membership_changed',jsonb_build_object('role',p_role,'active',p_active));
end;
$$;
create function public.bootstrap_agency_owner(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if exists(select 1 from agency_members) then raise exception 'Agency is already initialized' using errcode='22023'; end if;
  insert into agency_members(user_id,email,role)
    select id,email,'owner' from auth.users where id=p_user and email_confirmed_at is not null;
  if not found then raise exception 'A confirmed existing user is required' using errcode='22023'; end if;
  insert into agency_audit(actor_id,target_id,action) values(p_user,p_user,'owner_bootstrapped');
end;
$$;
create function public.assign_agency_agent(p_actor uuid,p_type text,p_record uuid,p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin')) then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_user is not null and not exists(select 1 from agency_members where user_id=p_user and active) then raise exception 'Active agent required' using errcode='22023'; end if;
  if p_type='client' then update clients set agent_user_id=p_user where id=p_record;
  elsif p_type='lead' then update leads set agent_user_id=p_user where id=p_record;
  else raise exception 'Invalid record type' using errcode='22023'; end if;
  if not found then raise exception 'Record not found' using errcode='P0002'; end if;
  insert into agency_audit(actor_id,target_id,action,details) values(p_actor,p_record,'agent_assigned',jsonb_build_object('user_id',p_user,'record_type',p_type));
end;
$$;
revoke all on function public.manage_agency_member(uuid,uuid,text,boolean),public.bootstrap_agency_owner(uuid) from public,anon,authenticated;
grant execute on function public.manage_agency_member(uuid,uuid,text,boolean),public.bootstrap_agency_owner(uuid) to service_role;
revoke all on function public.assign_agency_agent(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assign_agency_agent(uuid,text,uuid,uuid) to service_role;
create function public.agency_session_allowed()
returns boolean language sql stable security definer set search_path=public as $$
  select not exists(select 1 from agency_members) or exists(select 1 from agency_members where user_id=auth.uid() and active)
$$;
revoke all on function public.agency_session_allowed() from public,anon;
grant execute on function public.agency_session_allowed() to authenticated,service_role;
-- Bootstrap is the deliberate database-side activation point. Restrictive policies
-- prevent an inactive session from bypassing the web APIs through existing grants.
do $$
declare target record;
begin
  for target in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relname not in ('agency_members','agency_audit')
  loop
    execute format('create policy agency_active_session on public.%I as restrictive for all to authenticated using(public.agency_session_allowed()) with check(public.agency_session_allowed())',target.relname);
  end loop;
end;
$$;
create policy agency_document_session on storage.objects as restrictive for all to authenticated
  using(bucket_id<>'account-documents' or public.agency_session_allowed())
  with check(bucket_id<>'account-documents' or public.agency_session_allowed());
notify pgrst,'reload schema';
commit;
