-- Run ONLY against an isolated disposable database after all checked-in migrations.
-- No production acceptance claim: this transaction checks atomic behavior and rolls back its fixtures.
begin;
do $test$
declare
  account uuid := gen_random_uuid(); other_account uuid := gen_random_uuid();
  survivor uuid := gen_random_uuid(); absorbed uuid := gen_random_uuid(); wrong uuid := gen_random_uuid();
  note uuid := gen_random_uuid(); asset uuid := gen_random_uuid(); intake uuid := gen_random_uuid();
  message uuid := gen_random_uuid(); enrollment uuid := gen_random_uuid(); request_id uuid := gen_random_uuid();
  issued uuid; result jsonb; fields jsonb; original_account jsonb; original_due timestamptz; canonical uuid;
begin
  insert into public.clients(id,full_name,email,phone,address,source) values
    (account,'Same name','preserve@example.invalid','555-0100','Keep address','Keep source'),
    (other_account,'Same name',null,null,null,null);
  select jsonb_build_object('full_name',c.full_name,'email',c.email,'phone',c.phone,'address',c.address,'source',c.source)
    into original_account from public.clients c where id = account;
  insert into public.leads(id,full_name,account_id,form_payload) values
    (survivor,'Same name',null,'{"profile":{"vehicles":[{"vin":"A"}]}}'),
    (absorbed,'Same name',account,'{"profile":{"vehicles":[{"vin":"B"}]},"source_only":{"answer":"preserved"}}'),
    (wrong,'Same name',other_account,null);
  insert into public.interactions(id,lead_id,content) values(note,absorbed,'Keep this note');
  insert into public.client_assets(id,lead_id,client_id,title,asset_type) values(asset,absorbed,account,'Keep asset','general');
  insert into public.lead_intake_events(id,lead_id,submission_key,submitted_at,time_basis,snapshot)
    values(intake,absorbed,'test:' || intake::text,now(),'submitted','{"immutable":"answer"}');
  insert into public.tasks(subject,related_type,related_id,intake_event_id) values('Review intake','lead',absorbed,intake);
  insert into public.communication_log(id,channel,direction,body,metadata)
    values(message,'email','inbound','Keep message',jsonb_build_object('lead_id',absorbed,'from','person@example.invalid'));
  insert into public.sequence_enrollments(lead_id) values(survivor);
  insert into public.sequence_enrollments(id,lead_id) values(enrollment,absorbed);
  insert into public.outreach_outbox(lead_id,enrollment_id,to_email,subject,body)
    values(absorbed,enrollment,'person@example.invalid','Keep subject','Keep body');
  begin
    perform public.merge_leads_atomic(survivor,array[absorbed,wrong],'{}');
    raise exception 'Expected different-account rejection';
  exception when check_violation then null;
  end;
  if not exists(select 1 from public.leads where id = absorbed)
    or (select lead_id from public.interactions where id = note) <> absorbed then
    raise exception 'Rejected merge partially modified work';
  end if;
  begin
    perform public.merge_leads_atomic(survivor,array[absorbed,gen_random_uuid()],'{}');
    raise exception 'Expected missing-lead rejection';
  exception when no_data_found then null;
  end;
  -- Fails after repointing children/updating the payload: all of those writes must roll back too.
  begin
    perform public.merge_leads_atomic(survivor,array[absorbed],'{"full_name":null}');
    raise exception 'Expected invalid reviewed-field rejection';
  exception when invalid_parameter_value then null;
  end;
  if not exists(select 1 from public.leads where id = absorbed)
    or exists(select 1 from public.lead_merge_archive where absorbed_id = absorbed)
    or (select lead_id from public.interactions where id = note) <> absorbed
    or (select lead_id from public.lead_intake_events where id = intake) <> absorbed
    or (select count(*) from public.sequence_enrollments where lead_id in (survivor,absorbed) and status in ('active','paused')) <> 2 then
    raise exception 'Late merge failure partially changed children/archive/outreach';
  end if;
  result := public.merge_leads_atomic(survivor,array[absorbed],'{}');
  if exists(select 1 from public.leads where id = absorbed)
    or (select lead_id from public.interactions where id = note) <> survivor
    or (select lead_id from public.client_assets where id = asset) <> survivor
    or (select lead_id from public.lead_intake_events where id = intake) <> survivor
    or (select snapshot from public.lead_intake_events where id = intake) <> '{"immutable":"answer"}'::jsonb
    or (select metadata->>'lead_id' from public.communication_log where id = message) <> survivor::text
    or not exists(select 1 from public.outreach_outbox where lead_id = survivor and enrollment_id = enrollment)
    or (select count(*) from public.sequence_enrollments where lead_id = survivor and status in ('active','paused')) <> 1
    or (select snapshot#>>'{form_payload,source_only,answer}' from public.lead_merge_archive where absorbed_id = absorbed) <> 'preserved' then
    raise exception 'Merge lost or detached child/history records';
  end if;
  if jsonb_array_length((select form_payload#>'{profile,vehicles}' from public.leads where id = survivor)) <> 2 then
    raise exception 'Merge failed to union profile assets';
  end if;
  if not (public.merge_leads_atomic(survivor,array[absorbed],'{}')->>'replayed')::boolean then
    raise exception 'Merge retry was not idempotent';
  end if;
  fields := jsonb_build_object('insured_name','Different policy name','carrier','Test carrier','line_of_business','Auto',
    'policy_number','TEST-1','effective_date','2026-01-01','expiration_date','2026-11-20','renewal_date','2026-11-20',
    'premium',1000,'status','issued');
  result := public.issue_policy_atomic(request_id,account,survivor,fields);
  issued := (result#>>'{policy,id}')::uuid;
  if (public.issue_policy_atomic(request_id,account,survivor,fields)->>'created')::boolean then
    raise exception 'Issuance retry created another policy';
  end if;
  begin
    perform public.issue_policy_atomic(request_id,account,survivor,fields || '{"premium":2000}');
    raise exception 'Expected reused issuance ID conflict';
  exception when unique_violation then null;
  end;
  begin
    perform public.issue_policy_atomic(gen_random_uuid(),account,wrong,fields);
    raise exception 'Expected differently-linked lead issuance rejection';
  exception when check_violation then null;
  end;
  if (select count(*) from public.policies where policy_number = 'TEST-1') <> 1
    or (select status from public.leads where id = wrong) <> 'new' then
    raise exception 'Rejected issuance changed another lead or created a policy';
  end if;
  perform public.update_policy_atomic(issued,'{"insured_name":"Changed policy only","phone":null}');
  if (select jsonb_build_object('full_name',c.full_name,'email',c.email,'phone',c.phone,'address',c.address,'source',c.source)
      from public.clients c where id = account) <> original_account then
    raise exception 'Policy save overwrote account contact/source fields';
  end if;
  if not exists(select 1 from public.leads where id = survivor and account_id = account and status = 'won') then
    raise exception 'Explicit lead completion was not linked to issuance';
  end if;
  original_due := '2026-11-19T17:00:00Z';
  insert into public.tasks(subject,related_type,related_id,status,due_date) values
    ('Review renewal options for Changed policy only','policy',issued,'completed',original_due),
    ('Renewal pipeline initialized for Changed policy only','renewal_pipeline',issued,'open',original_due);
  perform public.reconcile_legacy_renewal_tasks(issued);
  select id into canonical from public.tasks where renewal_policy_id = issued and renewal_canonical;
  if (select status from public.tasks where id = canonical) <> 'completed'
    or (select due_date from public.tasks where id = canonical) <> original_due
    or (select count(*) from public.tasks where renewal_policy_id = issued) <> 2 then
    raise exception 'Reconciliation destroyed completion, snooze or legacy history';
  end if;
  fields := jsonb_build_object('subject','Renewal review','description','Review renewal','due_date',original_due,'priority','high');
  perform public.persist_renewal_radar(issued,'2026-11-20',15,fields,'First wording');
  result := public.persist_renewal_radar(issued,'2026-11-20',15,fields,'Changed wording');
  if (result->>'tasksCreated')::integer <> 0 or (result->>'notifications')::integer <> 0
    or (select count(*) from public.notifications where renewal_key = issued::text || ':2026-11-20:15') <> 1
    or (select status from public.tasks where id = canonical) <> 'completed' then
    raise exception 'Radar duplicated term/milestone work or reopened completed work';
  end if;
end;
$test$;
rollback;
