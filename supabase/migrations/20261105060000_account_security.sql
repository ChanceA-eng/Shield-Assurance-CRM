begin;

create table public.account_email_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  old_email text not null,
  new_email text not null check(new_email=lower(trim(new_email)) and new_email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
  status text not null check(status in ('pending','approved','rejected','cancelled','completed')),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  completed_at timestamptz
  ,old_token_hash text
  ,new_token_hash text
  ,old_confirmed_at timestamptz
  ,new_confirmed_at timestamptz
);
create unique index account_email_changes_active on public.account_email_changes(user_id) where status in ('pending','approved');
alter table public.account_email_changes enable row level security;
revoke all on public.account_email_changes from public,anon,authenticated;
grant all on public.account_email_changes to service_role;

create table public.account_security_limits (
  key text primary key,
  started_at timestamptz not null default now(),
  attempts integer not null default 1
);
alter table public.account_security_limits enable row level security;
revoke all on public.account_security_limits from public,anon,authenticated;
grant all on public.account_security_limits to service_role;

create function public.reserve_account_security(p_key text,p_limit integer default 5)
returns boolean language plpgsql security definer set search_path=public as $$
declare amount integer;
begin
  insert into account_security_limits(key) values(p_key)
  on conflict(key) do update set
    attempts=case when account_security_limits.started_at<now()-interval '1 hour' then 1 else account_security_limits.attempts+1 end,
    started_at=case when account_security_limits.started_at<now()-interval '1 hour' then now() else account_security_limits.started_at end
  returning attempts into amount;
  return amount<=p_limit;
end;
$$;

create function public.request_account_email(p_actor uuid,p_email text)
returns uuid language plpgsql security definer set search_path=public as $$
declare member agency_members; current_email text; request_id uuid; target text:=lower(trim(p_email));
begin
  perform pg_advisory_xact_lock(hashtextextended('account-email:'||p_actor::text,0));
  select * into member from agency_members where user_id=p_actor and active;
  if member.user_id is null then raise exception 'An active agency membership is required' using errcode='42501'; end if;
  select email into current_email from auth.users where id=p_actor;
  if target=current_email or target !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'Enter a different valid email address' using errcode='22023'; end if;
  if exists(select 1 from auth.users where lower(email)=target) then raise exception 'That address is unavailable' using errcode='23505'; end if;
  update account_email_changes set status='cancelled' where user_id=p_actor and status in ('pending','approved');
  insert into account_email_changes(user_id,old_email,new_email,status,approved_by)
    values(p_actor,current_email,target,case when member.role in ('owner','admin') then 'approved' else 'pending' end,
      case when member.role in ('owner','admin') then p_actor end) returning id into request_id;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,p_actor,'account_email_requested',jsonb_build_object('request_id',request_id));
  return request_id;
end;
$$;

create function public.decide_account_email(p_actor uuid,p_request uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare item account_email_changes;
begin
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the owner can approve email changes' using errcode='42501'; end if;
  select * into item from account_email_changes where id=p_request for update;
  if item.id is null or item.status<>'pending' or item.expires_at<=now() then
    raise exception 'This request expired or has already changed' using errcode='40001'; end if;
  if not exists(select 1 from agency_members where user_id=item.user_id and active) then
    raise exception 'The requesting account is inactive' using errcode='42501'; end if;
  update account_email_changes set status=case when p_approve then 'approved' else 'rejected' end,
    approved_by=case when p_approve then p_actor end where id=p_request;
  insert into agency_audit(actor_id,target_id,action,details) values(p_actor,item.user_id,
    case when p_approve then 'account_email_approved' else 'account_email_rejected' end,jsonb_build_object('request_id',p_request));
end;
$$;

create function public.guard_account_email()
returns trigger language plpgsql security definer set search_path=public as $$
declare target text; item account_email_changes; member agency_members;
begin
  if new.email is not distinct from old.email and coalesce(new.email_change,'') is not distinct from coalesce(old.email_change,'') then return new; end if;
  if new.email is distinct from old.email then target:=lower(new.email);
  else target:=nullif(lower(new.email_change),''); end if;
  if target is null then return new; end if;
  select * into member from agency_members where user_id=old.id and active;
  select * into item from account_email_changes where user_id=old.id and old_email=old.email
    and new_email=target and status='approved' and expires_at>now() for update;
  if member.user_id is null or item.id is null or not (
    (member.role in ('owner','admin') and item.approved_by=old.id)
    or exists(select 1 from agency_members where user_id=item.approved_by and active and role='owner')
  ) then raise exception 'An approved, current email change request is required' using errcode='42501'; end if;
  if new.email is distinct from old.email and (item.old_confirmed_at is null or item.new_confirmed_at is null) then
    raise exception 'Confirm both email addresses before changing your sign-in email' using errcode='42501';
  end if;
  return new;
end;
$$;
create function public.confirm_account_email(p_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare item account_email_changes;
begin
  select * into item from account_email_changes where status='approved' and expires_at>now()
    and (old_token_hash=p_hash or new_token_hash=p_hash) for update;
  if item.id is null then raise exception 'This confirmation link expired or was already used' using errcode='22023'; end if;
  update account_email_changes set
    old_confirmed_at=case when old_token_hash=p_hash then now() else old_confirmed_at end,
    new_confirmed_at=case when new_token_hash=p_hash then now() else new_confirmed_at end,
    old_token_hash=case when old_token_hash=p_hash then null else old_token_hash end,
    new_token_hash=case when new_token_hash=p_hash then null else new_token_hash end
    where id=item.id;
  return item.id;
end;
$$;
create trigger guard_account_email before update of email,email_change on auth.users
for each row execute function public.guard_account_email();

create function public.finish_account_email()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.email is distinct from old.email then
    update agency_members set email=new.email,updated_at=now() where user_id=new.id;
    update account_email_changes set status='completed',completed_at=now()
      where user_id=new.id and old_email=old.email and new_email=new.email and status='approved';
    insert into agency_audit(actor_id,target_id,action) values(new.id,new.id,'account_email_completed');
  end if;
  return null;
end;
$$;
create trigger finish_account_email after update of email on auth.users
for each row execute function public.finish_account_email();

revoke all on function public.reserve_account_security(text,integer),public.request_account_email(uuid,text),
  public.decide_account_email(uuid,uuid,boolean),public.guard_account_email(),public.finish_account_email() from public,anon,authenticated;
revoke all on function public.confirm_account_email(text) from public,anon,authenticated;
grant execute on function public.reserve_account_security(text,integer),public.request_account_email(uuid,text),
  public.decide_account_email(uuid,uuid,boolean),public.confirm_account_email(text) to service_role;
notify pgrst,'reload schema';
commit;
