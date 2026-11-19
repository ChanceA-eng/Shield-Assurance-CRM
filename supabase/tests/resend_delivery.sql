begin;
do $test$
declare
  l uuid:=gen_random_uuid(); attempt jsonb; again jsonb;
  address text:='resend-'||gen_random_uuid()::text||'@example.invalid';
  provider text:=gen_random_uuid()::text; enrollment uuid; outbox uuid;
begin
  insert into leads(id,full_name,email,status,source) values(l,'Resend rollback fixture',address,'new','prospect_import');
  begin
    perform begin_resend_send('no-consent',address,'Subject',repeat('a',64),'marketing',l,null);
    raise exception 'Unconsented marketing sent';
  exception when insufficient_privilege then null; end;
  begin
    perform begin_resend_send('no-request',address,'Subject',repeat('a',64),'service',l,null);
    raise exception 'Cold imported lead treated as service request';
  exception when insufficient_privilege then null; end;
  insert into marketing_email_consents(email,source,consented_at) values(address,'Rollback fixture explicit opt-in',now());
  attempt:=begin_resend_send('qa-resend-'||l::text,address,'Subject',repeat('a',64),'marketing',l,null);
  if attempt->>'claimed'<>'true' then raise exception 'Send not claimed'; end if;
  again:=begin_resend_send('qa-resend-'||l::text,address,'Subject',repeat('a',64),'marketing',l,null);
  if again->>'claimed'<>'false' or again->>'id'<>attempt->>'id' then raise exception 'Duplicate send claimed'; end if;
  begin
    perform begin_resend_send('qa-resend-'||l::text,address,'Other',repeat('b',64),'marketing',l,null);
    raise exception 'Changed content reused request';
  exception when sqlstate 'PT409' then null; end;
  perform finish_resend_send((attempt->>'id')::uuid,provider);
  again:=begin_resend_send('qa-resend-'||l::text,address,'Subject',repeat('a',64),'marketing',l,null);
  if again->>'status'<>'accepted' or again->>'provider_id'<>provider then raise exception 'Acceptance not reusable'; end if;
  perform record_resend_event('delivery-'||l::text,provider,'email.delivered',now(),null);
  perform record_resend_event('delivery-'||l::text,provider,'email.delivered',now(),null);
  if (select count(*) from resend_delivery_events where attempt_id=(attempt->>'id')::uuid)<>1 then raise exception 'Event not idempotent'; end if;
  perform record_resend_event('opened-'||l::text,provider,'email.opened',now(),null);
  perform record_resend_event('opened-'||l::text,provider,'email.opened',now(),null);
  if (select count(*) from resend_delivery_events where attempt_id=(attempt->>'id')::uuid and type='email.opened')<>1
    then raise exception 'Open event not idempotent'; end if;
  if exists(select 1 from email_suppressions where email=address) then raise exception 'Open event suppressed recipient'; end if;
  begin
    perform record_resend_event('forged-'||l::text,gen_random_uuid()::text,'email.opened',now(),(attempt->>'id')::uuid);
    raise exception 'Mismatched open receipt accepted';
  exception when invalid_parameter_value then null; end;
  insert into sequence_enrollments(lead_id,total_steps) values(l,2) returning id into enrollment;
  insert into outreach_outbox(lead_id,enrollment_id,step_number,to_email,subject,body)
    values(l,enrollment,1,address,'Review','Draft') returning id into outbox;
  perform record_resend_event('complaint-'||l::text,provider,'email.complained',now(),null);
  if not exists(select 1 from email_suppressions where email=address) then raise exception 'Complaint not suppressed'; end if;
  if (select status from sequence_enrollments where id=enrollment)<>'opted_out' then raise exception 'Sequence not stopped'; end if;
  if (select status from outreach_outbox where id=outbox)<>'rejected' then raise exception 'Draft not rejected'; end if;
  begin
    perform begin_resend_send('blocked-'||l::text,address,'Subject',repeat('a',64),'service',l,null);
    raise exception 'Suppression bypassed';
  exception when insufficient_privilege then null; end;
  perform unsubscribe_marketing_email(address);
  perform unsubscribe_marketing_email(address);
  if not exists(select 1 from marketing_email_consents where email=address and revoked_at is not null) then raise exception 'Unsubscribe did not revoke consent'; end if;
  perform archive_leads(array[l],'QA',null);
  perform purge_leads(array[l],'QA');
  if exists(select 1 from resend_send_attempts where lead_id=l)
    or exists(select 1 from resend_delivery_events where attempt_id=(attempt->>'id')::uuid) then raise exception 'Lead purge left email history'; end if;
  if not exists(select 1 from email_suppressions where email=address) then raise exception 'Purge forgot suppression'; end if;
  perform record_resend_event('late-'||l::text,provider,'email.sent',now(),(attempt->>'id')::uuid);
  if exists(select 1 from resend_delivery_events where event_id='late-'||l::text) then raise exception 'Late webhook recreated purged history'; end if;
  if has_function_privilege('anon','public.begin_resend_send(text,text,text,text,text,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.record_resend_event(text,text,text,timestamptz,uuid)','execute') then
    raise exception 'Private email functions exposed'; end if;
end;
$test$;
do $test$
declare l uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); attempt jsonb; provider text:=gen_random_uuid()::text;
  address text:='recovery-'||gen_random_uuid()::text||'@example.invalid';
begin
  insert into leads(id,full_name,email,status) values(l,'Resend recovery fixture',address,'new');
  insert into marketing_email_consents(email,source,consented_at) values(address,'Recovery fixture consent',now());
  insert into outreach_outbox(id,lead_id,step_number,to_email,subject,body,status)
    values(o,l,1,address,'Review','Draft','acceptance_unknown');
  attempt:=begin_resend_send('outreach:'||o::text,address,'Review',repeat('a',64),'marketing',l,null);
  perform record_resend_event('recovery-'||o::text,provider,'email.sent',now(),(attempt->>'id')::uuid);
  if not exists(select 1 from outreach_outbox box where box.id=o and box.status='accepted_by_provider' and box.provider='resend')
    then raise exception 'Webhook did not recover uncertain outreach acceptance'; end if;
  if (select count(*) from resend_send_attempts where id=(attempt->>'id')::uuid and status='accepted')<>1
    then raise exception 'Webhook did not recover provider receipt'; end if;
end;
$test$;
rollback;
