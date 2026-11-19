do $$
declare
  v_account_id uuid := gen_random_uuid();
  policy_id uuid := gen_random_uuid();
  v_claim_id uuid := gen_random_uuid();
  v_request_id uuid;
  v_task_id uuid;
  v_request_version integer;
begin
  insert into public.clients(id, full_name) values(v_account_id, 'Policy service request fixture');
  insert into public.policies(id, client_id, account_id, insured_name, carrier, line_of_business, effective_date, renewal_date, expiration_date, status)
  values(policy_id, v_account_id, v_account_id, 'Policy service request fixture', 'Fixture carrier', 'Commercial', current_date, current_date, current_date + 365, 'active');
  insert into public.claims(id, policy_id, client_id, claim_number, type, status, description, date_of_loss, adjuster_name, adjuster_contact)
  values(v_claim_id, policy_id, v_account_id, 'FIXTURE-CLAIM-1', 'Auto', 'open', 'Initial claim report', current_date, 'Adjuster One', 'adjuster@example.test');
  if not exists(select 1 from public.tasks where automation_key='service:claim:'||v_claim_id::text
    and action_href='/clients/'||v_account_id::text||'?tab=policies&context_type=claim&context_id='||v_claim_id::text) then
    raise exception 'Claim follow-up task must open the exact claim on its account';
  end if;
  if not exists(select 1 from public.claim_record_events event where event.claim_id=v_claim_id
    and event.event_type='created' and event.to_status='open') then
    raise exception 'Claim creation must be retained in status history';
  end if;
  update public.claims set status='closed', adjuster_name='Adjuster Two', updated_by=gen_random_uuid()
  where id=v_claim_id;
  if not exists(select 1 from public.claim_record_events event where event.claim_id=v_claim_id
    and event.event_type='status_changed' and event.from_status='open' and event.to_status='closed'
    and event.snapshot->>'adjuster_name'='Adjuster Two' and event.snapshot->>'claim_number'='FIXTURE-CLAIM-1') then
    raise exception 'Claim status changes must preserve carrier and adjuster details in history';
  end if;
  begin
    delete from public.claims where id=v_claim_id;
    raise exception 'Claims with history must not be deleted';
  exception when foreign_key_violation then
    null;
  end;
  if not exists(select 1 from public.claims where id=v_claim_id) then
    raise exception 'A claim with audit history must remain available';
  end if;
  insert into public.policy_change_requests(policy_id, description, requested_by, updated_by, request_type)
  values(policy_id, 'Add a listed vehicle', gen_random_uuid(), gen_random_uuid(), 'vehicle_addition')
  returning id, version into v_request_id, v_request_version;
  if v_request_version <> 1 then raise exception 'New requests must start at version 1'; end if;
  select id into v_task_id from public.tasks where automation_key = 'service:policy_change_request:'||v_request_id::text;
  if v_task_id is null or not exists(select 1 from public.tasks where id=v_task_id and status='open'
    and related_type='policy_change_request' and related_id=v_request_id and action_category='service') then
    raise exception 'Creating a service request must create linked open task work';
  end if;
  if not exists(select 1 from public.policy_change_request_events event where event.request_id=v_request_id and event.event_type='created' and event.to_status='draft') then
    raise exception 'Request creation must be recorded in its history';
  end if;
  update public.policy_change_requests set status='submitted', carrier_submitted_at=clock_timestamp(), updated_by=requested_by
  where id=v_request_id;
  if not exists(select 1 from public.policy_change_request_events event where event.request_id=v_request_id
    and event.event_type='status_changed' and event.from_status='draft' and event.to_status='submitted') then
    raise exception 'Status changes must be recorded in history';
  end if;
  update public.policy_change_requests set status='confirmed', carrier_confirmed_on=current_date,
    confirmation_reference='Fixture carrier confirmation', updated_by=requested_by where id=v_request_id;
  if not exists(select 1 from public.tasks where id=v_task_id and status='completed') then
    raise exception 'Confirmed work must resolve its open service task';
  end if;
  begin
    update public.policy_change_requests set confirmation_reference=null where id=v_request_id;
    raise exception 'Confirmation reference constraint should have rejected the update';
  exception when check_violation then null;
  end;
  if not exists(select 1 from public.policy_change_requests request where request.id=v_request_id and request.version=3) then
    raise exception 'Each saved change must advance the version';
  end if;
  update public.policy_change_requests set status='reopened', updated_by=requested_by where id=v_request_id;
  if not exists(select 1 from public.tasks where id=v_task_id and status='open')
    or not exists(select 1 from public.policy_change_request_events event where event.request_id=v_request_id
      and event.from_status='confirmed' and event.to_status='reopened') then
    raise exception 'Reopening a request must reopen its follow-up and retain the audit history';
  end if;
end;
$$;
