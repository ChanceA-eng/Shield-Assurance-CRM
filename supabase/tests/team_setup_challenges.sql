begin;
do $test$
declare
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  old_digest text := repeat('a', 64);
  current_digest text := repeat('b', 64);
  final_digest text := repeat('c', 64);
begin
  insert into auth.users(id, email, email_confirmed_at) values
    (owner_id, 'setup-owner-' || owner_id || '@example.invalid', now()),
    (member_id, 'setup-member-' || member_id || '@example.invalid', null);
  insert into public.agency_members(user_id, email, role, active) values
    (owner_id, 'setup-owner-' || owner_id || '@example.invalid', 'owner', true);
  insert into public.agency_members(user_id, email, role, active, team_name, role_title, direct_grants, setup_state, team_invited_by)
    values (member_id, 'setup-member-' || member_id || '@example.invalid', 'agent', false,
      'Setup Member', 'Producer', '{"leads.view":"assigned"}', 'pending', owner_id);

  perform public.begin_team_setup(owner_id, member_id, old_digest);
  perform public.finish_team_setup(owner_id, member_id, old_digest, true);
  perform public.begin_team_setup(owner_id, member_id, current_digest);
  begin
    perform public.finish_team_setup(owner_id, member_id, old_digest, true);
    raise exception 'A replaced setup challenge was accepted.';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.finish_team_setup(owner_id, member_id, current_digest, true);

  update auth.users set email_confirmed_at=now() where id=member_id;
  perform public.verify_team_setup(member_id, current_digest);
  update public.team_setup_challenges set expires_at=now()-interval '1 second' where user_id=member_id;
  begin
    perform public.verify_team_setup(member_id, current_digest);
    raise exception 'An expired setup challenge was accepted.';
  exception when insufficient_privilege then null;
  end;

  perform public.begin_team_setup(owner_id, member_id, final_digest);
  perform public.finish_team_setup(owner_id, member_id, final_digest, true);
  perform public.complete_team_setup(member_id, final_digest, '520-555-0101', 'Example address');
  if not exists(select 1 from public.agency_members where user_id=member_id and active
    and setup_state='accepted' and contact_phone='520-555-0101' and mailing_address='Example address') then
    raise exception 'Completing setup did not persist the verified member profile.';
  end if;
  if exists(select 1 from public.team_setup_challenges where user_id=member_id) then
    raise exception 'The completed setup challenge was not consumed.';
  end if;
  begin
    perform public.complete_team_setup(member_id, final_digest, '520-555-0101', 'Example address');
    raise exception 'A completed setup challenge was replayed.';
  exception when insufficient_privilege then null;
  end;
end;
$test$;
rollback;
