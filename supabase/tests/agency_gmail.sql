begin;
do $test$
<<fixture>>
declare
  owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid(); lead_id uuid:=gen_random_uuid(); duplicate_id uuid:=gen_random_uuid();
  connection_id uuid; lease uuid; enrollment_id uuid:=gen_random_uuid(); attempt_id uuid:=gen_random_uuid();
  log_id uuid; second_id uuid; outbox_id uuid; before_tasks bigint; before_notifications bigint;
  msg jsonb; sender jsonb:='{"name":"Taylor","signature":"Taylor\nShield Assurance","agency":"Shield Assurance"}';
  originally_empty boolean:=not exists(select 1 from agency_members);
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'gmail-owner-'||owner_id||'@example.invalid',now()),
    (admin_id,'gmail-admin-'||admin_id||'@example.invalid',now()),
    (agent_id,'gmail-agent-'||agent_id||'@example.invalid',now());
  if originally_empty then perform bootstrap_agency_owner(owner_id);
  else insert into agency_members(user_id,email,role) select id,email,'owner' from auth.users where id=owner_id; end if;
  insert into agency_members(user_id,email,role,sender_profile) select id,email,case when id=admin_id then 'admin' else 'agent' end,sender
    from auth.users where id in (admin_id,agent_id);
  begin
    perform manage_agency_member(agent_id,admin_id,'owner',true);
    raise exception 'Agent escalated roles';
  exception when insufficient_privilege then null; end;
  begin
    perform manage_agency_member(admin_id,agent_id,'admin',true);
    raise exception 'Admin escalated roles';
  exception when insufficient_privilege then null; end;
  if originally_empty then
    begin
      perform manage_agency_member(owner_id,owner_id,'agent',true);
      raise exception 'Last owner was removed';
    exception when invalid_parameter_value then null; end;
  end if;
  if has_table_privilege('authenticated','public.gmail_tokens','SELECT') or
    has_table_privilege('anon','public.gmail_connections','SELECT') or
    has_function_privilege('authenticated','public.gmail_ingest_message(uuid,jsonb,boolean)','EXECUTE') then
    raise exception 'Private Gmail data or ingestion was exposed'; end if;
  insert into clients(id,full_name,email) values(client_id,'Gmail fixture contact','gmail-contact-'||client_id||'@example.invalid');
  insert into leads(id,full_name,email,account_id,status) select lead_id,'Gmail fixture lead',email,client_id,'new' from clients where id=client_id;
  perform assign_agency_agent(owner_id,'lead',lead_id,agent_id);
  if not exists(select 1 from leads where id=lead_id and agent_user_id=agent_id) then raise exception 'Assignment not persisted'; end if;
  connection_id:=connect_agent_gmail(agent_id,'gmail-mailbox-'||agent_id||'@example.invalid','encrypted-refresh','encrypted-access',now()+interval '1 hour');
  begin
    perform connect_agent_gmail(admin_id,'gmail-mailbox-'||agent_id||'@example.invalid','private','private',now());
    raise exception 'Mailbox was claimed by a second agent';
  exception when unique_violation then null; end;
  select sync_lease_token into lease from claim_gmail_sync(connection_id);
  if lease is null or exists(select 1 from claim_gmail_sync(connection_id)) then raise exception 'Sync claims are not exclusive'; end if;
  insert into gmail_thread_links values(connection_id,'fixture-thread',client_id,lead_id,'linked',null);
  insert into sequence_enrollments(id,lead_id,status,next_send_at,agent_user_id,gmail_connection_id,approved_sender)
    values(enrollment_id,lead_id,'active',now(),agent_id,connection_id,sender);
  select count(*) into before_tasks from tasks;
  select count(*) into before_notifications from notifications;
  msg:=jsonb_build_object('id','fixture-old','thread_id','fixture-thread','counterpart','gmail-contact-'||client_id||'@example.invalid',
    'participants',jsonb_build_array('gmail-contact-'||client_id||'@example.invalid'),'lease_token',lease,
    'direction','inbound','from','gmail-contact-'||client_id||'@example.invalid','to','gmail-mailbox-'||agent_id||'@example.invalid',
    'subject','Recorded request','body','Please call about my request.','sent_at',now()-interval '30 days','rfc_message_id','<fixture-old-'||agent_id||'>');
  log_id:=gmail_ingest_message(connection_id,msg,true);
  if log_id is null or (select read_at from communication_log where id=log_id) is null then raise exception 'Historical message not marked read'; end if;
  if (select count(*) from tasks)<>before_tasks or (select count(*) from notifications)<>before_notifications or
    (select status from sequence_enrollments where id=enrollment_id)<>'active' then raise exception 'History triggered live automations'; end if;
  if gmail_ingest_message(connection_id,msg,true)<>log_id then raise exception 'Historical replay duplicated a message'; end if;
  -- The same message seen by backfill before history replay must still produce live effects once.
  if gmail_ingest_message(connection_id,msg,false)<>log_id then raise exception 'Live promotion duplicated a message'; end if;
  if (select status from sequence_enrollments where id=enrollment_id)<>'replied' then raise exception 'Live reply did not stop sequence'; end if;
  select count(*) into before_notifications from notifications;
  perform gmail_ingest_message(connection_id,msg,false);
  if (select count(*) from notifications)<>before_notifications then raise exception 'Live replay duplicated notification'; end if;
  insert into clients(id,full_name,email) select duplicate_id,'Duplicate email fixture',email from clients where id=client_id;
  begin
    perform gmail_ingest_message(connection_id,msg||'{"id":"ambiguous-copy"}'::jsonb,true);
    raise exception 'Ambiguous participants were retained';
  exception when invalid_parameter_value then null; end;
  delete from clients where id=duplicate_id;
  update sequence_enrollments set status='active' where id=enrollment_id;
  begin
    perform authorize_agent_sequence(agent_id,enrollment_id,'auto',true);
    raise exception 'Missing marketing consent accepted';
  exception when invalid_parameter_value then null; end;
  perform record_marketing_consent(agent_id,'gmail-contact-'||client_id||'@example.invalid','Fixture explicit consent',true);
  perform authorize_agent_sequence(agent_id,enrollment_id,'auto',true);
  if not (select auto_send_enabled from sequence_enrollments where id=enrollment_id) then raise exception 'Explicit auto-send approval missing'; end if;
  perform create_outreach_draft(enrollment_id,1,'gmail-contact-'||client_id||'@example.invalid','Review','Fixture body','[]');
  select id into outbox_id from outreach_outbox where outreach_outbox.enrollment_id=fixture.enrollment_id and step_number=1;
  if not exists(select 1 from outreach_outbox where id=outbox_id and agent_user_id=agent_id and gmail_connection_id=connection_id) then
    raise exception 'Draft lost agent ownership'; end if;
  begin
    perform authorize_agent_sequence(agent_id,enrollment_id,'quote_response',true);
    raise exception 'Existing draft auto-approved under a different purpose';
  exception when invalid_parameter_value then null; end;
  update agency_members set sender_profile=sender_profile||'{"tone":"Concise"}'::jsonb where user_id=agent_id;
  if (select auto_send_enabled from sequence_enrollments where id=enrollment_id) then raise exception 'Changed profile retained auto approval'; end if;
  -- A provider timeout is reconciled from Sent, never resent; sequence recording reuses the same communication.
  insert into agent_email_attempts(id,user_id,connection_id,client_id,lead_id,to_email,subject,body,content_hash,status,rfc_message_id)
    values(outbox_id,agent_id,connection_id,client_id,lead_id,'gmail-contact-'||client_id||'@example.invalid','Review','Fixture body','fixture-hash','acceptance_unknown','<fixture-send-'||agent_id||'>');
  msg:=msg||jsonb_build_object('id','fixture-sent','direction','outbound','from','gmail-mailbox-'||agent_id||'@example.invalid',
    'to','gmail-contact-'||client_id||'@example.invalid','subject','Review','body','Fixture body','rfc_message_id','<fixture-send-'||agent_id||'>');
  second_id:=gmail_ingest_message(connection_id,msg,true);
  if (select status from agent_email_attempts where id=outbox_id)<>'recorded' then raise exception 'Uncertain send was not reconciled'; end if;
  update outreach_outbox set status='accepted_by_provider',sent_at=now(),provider='gmail' where id=outbox_id;
  update sequence_enrollments set total_steps=1 where id=enrollment_id;
  perform finalize_outreach_send(outbox_id,now()+interval '1 day');
  perform finalize_outreach_send(outbox_id,now()+interval '1 day');
  if (select count(*) from communication_log where metadata->>'rfc_message_id'='<fixture-send-'||agent_id||'>')<>1 or
    (select current_step from sequence_enrollments where id=enrollment_id)<>1 then raise exception 'Finalization duplicated communication or step'; end if;
  if (select count(*) from tasks where related_id=fixture.lead_id and subject like 'Call %email sequence finished')<>1 or
    (select status from sequence_enrollments where id=enrollment_id)<>'completed' then raise exception 'Completion follow-up was not created exactly once'; end if;
  update sequence_enrollments set status='active' where id=enrollment_id;
  perform manage_agency_member(owner_id,agent_id,'agent',false);
  if exists(select 1 from claim_gmail_sync(connection_id)) or (select status from sequence_enrollments where id=enrollment_id)<>'paused' then
    raise exception 'Inactive agent work was not suspended'; end if;
  perform disconnect_agent_gmail(agent_id);
  if exists(select 1 from gmail_tokens where gmail_tokens.connection_id=fixture.connection_id) then raise exception 'Disconnect retained credentials'; end if;
  perform set_config('request.jwt.claim.sub',agent_id::text,true);
  execute 'set local role authenticated';
  if public.agency_session_allowed() or exists(select 1 from clients where id=fixture.client_id) then
    raise exception 'Inactive authenticated session bypassed membership through direct table access'; end if;
  execute 'reset role';
end;
$test$;
rollback;
