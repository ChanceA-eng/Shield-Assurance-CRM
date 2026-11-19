do $$
declare
  v_account_id uuid := gen_random_uuid();
  v_policy_id uuid := gen_random_uuid();
  v_certificate_id uuid := gen_random_uuid();
  v_document_id uuid := gen_random_uuid();
  v_external_document_id uuid := gen_random_uuid();
  certificate_version integer;
begin
  insert into public.clients(id, full_name, email, phone, address)
  values(v_account_id, 'Certificate lifecycle fixture', 'certificate-fixture@example.test', '5550100', 'Fixture address');
  insert into public.policies(id, client_id, account_id, insured_name, carrier, line_of_business, effective_date, renewal_date, expiration_date, status)
  values(v_policy_id, v_account_id, v_account_id, 'Certificate lifecycle fixture', 'Fixture carrier', 'Commercial', current_date, current_date, current_date + 365, 'active');
  insert into public.certificates(id, policy_id, client_id, account_id, certificate_holder, description, requested_for, status, updated_by)
  values(v_certificate_id, v_policy_id, v_account_id, v_account_id, 'Fixture certificate holder', 'Evidence of insurance requested', current_date + 3, 'requested', v_account_id);
  if not exists(select 1 from public.certificate_record_events event where event.certificate_id=v_certificate_id
    and event.event_type='created' and event.to_status='requested') then
    raise exception 'Certificate request creation must be retained in history';
  end if;

  update public.certificates set status='in_review', reviewed_at=clock_timestamp(), reviewed_by=v_account_id, updated_by=v_account_id
  where id=v_certificate_id;
  select version into certificate_version from public.certificates where id=v_certificate_id;
  if certificate_version <> 2 then raise exception 'Certificate updates must advance the optimistic version'; end if;

  insert into public.client_files(id, client_id, file_name, file_url, file_type, status, metadata)
  values(v_external_document_id, v_account_id, 'external-certificate.pdf', 'https://example.test/certificate.pdf', 'PDF', 'linked',
    jsonb_build_object('source_kind','link'));
  begin
    update public.certificates set document_id=v_external_document_id, updated_by=v_account_id where id=v_certificate_id;
    raise exception 'External links must not qualify as issued certificate documents';
  exception when check_violation then
    null;
  end;
  if exists(select 1 from public.certificates where id=v_certificate_id and document_id=v_external_document_id) then
    raise exception 'An external link must not be attached as an issued certificate';
  end if;

  insert into public.client_files(id, client_id, file_name, file_type, file_size, status, metadata)
  values(v_document_id, v_account_id, 'certificate-fixture.pdf', 'PDF', 1, 'uploaded',
    jsonb_build_object('source_kind','stored','storage',jsonb_build_object(
      'bucket','account-documents','path','fixture/'||v_document_id::text||'.pdf','content_type','application/pdf','size',1)));
  update public.certificates set status='issued', issue_date=current_date, document_id=v_document_id, issued_by=v_account_id, updated_by=v_account_id
  where id=v_certificate_id;
  update public.certificates set status='delivery_reported', delivery_reported_at=clock_timestamp(),
    delivery_method='email', delivery_reference='FIXTURE-DELIVERY-1', delivery_reported_by=v_account_id, updated_by=v_account_id
  where id=v_certificate_id;
  if not exists(select 1 from public.certificate_record_events event where event.certificate_id=v_certificate_id
    and event.event_type='status_changed' and event.from_status='issued' and event.to_status='delivery_reported'
    and event.snapshot->>'delivery_reference'='FIXTURE-DELIVERY-1') then
    raise exception 'Certificate delivery reports must be retained as agent-reported history';
  end if;
  begin
    delete from public.certificates where id=v_certificate_id;
    raise exception 'Certificates with history must not be deleted';
  exception when foreign_key_violation then
    null;
  end;
  if not exists(select 1 from public.certificates where id=v_certificate_id) then
    raise exception 'A certificate with audit history must remain available';
  end if;
end;
$$;
