-- Run only against an isolated test database after the migration chain.
begin;

do $test$
declare
  account uuid:=gen_random_uuid();
  lead uuid:=gen_random_uuid();
  enrollment uuid;
  receipt jsonb;
  retry jsonb;
  receipt_key text:='email:id:test-'||gen_random_uuid()::text;
  draft uuid;
begin
  insert into clients(id,full_name) values(account,'Messaging fixture');
  insert into leads(id,full_name,email,phone,status) values(lead,'Messaging lead','fixture@example.invalid','(520) 555-0123','new');
  insert into sequence_enrollments(lead_id,total_steps) values(lead,1) returning id into enrollment;
  receipt:=ingest_inbound_message(receipt_key,account,lead,'email','fixture@example.invalid','reply@example.invalid','Question','Call me',now(),'provider-one');
  retry:=ingest_inbound_message(receipt_key,null,null,'email','fixture@example.invalid',null,'Changed retry','Changed',now()+interval '1 minute','provider-one');
  if receipt->>'id'<>retry->>'id' then raise exception 'Duplicate inbound receipt'; end if;
  if (select count(*) from communication_log where inbound_event_key=receipt_key)<>1 then raise exception 'Duplicate inbound log'; end if;
  if (select body from communication_log where id=(receipt->>'id')::uuid)<>'Call me' then raise exception 'Retry overwrote original message'; end if;
  if (select last_activity_at from clients where id=account) is null then raise exception 'Missing account activity'; end if;
  perform process_outreach_reply(account,'fixture@example.invalid',null,'Call me',(receipt->>'id')::uuid);
  -- The reply checkpoint survives a downstream alert failure and does not change on retry.
  if process_outreach_reply(account,'fixture@example.invalid',null,'Call me',(receipt->>'id')::uuid)->'sequenceLeadIds'<>jsonb_build_array(lead)
    then raise exception 'Reply checkpoint not recovered'; end if;
  if (select status from sequence_enrollments where id=enrollment)<>'replied' then raise exception 'Sequence not stopped'; end if;
  perform alert_inbound_message((receipt->>'id')::uuid,false);
  perform alert_inbound_message((receipt->>'id')::uuid,false);
  if (select count(*) from notifications where message_log_id=(receipt->>'id')::uuid)<>1 then raise exception 'Duplicate inbound alert'; end if;

  insert into sequence_enrollments(lead_id,total_steps) values(lead,1) returning id into enrollment;
  if not create_outreach_draft(enrollment,1,'fixture@example.invalid','Subject','Draft','[]') then raise exception 'Draft missing'; end if;
  if create_outreach_draft(enrollment,1,'fixture@example.invalid','Duplicate','Draft','[]') then raise exception 'Duplicate draft'; end if;
  select id into draft from outreach_outbox where enrollment_id=enrollment;
  if not claim_outreach_send(draft,'Subject','Body with footer') then raise exception 'Claim failed'; end if;
  if claim_outreach_send(draft,'Other','Duplicate') then raise exception 'Second send claim allowed'; end if;
  update outreach_outbox set status='accepted_by_provider',provider='sendgrid' where id=draft;
  perform finalize_outreach_send(draft,now()+interval '1 day');
  perform finalize_outreach_send(draft,now()+interval '1 day');
  if (select count(*) from communication_log where metadata->>'outbox_id'=draft::text)<>1 then raise exception 'Duplicate outbound log'; end if;
  if (select count(*) from tasks where related_id=lead and subject like 'Call %sequence finished')<>1 then raise exception 'Duplicate completion work'; end if;
  if not exists(select 1 from communication_log where metadata->>'outbox_id'=draft::text
      and client_id is null and metadata->>'lead_id'=lead::text and metadata->>'delivery_status'='accepted_by_provider')
    then raise exception 'Lead-only log or acceptance status lost'; end if;
  if (select account_id from leads where id=lead) is not null then raise exception 'Sending created an account'; end if;

  insert into sequence_enrollments(lead_id,total_steps) values(lead,1) returning id into enrollment;
  perform create_outreach_draft(enrollment,1,'fixture@example.invalid','Subject','Draft','[]');
  select id into draft from outreach_outbox where enrollment_id=enrollment;
  update outreach_outbox set status='acceptance_unknown' where id=draft;
  if claim_outreach_send(draft,'Subject','Draft') then raise exception 'Uncertain send reclaimed'; end if;
  if create_outreach_draft(enrollment,1,'fixture@example.invalid','Subject','Draft','[]') then raise exception 'Uncertain step redrafted'; end if;
  perform process_outreach_reply(null,null,'+1 520-555-0123','STOP',null);
  if not exists(select 1 from outreach_opt_outs where email='fixture@example.invalid') then raise exception 'SMS STOP lost'; end if;
  if (select status from sequence_enrollments where id=enrollment)<>'opted_out' then raise exception 'SMS did not stop sequence'; end if;
  if (select status from outreach_outbox where id=draft)<>'acceptance_unknown' then raise exception 'Reply erased uncertain acceptance'; end if;
end;
$test$;

do $test$
declare
  lead uuid:=gen_random_uuid();
  enrollment uuid;
  first_draft uuid;
  duplicate_draft uuid;
begin
  insert into leads(id,full_name,email,status) values(lead,'Concurrent send fixture','concurrent@example.invalid','new');
  insert into sequence_enrollments(lead_id,total_steps) values(lead,2) returning id into enrollment;
  perform create_outreach_draft(enrollment,1,'concurrent@example.invalid','Subject','Draft','[]');
  select id into first_draft from outreach_outbox where enrollment_id=enrollment;
  -- Existing duplicate drafts must not turn into duplicate provider calls.
  insert into outreach_outbox(enrollment_id,lead_id,step_number,to_email,subject,body)
    values(enrollment,lead,1,'concurrent@example.invalid','Legacy duplicate','Draft') returning id into duplicate_draft;
  update outreach_settings set daily_send_cap=0 where id=1;
  if claim_outreach_send(first_draft,'Subject','Body') then raise exception 'Daily cap bypassed'; end if;
  update outreach_settings set daily_send_cap=20 where id=1;
  if not claim_outreach_send(first_draft,'Subject','Body') then raise exception 'First duplicate-step claim failed'; end if;
  if claim_outreach_send(duplicate_draft,'Subject','Body') then raise exception 'Legacy duplicate sent'; end if;
  -- A reply while a provider call is in flight preserves acceptance but cannot reactivate outreach.
  perform process_outreach_reply(null,'concurrent@example.invalid',null,'Please call',null);
  update outreach_outbox set status='accepted_by_provider',provider='gmail' where id=first_draft;
  perform finalize_outreach_send(first_draft,now());
  if (select status from sequence_enrollments where id=enrollment)<>'replied' then raise exception 'Finalization resurrected replied sequence'; end if;
  if (select next_send_at from sequence_enrollments where id=enrollment) is not null then raise exception 'Reply left scheduled send'; end if;
  if (select count(*) from communication_log where metadata->>'outbox_id'=first_draft::text)<>1 then raise exception 'In-flight acceptance lost'; end if;
end;
$test$;

create function public.message_test_failure() returns trigger language plpgsql as $$
begin
  if tg_table_name='clients' then
    if new.full_name='Activity rollback fixture' then raise exception 'Forced activity failure'; end if;
  elsif tg_table_name='tasks' then
    if new.subject like 'Call Finalize rollback fixture%' then raise exception 'Forced final task failure'; end if;
  elsif tg_table_name='outreach_outbox' then
    if new.error='Prospect replied — sequence stopped.' and new.subject='Reply rollback fixture' then raise exception 'Forced reply draft failure'; end if;
  end if;
  return new;
end;
$$;
create trigger message_test_activity_failure before update on public.clients for each row execute function public.message_test_failure();
create trigger message_test_task_failure before insert on public.tasks for each row execute function public.message_test_failure();
create trigger message_test_reply_failure before update on public.outreach_outbox for each row execute function public.message_test_failure();

do $test$
declare
  account uuid:=gen_random_uuid();
  lead uuid:=gen_random_uuid();
  enrollment uuid;
  draft uuid;
  receipt_key text:='email:id:rollback-'||gen_random_uuid()::text;
begin
  insert into clients(id,full_name) values(account,'Activity rollback fixture');
  begin
    perform ingest_inbound_message(receipt_key,account,null,'email','fixture@example.invalid',null,'Subject','Body',now(),'rollback');
    raise exception 'Activity failure was swallowed';
  exception when raise_exception then
    if sqlerrm<>'Forced activity failure' then raise; end if;
  end;
  if exists(select 1 from communication_log where inbound_event_key=receipt_key) then raise exception 'Log survived failed activity write'; end if;

  insert into leads(id,full_name,email,status) values(lead,'Finalize rollback fixture','rollback@example.invalid','new');
  insert into sequence_enrollments(lead_id,total_steps) values(lead,1) returning id into enrollment;
  perform create_outreach_draft(enrollment,1,'rollback@example.invalid','Subject','Body','[]');
  select id into draft from outreach_outbox where enrollment_id=enrollment;
  perform claim_outreach_send(draft,'Subject','Body');
  update outreach_outbox set status='accepted_by_provider',provider='gmail' where id=draft;
  begin
    perform finalize_outreach_send(draft,now());
    raise exception 'Final task failure was swallowed';
  exception when raise_exception then
    if sqlerrm<>'Forced final task failure' then raise; end if;
  end;
  if (select status from outreach_outbox where id=draft)<>'accepted_by_provider' then raise exception 'Acceptance lost on failed finalization'; end if;
  if exists(select 1 from communication_log where metadata->>'outbox_id'=draft::text) then raise exception 'Partial outbound log survived'; end if;
  if (select status from sequence_enrollments where id=enrollment)<>'active' then raise exception 'Partial advancement survived'; end if;
  drop trigger message_test_task_failure on public.tasks;
  perform finalize_outreach_send(draft,now());
  if (select status from outreach_outbox where id=draft)<>'sent' then raise exception 'Acceptance recovery failed'; end if;

  insert into sequence_enrollments(lead_id) values(lead) returning id into enrollment;
  perform create_outreach_draft(enrollment,1,'rollback@example.invalid','Reply rollback fixture','Body','[]');
  begin
    perform process_outreach_reply(null,'rollback@example.invalid',null,'Please call',null);
    raise exception 'Reply failure was swallowed';
  exception when raise_exception then
    if sqlerrm<>'Forced reply draft failure' then raise; end if;
  end;
  if (select status from sequence_enrollments where id=enrollment)<>'active' then raise exception 'Partial reply cancellation survived'; end if;
  drop trigger message_test_reply_failure on public.outreach_outbox;
  perform process_outreach_reply(null,'rollback@example.invalid',null,'Please call',null);
  if (select status from sequence_enrollments where id=enrollment)<>'replied' then raise exception 'Reply recovery failed'; end if;
end;
$test$;
rollback;
