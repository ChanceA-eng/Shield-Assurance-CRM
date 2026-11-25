begin;

create function public.team_can_manage_identity(p_actor uuid,p_target uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.team_profile_manager(p_actor) and exists(
    select 1 from public.agency_members manager join public.agency_members target on target.user_id=p_target
    where manager.user_id=p_actor and target.active and target.role<>'owner'
      and (target.role<>'admin' or manager.role='owner')
      and (manager.direct_grants is null or (target.direct_grants is not null
        and public.team_access_within(target.direct_grants,manager.direct_grants)))
  );
$$;

create function public.team_pending_email_requests(p_actor uuid)
returns table(id uuid,user_id uuid,old_email text,new_email text,status text,expires_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.team_profile_manager(p_actor) then
    raise exception 'Team administration is required.' using errcode='42501';
  end if;
  return query select e.id,e.user_id,e.old_email,e.new_email,e.status,e.expires_at,e.created_at
    from public.account_email_changes e
    where e.status='pending' and e.expires_at>now() and public.team_can_manage_identity(p_actor,e.user_id)
    order by e.created_at limit 100;
end;
$$;

create or replace function public.request_account_email(p_actor uuid,p_email text)
returns uuid language plpgsql security definer set search_path=public as $$
declare member agency_members; current_email text; request_id uuid; target text:=lower(trim(p_email)); self_approved boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('account-email:'||p_actor::text,0));
  select * into member from agency_members where user_id=p_actor and active;
  if member.user_id is null then raise exception 'An active agency membership is required' using errcode='42501'; end if;
  select email into current_email from auth.users where id=p_actor;
  if target=current_email or target !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'Enter a different valid email address' using errcode='22023'; end if;
  if exists(select 1 from auth.users where lower(email)=target) then raise exception 'That address is unavailable' using errcode='23505'; end if;
  self_approved:=public.team_profile_manager(p_actor);
  update account_email_changes set status='cancelled' where user_id=p_actor and status in ('pending','approved');
  insert into account_email_changes(user_id,old_email,new_email,status,approved_by)
    values(p_actor,current_email,target,case when self_approved then 'approved' else 'pending' end,
      case when self_approved then p_actor end) returning id into request_id;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,p_actor,'account_email_requested',jsonb_build_object('request_id',request_id));
  return request_id;
end;
$$;

create or replace function public.decide_account_email(p_actor uuid,p_request uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare item account_email_changes;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  select * into item from account_email_changes where id=p_request for update;
  if item.id is null or item.status<>'pending' or item.expires_at<=now() then
    raise exception 'This request expired or has already changed' using errcode='40001';
  end if;
  if p_approve is null then raise exception 'Choose an approval decision.' using errcode='22023'; end if;
  if not public.team_can_manage_identity(p_actor,item.user_id) then
    raise exception 'You cannot manage this member account.' using errcode='42501';
  end if;
  update account_email_changes set status=case when p_approve then 'approved' else 'rejected' end,
    approved_by=case when p_approve then p_actor end where id=p_request;
  insert into agency_audit(actor_id,target_id,action,details) values(p_actor,item.user_id,
    case when p_approve then 'account_email_approved' else 'account_email_rejected' end,jsonb_build_object('request_id',p_request));
end;
$$;

create or replace function public.guard_account_email()
returns trigger language plpgsql security definer set search_path=public as $$
declare target text; item account_email_changes;
begin
  if new.email is not distinct from old.email and coalesce(new.email_change,'') is not distinct from coalesce(old.email_change,'') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if new.email is distinct from old.email then target:=lower(new.email);
  else target:=nullif(lower(new.email_change),''); end if;
  if target is null then return new; end if;
  select * into item from account_email_changes where user_id=old.id and old_email=old.email
    and new_email=target and status='approved' and expires_at>now() for update;
  if item.id is null or (
    (item.approved_by=old.id and public.team_profile_manager(old.id))
    or (item.approved_by<>old.id and public.team_can_manage_identity(item.approved_by,old.id))
  ) is not true then raise exception 'An approved, current email change request is required' using errcode='42501'; end if;
  if new.email is distinct from old.email and (item.old_confirmed_at is null or item.new_confirmed_at is null) then
    raise exception 'Confirm both email addresses before changing your sign-in email' using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function public.team_can_manage_identity(uuid,uuid),public.team_pending_email_requests(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.team_pending_email_requests(uuid) to service_role;
notify pgrst,'reload schema';
commit;
