do $$
declare
  v_account uuid := gen_random_uuid();
  v_other_account uuid := gen_random_uuid();
  v_policy uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_file uuid := gen_random_uuid();
  v_invalid_file uuid := gen_random_uuid();
begin
  insert into public.clients(id,full_name) values(v_account,'Service ownership fixture');
  insert into public.clients(id,full_name) values(v_other_account,'Other service account fixture');
  insert into public.policies(id,client_id,account_id,insured_name,carrier,line_of_business,effective_date,renewal_date,expiration_date,status)
  values(v_policy,v_account,v_account,'Service ownership fixture','Fixture carrier','Commercial',current_date,current_date+30,current_date+30,'active');

  insert into public.client_files(id,client_id,file_name,file_type,file_size,status,metadata)
  values(v_file,v_account,'service-request-fixture.pdf','PDF',128,'uploaded',
    jsonb_build_object('source_kind','stored','storage',jsonb_build_object('bucket','account-documents','path','fixture/service-request.pdf')));
  insert into public.client_files(id,client_id,file_name,file_type,file_size,status,metadata)
  values(v_invalid_file,v_other_account,'wrong-account.pdf','PDF',64,'uploaded',
    jsonb_build_object('source_kind','stored','storage',jsonb_build_object('bucket','account-documents','path','fixture/wrong-account.pdf')));

  insert into public.policy_change_requests(id,policy_id,description,requested_by,updated_by,assigned_to)
  values(v_request,v_policy,'Retain owner and supporting documents',gen_random_uuid(),gen_random_uuid(),null);
  if not exists(select 1 from public.tasks where automation_key='service:policy_change_request:'||v_request::text
    and action_href='/clients/'||v_account::text||'?tab=policies&service_request='||v_request::text) then
    raise exception 'Service request task must open the exact request on its account';
  end if;

  insert into public.policy_change_request_documents(request_id,file_id,added_by)
  values(v_request,v_file,gen_random_uuid());
  if not exists(select 1 from public.policy_change_request_documents
    where request_id=v_request and file_id=v_file
      and file_snapshot->>'file_name'='service-request-fixture.pdf'
      and file_snapshot->>'source_kind'='stored') then
    raise exception 'Service request document links must retain a private-file snapshot';
  end if;

  begin
    insert into public.policy_change_request_documents(request_id,file_id,added_by)
    values(v_request,v_invalid_file,gen_random_uuid());
    raise exception 'A service request must reject documents from another account';
  exception when check_violation then null;
  end;
  begin
    delete from public.client_files where id=v_file;
    raise exception 'A linked service request document must not be deleted';
  exception when foreign_key_violation then null;
  end;
  if not exists(select 1 from public.client_files where id=v_file) then
    raise exception 'A linked source document must remain available';
  end if;
end;
$$;
