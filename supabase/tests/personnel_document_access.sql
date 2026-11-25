begin;
do $test$
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  private_id uuid := gen_random_uuid();
  shared_id uuid := gen_random_uuid();
  other_document_id uuid := gen_random_uuid();
  visible_count bigint;
begin
  insert into auth.users(id, email, email_confirmed_at) values
    (owner_id, 'personnel-owner-' || owner_id || '@example.invalid', now()),
    (manager_id, 'personnel-manager-' || manager_id || '@example.invalid', now()),
    (other_id, 'personnel-other-' || other_id || '@example.invalid', now());
  insert into public.agency_members(user_id, email, role, active) values
    (owner_id, 'personnel-owner-' || owner_id || '@example.invalid', 'owner', true);
  insert into public.agency_members(user_id, email, role, active, team_name, role_title, direct_grants, setup_state) values
    (manager_id, 'personnel-manager-' || manager_id || '@example.invalid', 'agent', true,
      'Manager', 'Team Manager', '{"team.manage":"agency"}', 'accepted'),
    (other_id, 'personnel-other-' || other_id || '@example.invalid', 'agent', true,
      'Other Member', 'Producer', '{"dashboard.view":"assigned"}', 'accepted');
  insert into public.personnel_documents(id, member_id, file_name, storage_path, content_type, file_size,
    shared, retain_until, uploaded_by) values
    (private_id, manager_id, 'private.pdf', manager_id::text || '/' || private_id::text || '/document', 'application/pdf', 100, false, current_date+30, owner_id),
    (shared_id, manager_id, 'shared.pdf', manager_id::text || '/' || shared_id::text || '/document', 'application/pdf', 100, true, current_date+30, owner_id),
    (other_document_id, other_id, 'other.pdf', other_id::text || '/' || other_document_id::text || '/document', 'application/pdf', 100, true, current_date+30, owner_id);

  if public.personnel_manager(manager_id) then
    raise exception 'Team administration alone granted personnel-document management.';
  end if;
  select count(*) into visible_count from public.list_personnel_documents(manager_id, manager_id);
  if visible_count<>1 or not exists(select 1 from public.list_personnel_documents(manager_id, manager_id) where id=shared_id) then
    raise exception 'A member did not receive only individually shared personnel documents.';
  end if;
  if exists(select 1 from public.read_personnel_document(manager_id, private_id))
    or not exists(select 1 from public.read_personnel_document(manager_id, shared_id)) then
    raise exception 'A member could read private personnel data or not read a shared file.';
  end if;
  begin
    perform * from public.list_personnel_documents(manager_id, other_id);
    raise exception 'A member read another member''s personnel documents.';
  exception when insufficient_privilege then null;
  end;
  select count(*) into visible_count from public.list_personnel_documents(owner_id, manager_id);
  if visible_count<>2 then raise exception 'The owner could not manage the member''s personnel documents.'; end if;

  begin
    perform public.change_personnel_document(owner_id, private_id, 1, 'remove');
    raise exception 'A document was removed before its retention date.';
  exception when sqlstate 'PT409' then null;
  end;
  if not exists(select 1 from public.personnel_documents where id=private_id and state='stored') then
    raise exception 'A blocked removal changed personnel-document state.';
  end if;

  if has_table_privilege('authenticated', 'public.personnel_documents', 'SELECT')
    or has_function_privilege('authenticated', 'public.list_personnel_documents(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.read_personnel_document(uuid,uuid)', 'EXECUTE') then
    raise exception 'A client role can bypass the personnel-document authorization API.';
  end if;
end;
$test$;
rollback;
