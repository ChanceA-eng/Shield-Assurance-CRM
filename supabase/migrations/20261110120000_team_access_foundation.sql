begin;

create table public.team_access_rollout (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  enforcement_version integer not null default 0 check(enforcement_version>=0),
  check(not enabled or enforcement_version>=1)
);
insert into public.team_access_rollout(singleton) values(true);

create table public.team_permission_catalog (
  permission text primary key,
  scopes text[] not null check(cardinality(scopes)>0 and scopes<@array['self','assigned','agency'])
);
insert into public.team_permission_catalog(permission,scopes) values
  ('leads.view','{assigned,agency}'),('leads.edit','{assigned,agency}'),
  ('leads.delete','{assigned,agency}'),('leads.assign','{agency}'),('leads.import','{agency}'),
  ('leads.export','{assigned,agency}'),('leads.prospect','{agency}'),
  ('accounts.view','{assigned,agency}'),('accounts.edit','{assigned,agency}'),
  ('accounts.delete','{assigned,agency}'),('accounts.assign','{agency}'),('accounts.export','{assigned,agency}'),
  ('policies.view','{assigned,agency}'),('policies.edit','{assigned,agency}'),
  ('policies.delete','{assigned,agency}'),('policies.export','{assigned,agency}'),
  ('documents.view','{assigned,agency}'),('documents.edit','{assigned,agency}'),('documents.delete','{assigned,agency}'),
  ('intake.manage','{assigned,agency}'),('messages.view','{assigned,agency}'),('messages.send','{assigned,agency}'),
  ('campaigns.view','{agency}'),('campaigns.send','{agency}'),
  ('tasks.view','{self,assigned,agency}'),('tasks.edit','{self,assigned,agency}'),('tasks.assign','{agency}'),
  ('calendar.view','{self,assigned,agency}'),('calendar.edit','{self,assigned,agency}'),
  ('dashboard.view','{assigned,agency}'),('reports.view','{agency}'),('reports.export','{agency}'),
  ('content.view','{agency}'),('content.edit','{agency}'),('content.delete','{agency}'),
  ('social.view','{agency}'),('social.edit','{agency}'),('social.delete','{agency}'),
  ('social.approve','{agency}'),('social.publish','{agency}'),('social.publish_direct','{agency}'),('social.connections','{agency}'),
  ('knowledge.view','{agency}'),('knowledge.edit','{agency}'),
  ('automation.view','{agency}'),('automation.manage','{agency}'),
  ('integrations.manage','{agency}'),('agency.manage','{agency}'),('team.manage','{agency}');

create table public.team_permission_dependencies (
  permission text not null references public.team_permission_catalog(permission),
  dependency text not null references public.team_permission_catalog(permission),
  primary key(permission,dependency),
  check(permission<>dependency)
);
insert into public.team_permission_dependencies values
  ('leads.edit','leads.view'),('leads.delete','leads.edit'),('leads.assign','leads.edit'),
  ('leads.import','leads.edit'),('leads.export','leads.view'),('leads.prospect','leads.edit'),
  ('accounts.edit','accounts.view'),('accounts.delete','accounts.edit'),('accounts.assign','accounts.edit'),('accounts.export','accounts.view'),
  ('policies.edit','policies.view'),('policies.edit','accounts.view'),('policies.delete','policies.edit'),('policies.export','policies.view'),
  ('documents.edit','documents.view'),('documents.delete','documents.edit'),('messages.send','messages.view'),
  ('campaigns.send','campaigns.view'),('campaigns.send','leads.view'),('campaigns.send','messages.send'),
  ('tasks.edit','tasks.view'),('tasks.assign','tasks.edit'),('calendar.edit','calendar.view'),('reports.export','reports.view'),
  ('content.edit','content.view'),('content.delete','content.edit'),
  ('social.edit','social.view'),('social.delete','social.edit'),('social.approve','social.view'),
  ('social.publish','social.view'),('social.publish_direct','social.publish'),('social.connections','social.view'),
  ('knowledge.edit','knowledge.view'),('automation.manage','automation.view');

create function public.team_scope_rank(p_scope text) returns integer
language sql immutable set search_path=public as $$
  select case p_scope when 'self' then 1 when 'assigned' then 2 when 'agency' then 3 else 0 end
$$;

create function public.team_validate_access(p_access jsonb) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if p_access is null or jsonb_typeof(p_access)<>'object' then
    raise exception 'Choose valid permissions.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(p_access) g left join team_permission_catalog c on c.permission=g.key
    where c.permission is null or jsonb_typeof(g.value)<>'string' or not (g.value#>>'{}'=any(c.scopes))) then
    raise exception 'Choose a known permission and valid scope.' using errcode='22023';
  end if;
  if exists(select 1 from team_permission_dependencies d where p_access ? d.permission
    and (not p_access ? d.dependency or team_scope_rank(p_access->>d.dependency)<team_scope_rank(p_access->>d.permission))) then
    raise exception 'Required permissions must have the same or wider scope.' using errcode='22023';
  end if;
end;
$$;

create function public.team_apply_exceptions(p_grants jsonb,p_exceptions jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare item record; result jsonb:=p_grants;
begin
  if p_exceptions is null or jsonb_typeof(p_exceptions)<>'object' then
    raise exception 'Choose valid member exceptions.' using errcode='22023';
  end if;
  for item in select key,value from jsonb_each(p_exceptions) loop
    if not exists(select 1 from team_permission_catalog where permission=item.key)
      or jsonb_typeof(item.value)<>'object' or item.value->>'effect' is null
      or exists(select 1 from jsonb_object_keys(item.value) k where k not in ('effect','scope')) then
      raise exception 'Choose a valid member exception.' using errcode='22023';
    end if;
    if item.value->>'effect'='deny' and not item.value ? 'scope' then result:=result-item.key;
    elsif item.value->>'effect'='allow' and jsonb_typeof(item.value->'scope')='string'
      and exists(select 1 from team_permission_catalog where permission=item.key and item.value->>'scope'=any(scopes)) then
      result:=result||jsonb_build_object(item.key,item.value->'scope');
    else raise exception 'Choose allow with a valid scope, or deny without a scope.' using errcode='22023';
    end if;
  end loop;
  perform team_validate_access(result);
  return result;
end;
$$;

create table public.team_role_bundles (
  id text primary key check(id~'^[a-z][a-z0-9-]{1,63}$' and id<>'owner'),
  name text not null check(length(btrim(name)) between 1 and 80),
  grants jsonb not null,
  version integer not null default 1 check(version>0),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create unique index team_role_bundles_name on public.team_role_bundles(lower(btrim(name)));

insert into public.team_role_bundles(id,name,grants)
select 'admin','Admin',jsonb_object_agg(permission,'agency'::text) from public.team_permission_catalog;
insert into public.team_role_bundles(id,name,grants) values
  ('account-service','Account service','{
    "accounts.view":"agency","accounts.edit":"agency","policies.view":"agency","policies.edit":"agency",
    "documents.view":"agency","documents.edit":"agency","intake.manage":"agency","messages.view":"agency","messages.send":"agency",
    "tasks.view":"agency","tasks.edit":"agency","calendar.view":"agency","calendar.edit":"agency","dashboard.view":"agency","knowledge.view":"agency"}');
insert into public.team_role_bundles(id,name,grants)
  select 'producer','Producer',grants||'{"leads.view":"agency","leads.edit":"agency","leads.prospect":"agency","content.view":"agency"}'::jsonb
  from public.team_role_bundles where id='account-service';
insert into public.team_role_bundles(id,name,grants) values
  ('social-marketer','Social marketer','{"content.view":"agency","content.edit":"agency","social.view":"agency","social.edit":"agency","tasks.view":"self","tasks.edit":"self"}'),
  ('content-writer','Content writer','{"content.view":"agency","content.edit":"agency","social.view":"agency","social.edit":"agency","tasks.view":"self","tasks.edit":"self"}'),
  ('read-only-reviewer','Read-only reviewer','{"content.view":"agency","social.view":"agency"}');

alter table public.agency_members add column team_role_id text references public.team_role_bundles(id);
alter table public.agency_members add column access_exceptions jsonb not null default '{}';
alter table public.agency_members add column access_version integer not null default 1 check(access_version>0);
update public.agency_members set team_role_id=case role when 'admin' then 'admin' when 'agent' then 'producer' end;
alter table public.agency_members add constraint team_owner_not_bundle check(role<>'owner' or (team_role_id is null and access_exceptions='{}'));
create index agency_members_team_role on public.agency_members(team_role_id);

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254),
  user_id uuid references auth.users(id) on delete restrict,
  role_id text not null references public.team_role_bundles(id),
  exceptions jsonb not null default '{}',
  state text not null default 'pending' check(state in ('pending','delivery_failed','sent','accepted','revoked')),
  version integer not null default 1 check(version>0),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  delivery_error text,
  check((state='accepted')=(accepted_at is not null))
);
create unique index team_open_invitation_email on public.team_invitations(email) where state in ('pending','delivery_failed','sent');
create index team_invitations_user on public.team_invitations(user_id);
alter table public.agency_members add column invitation_id uuid unique references public.team_invitations(id);

create function public.team_effective_access(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare member agency_members; grants jsonb;
begin
  select * into member from agency_members where user_id=p_user and active and exists(
    select 1 from auth.users where id=p_user and email_confirmed_at is not null and (banned_until is null or banned_until<=now())
  );
  if not found then return '{}'::jsonb; end if;
  if member.role='owner' then
    select jsonb_object_agg(permission,'agency'::text) into grants from team_permission_catalog;
    return grants;
  end if;
  select r.grants into grants from team_role_bundles r where r.id=member.team_role_id;
  if grants is null then return '{}'::jsonb; end if;
  return team_apply_exceptions(grants,member.access_exceptions);
end;
$$;

create function public.team_access_within(p_access jsonb,p_ceiling jsonb) returns boolean
language sql immutable set search_path=public as $$
  select not exists(select 1 from jsonb_each_text(p_access) g
    where team_scope_rank(g.value)=0 or team_scope_rank(p_ceiling->>g.key)<team_scope_rank(g.value))
$$;

create function public.team_require_manager(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare is_owner boolean;
begin
  if not exists(select 1 from team_access_rollout where enabled and enforcement_version>=1) then
    raise exception 'Team access is not activated. Finish the authorization rollout before changing membership.' using errcode='55000';
  end if;
  select role='owner' into is_owner from agency_members where user_id=p_actor and active;
  if is_owner is null or not team_effective_access(p_actor) ? 'team.manage' then
    raise exception 'Team access administration is required.' using errcode='42501';
  end if;
  return is_owner;
end;
$$;

create function public.save_team_role(p_actor uuid,p_id text,p_name text,p_grants jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare is_owner boolean; saved team_role_bundles; member agency_members; invitation team_invitations; ceiling jsonb; candidate jsonb; previous jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  is_owner:=team_require_manager(p_actor);
  ceiling:=team_effective_access(p_actor);
  perform team_validate_access(p_grants);
  if not is_owner and not team_access_within(p_grants,ceiling) then
    raise exception 'You cannot grant permissions beyond your own access.' using errcode='42501';
  end if;
  select * into saved from team_role_bundles where id=p_id for update;
  if found then
    if p_expected_version is null or saved.version<>p_expected_version then
      raise exception 'This role changed. Reload before saving.' using errcode='PT409';
    end if;
    previous:=saved.grants;
    if not is_owner and not team_access_within(saved.grants,ceiling) then
      raise exception 'You cannot edit a role above your own access.' using errcode='42501';
    end if;
    for member in select * from agency_members where team_role_id=p_id for update loop
      candidate:=team_apply_exceptions(p_grants,member.access_exceptions);
      if not is_owner and (not team_access_within(team_apply_exceptions(saved.grants,member.access_exceptions),ceiling)
        or not team_access_within(candidate,ceiling)) then
        raise exception 'This role affects a member beyond your management access.' using errcode='42501';
      end if;
    end loop;
    for invitation in select * from team_invitations where role_id=p_id and state in ('pending','delivery_failed','sent') for update loop
      candidate:=team_apply_exceptions(p_grants,invitation.exceptions);
      if not is_owner and (not team_access_within(team_apply_exceptions(saved.grants,invitation.exceptions),ceiling)
        or not team_access_within(candidate,ceiling)) then
        raise exception 'This role affects an invitation beyond your management access.' using errcode='42501';
      end if;
    end loop;
    update team_role_bundles set name=btrim(p_name),grants=p_grants,version=version+1,updated_at=now() where id=p_id returning * into saved;
    update agency_members set access_version=access_version+1,updated_at=now() where team_role_id=p_id;
  else
    if p_expected_version is not null then raise exception 'Role not found.' using errcode='P0002'; end if;
    insert into team_role_bundles(id,name,grants,created_by) values(p_id,btrim(p_name),p_grants,p_actor) returning * into saved;
  end if;
  insert into agency_audit(actor_id,action,details)
    values(p_actor,'team_role_saved',jsonb_build_object('role_id',p_id,'previous',previous,'grants',p_grants,'version',saved.version));
  return to_jsonb(saved);
end;
$$;

create function public.set_team_member_access(p_actor uuid,p_target uuid,p_role_id text,p_exceptions jsonb,p_active boolean,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare is_owner boolean; member agency_members; grants jsonb; candidate jsonb; ceiling jsonb; before_access jsonb; previous jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  is_owner:=team_require_manager(p_actor);
  ceiling:=team_effective_access(p_actor);
  select * into member from agency_members where user_id=p_target for update;
  if not found then raise exception 'Member not found.' using errcode='P0002'; end if;
  if p_expected_version is null or member.access_version<>p_expected_version then
    raise exception 'This member changed. Reload before saving.' using errcode='PT409';
  end if;
  if p_active is null then raise exception 'Choose the member access state.' using errcode='22023'; end if;
  previous:=jsonb_build_object('role_id',member.team_role_id,'exceptions',member.access_exceptions,'active',member.active,'version',member.access_version);
  if p_active and member.invitation_id is not null and not exists(
    select 1 from team_invitations where id=member.invitation_id and state='accepted'
  ) then raise exception 'This member must accept their invitation before activation.' using errcode='22023'; end if;
  if member.role='owner' then
    raise exception 'Owner access cannot be changed through Team.' using errcode='42501';
  else
    select r.grants into grants from team_role_bundles r where r.id=p_role_id;
    if not found then raise exception 'Choose an existing role.' using errcode='22023'; end if;
    candidate:=team_apply_exceptions(grants,p_exceptions);
    select r.grants into grants from team_role_bundles r where r.id=member.team_role_id;
    before_access:=team_apply_exceptions(coalesce(grants,'{}'),member.access_exceptions);
    if not is_owner and (not team_access_within(candidate,ceiling) or not team_access_within(before_access,ceiling)) then
      raise exception 'You cannot manage permissions beyond your own access.' using errcode='42501';
    end if;
  end if;
  update agency_members set team_role_id=p_role_id,access_exceptions=p_exceptions,active=p_active,
    access_version=access_version+1,updated_at=now() where user_id=p_target returning * into member;
  if not p_active and member.invitation_id is not null then
    update team_invitations set state='revoked',version=version+1,updated_at=now()
      where id=member.invitation_id and state in ('pending','delivery_failed','sent');
  end if;
  insert into agency_audit(actor_id,target_id,action,details) values(p_actor,p_target,'team_member_access_changed',
    jsonb_build_object('previous',previous,'role_id',p_role_id,'exceptions',p_exceptions,'active',p_active,'version',member.access_version));
  return jsonb_build_object('user_id',member.user_id,'team_role_id',member.team_role_id,'active',member.active,'access_version',member.access_version);
end;
$$;

create function public.create_team_invitation(p_actor uuid,p_id uuid,p_email text,p_role_id text,p_exceptions jsonb,p_role_version integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare is_owner boolean; grants jsonb; role_version integer; saved team_invitations;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  is_owner:=team_require_manager(p_actor);
  if p_id is null or p_email is null or length(p_email)>254 or p_email<>lower(btrim(p_email))
    or p_email!~'^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'Enter a valid invitation email.' using errcode='22023';
  end if;
  select r.grants,r.version into grants,role_version from team_role_bundles r where r.id=p_role_id;
  if not found then raise exception 'Choose an existing role.' using errcode='22023'; end if;
  if p_role_version is not null and role_version<>p_role_version then
    raise exception 'This role changed. Reload before inviting.' using errcode='PT409';
  end if;
  grants:=team_apply_exceptions(grants,p_exceptions);
  if not is_owner and not team_access_within(grants,team_effective_access(p_actor)) then
    raise exception 'You cannot invite a member beyond your own access.' using errcode='42501';
  end if;
  select * into saved from team_invitations where id=p_id;
  if found then
    if saved.email<>p_email or saved.role_id<>p_role_id or saved.exceptions<>p_exceptions or saved.invited_by<>p_actor then
      raise exception 'This invitation save ID belongs to another request.' using errcode='PT409';
    end if;
    return to_jsonb(saved);
  end if;
  if exists(select 1 from agency_members where lower(email)=p_email) then
    raise exception 'This person already has membership. Manage their existing access.' using errcode='PT409';
  end if;
  if exists(select 1 from team_invitations where email=p_email and state in ('pending','delivery_failed','sent')) then
    raise exception 'An invitation already exists. Retry or revoke that invitation.' using errcode='PT409';
  end if;
  insert into team_invitations(id,email,role_id,exceptions,invited_by) values(p_id,p_email,p_role_id,p_exceptions,p_actor) returning * into saved;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,p_id,'team_invitation_created',jsonb_build_object('role_id',p_role_id,'exceptions',p_exceptions));
  return to_jsonb(saved);
end;
$$;

create function public.record_team_invitation_delivery(p_actor uuid,p_id uuid,p_user uuid,p_expected_version integer,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare is_owner boolean; invitation team_invitations; grants jsonb; member agency_members;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  is_owner:=team_require_manager(p_actor);
  select * into invitation from team_invitations where id=p_id for update;
  if not found then raise exception 'Invitation not found.' using errcode='P0002'; end if;
  if p_expected_version is null or invitation.version<>p_expected_version or invitation.state not in ('pending','delivery_failed','sent') then
    raise exception 'This invitation changed. Reload before retrying.' using errcode='PT409';
  end if;
  select r.grants into grants from team_role_bundles r where r.id=invitation.role_id;
  if not is_owner and not team_access_within(team_apply_exceptions(grants,invitation.exceptions),team_effective_access(p_actor)) then
    raise exception 'This invitation is beyond your own access.' using errcode='42501';
  end if;
  if p_error is not null then
    if length(btrim(p_error)) not between 1 and 500 or p_user is not null then
      raise exception 'Record a valid invitation failure.' using errcode='22023';
    end if;
    update team_invitations set state='delivery_failed',delivery_error=btrim(p_error),version=version+1,updated_at=now() where id=p_id returning * into invitation;
  else
    if p_user is null or not exists(select 1 from auth.users where id=p_user and lower(email)=invitation.email)
      or (invitation.user_id is not null and invitation.user_id<>p_user) then
      raise exception 'The invitation account does not match its verified recipient.' using errcode='42501';
    end if;
    select * into member from agency_members where user_id=p_user for update;
    if found then
      if member.invitation_id is distinct from p_id or member.active then
        raise exception 'This existing account needs explicit membership recovery; its access was not replaced.' using errcode='PT409';
      end if;
    else
      insert into agency_members(user_id,email,role,active,team_role_id,access_exceptions,invitation_id)
        values(p_user,invitation.email,'agent',false,invitation.role_id,invitation.exceptions,p_id);
    end if;
    update team_invitations set state='sent',user_id=p_user,delivery_error=null,version=version+1,updated_at=now()
      where id=p_id returning * into invitation;
  end if;
  insert into agency_audit(actor_id,target_id,action,details) values(p_actor,p_id,
    case when p_error is null then 'team_invitation_sent' else 'team_invitation_delivery_failed' end,
    jsonb_build_object('user_id',p_user,'version',invitation.version));
  return to_jsonb(invitation);
end;
$$;

create function public.accept_team_invitation(p_user uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare invitation team_invitations; member agency_members; is_owner boolean; grants jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  select * into invitation from team_invitations where id=p_id and user_id=p_user for update;
  if not found or invitation.state not in ('sent','accepted') then
    raise exception 'This invitation is not available. Ask an administrator for access.' using errcode='42501';
  end if;
  select * into member from agency_members where user_id=p_user and invitation_id=p_id for update;
  if not found or not exists(select 1 from auth.users where id=p_user and lower(email)=invitation.email and email_confirmed_at is not null) then
    raise exception 'Verify the invited email address before activating your account.' using errcode='42501';
  end if;
  if invitation.state='accepted' then
    if not member.active then raise exception 'Your membership is suspended. Ask an administrator for access.' using errcode='42501'; end if;
    return jsonb_build_object('user_id',p_user,'role_id',member.team_role_id);
  end if;
  is_owner:=team_require_manager(invitation.invited_by);
  select r.grants into grants from team_role_bundles r where r.id=member.team_role_id;
  if grants is null or not is_owner and not team_access_within(team_apply_exceptions(grants,member.access_exceptions),team_effective_access(invitation.invited_by)) then
    raise exception 'An administrator must review this invitation before activation.' using errcode='42501';
  end if;
  update team_invitations set state='accepted',accepted_at=now(),version=version+1,updated_at=now() where id=p_id;
  update agency_members set active=true,access_version=access_version+1,updated_at=now() where user_id=p_user;
  insert into agency_audit(actor_id,target_id,action) values(p_user,p_id,'team_invitation_accepted');
  return jsonb_build_object('user_id',p_user,'role_id',member.team_role_id);
end;
$$;

create function public.revoke_team_invitation(p_actor uuid,p_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path=public as $$
declare is_owner boolean; invitation team_invitations; grants jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  is_owner:=team_require_manager(p_actor);
  select * into invitation from team_invitations where id=p_id for update;
  if not found then raise exception 'Invitation not found.' using errcode='P0002'; end if;
  if p_expected_version is null or invitation.version<>p_expected_version or invitation.state not in ('pending','delivery_failed','sent') then
    raise exception 'This invitation changed. Reload before revoking.' using errcode='PT409';
  end if;
  select r.grants into grants from team_role_bundles r where r.id=invitation.role_id;
  if not is_owner and not team_access_within(team_apply_exceptions(grants,invitation.exceptions),team_effective_access(p_actor)) then
    raise exception 'This invitation is beyond your management access.' using errcode='42501';
  end if;
  update team_invitations set state='revoked',version=version+1,updated_at=now() where id=p_id;
  update agency_members set active=false,access_version=access_version+1,updated_at=now() where invitation_id=p_id;
  insert into agency_audit(actor_id,target_id,action) values(p_actor,p_id,'team_invitation_revoked');
end;
$$;

alter table public.team_access_rollout enable row level security;
alter table public.team_permission_catalog enable row level security;
alter table public.team_permission_dependencies enable row level security;
alter table public.team_role_bundles enable row level security;
alter table public.team_invitations enable row level security;
revoke all on public.team_access_rollout,public.team_permission_catalog,public.team_permission_dependencies,
  public.team_role_bundles,public.team_invitations from public,anon,authenticated,service_role;
grant select on public.team_access_rollout,public.team_permission_catalog,public.team_permission_dependencies,
  public.team_role_bundles,public.team_invitations to service_role;

revoke all on function public.team_scope_rank(text),public.team_validate_access(jsonb),
  public.team_apply_exceptions(jsonb,jsonb),public.team_effective_access(uuid),public.team_access_within(jsonb,jsonb),
  public.team_require_manager(uuid),public.save_team_role(uuid,text,text,jsonb,integer),
  public.set_team_member_access(uuid,uuid,text,jsonb,boolean,integer),
  public.create_team_invitation(uuid,uuid,text,text,jsonb,integer),
  public.record_team_invitation_delivery(uuid,uuid,uuid,integer,text),
  public.accept_team_invitation(uuid,uuid),public.revoke_team_invitation(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.team_effective_access(uuid),
  public.save_team_role(uuid,text,text,jsonb,integer),public.set_team_member_access(uuid,uuid,text,jsonb,boolean,integer),
  public.create_team_invitation(uuid,uuid,text,text,jsonb,integer),
  public.record_team_invitation_delivery(uuid,uuid,uuid,integer,text),
  public.accept_team_invitation(uuid,uuid),public.revoke_team_invitation(uuid,uuid,integer) to service_role;

notify pgrst,'reload schema';
commit;
