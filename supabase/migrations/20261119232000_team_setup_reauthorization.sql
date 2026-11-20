begin;

create or replace function public.record_team_setup_email(p_actor uuid,p_target uuid,p_sent boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not team_profile_manager(p_actor) then raise exception 'Team administration is required.' using errcode='42501'; end if;
  if exists(select 1 from agency_members a cross join agency_members t
    where a.user_id=p_actor and t.user_id=p_target and a.direct_grants is not null
      and (t.direct_grants is null or not team_access_within(t.direct_grants,a.direct_grants))) then
    raise exception 'You cannot manage access beyond your own permissions.' using errcode='42501';
  end if;
  update agency_members set setup_state=case when p_sent then 'sent' else 'delivery_failed' end,
    team_invited_by=case when p_sent then p_actor else team_invited_by end,
    access_version=access_version+1,updated_at=now()
    where user_id=p_target and not active and setup_state in ('pending','delivery_failed','sent');
  if not found then raise exception 'This account has already completed setup.' using errcode='PT409'; end if;
  insert into agency_audit(actor_id,target_id,action) values(p_actor,p_target,
    case when p_sent then 'team_setup_email_accepted' else 'team_setup_email_unconfirmed' end);
end;
$$;

notify pgrst,'reload schema';
commit;
