begin;
do $test$
declare actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); mailbox uuid:=gen_random_uuid();
  other_mailbox uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); legacy_lead uuid:=gen_random_uuid();
  plan jsonb; enrollment jsonb; legacy jsonb; outbox uuid; legacy_outbox uuid;
  address text:='personal-fixture-'||lead||'@example.invalid';
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,'personal-owner-'||actor||'@example.invalid',now()),(other_actor,'personal-other-'||other_actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role,active) select id,email,'admin',true from auth.users where id in (actor,other_actor);
  insert into gmail_connections(id,user_id,email,sync_enabled) values
    (mailbox,actor,'personal-mailbox-'||actor||'@example.invalid',false),(other_mailbox,other_actor,'personal-other-'||other_actor||'@example.invalid',false);
  insert into leads(id,full_name,email,status,agent_user_id) values
    (lead,'Synthetic personal fixture',address,'new',actor),(legacy_lead,'Synthetic legacy fixture','legacy-'||legacy_lead||'@example.invalid','new',actor);
  update outreach_settings set daily_send_cap=1000000 where id=1;
  plan:=jsonb_build_object('actor',actor,'preset','initial_contact','stage','new','assigned_agent',actor,'recipient',address,
    'mailbox',mailbox,'auto_send',true,'steps',jsonb_build_array(
      jsonb_build_object('template',jsonb_build_object('id','introduction','revision',0),'requires_review',false),
      jsonb_build_object('template',jsonb_build_object('id','close_loop','revision',0),'requires_review',false)));
  begin
    perform enroll_personal_gmail_sales_sequence(actor,lead,plan||jsonb_build_object('mailbox',other_mailbox),5);
    raise exception 'Wrong mailbox was accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform enroll_personal_gmail_sales_sequence(actor,lead,jsonb_set(plan,'{steps,0,requires_review}','true'::jsonb),5);
    raise exception 'Unreviewed first step was approved';
  exception when invalid_parameter_value then null; end;
  enrollment:=enroll_personal_gmail_sales_sequence(actor,lead,plan,5);
  if enrollment->'sales_plan'->>'auto_send'<>'true' or enrollment->>'gmail_connection_id'<>mailbox::text then
    raise exception 'Personal Gmail approval or mailbox was not persisted'; end if;
  perform create_outreach_draft((enrollment->>'id')::uuid,1,address,'Reviewed subject','Reviewed body','[]'::jsonb);
  select id into outbox from outreach_outbox where enrollment_id=(enrollment->>'id')::uuid;
  if not claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then
    raise exception 'Reviewed personal Gmail was blocked by a missing consent record'; end if;
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then raise exception 'Duplicate claim was accepted'; end if;
  update outreach_outbox set status='pending_approval',sent_at=null where id=outbox;
  insert into email_suppressions(email,reason) values(address,'Fixture bounce');
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then raise exception 'Suppression was ignored'; end if;
  delete from email_suppressions where email=address;
  insert into outreach_opt_outs(email) values(address);
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then raise exception 'Opt-out was ignored'; end if;
  delete from outreach_opt_outs where email=address;
  insert into marketing_email_consents(email,source,consented_at,recorded_by,revoked_at) values(address,'Fixture revoked',now(),actor,now());
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then raise exception 'Recorded revocation was ignored'; end if;
  delete from marketing_email_consents where email=address;
  update leads set form_payload='{"metadata":{"contactConsent":{"accepted":false}}}'::jsonb where id=lead;
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then raise exception 'Explicit refusal was ignored'; end if;
  update leads set form_payload='{}'::jsonb where id=lead;
  update outreach_outbox set gmail_connection_id=other_mailbox where id=outbox;
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then raise exception 'Changed mailbox was sendable'; end if;
  update outreach_outbox set gmail_connection_id=mailbox where id=outbox;
  update gmail_connections set status='disconnected' where id=mailbox;
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then raise exception 'Disconnected mailbox was sendable'; end if;
  update gmail_connections set status='connected' where id=mailbox;
  perform set_sales_sequence_state(actor,(enrollment->>'id')::uuid,'pause');
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',1) then raise exception 'Paused sequence was sendable'; end if;
  perform set_sales_sequence_state(actor,(enrollment->>'id')::uuid,'resume');
  if claim_outreach_send(outbox,'Reviewed subject','Reviewed body',null) then raise exception 'Resume silently reenabled auto-send'; end if;
  legacy:=enroll_sales_sequence(actor,legacy_lead,(plan-'mailbox')||jsonb_build_object('recipient','legacy-'||legacy_lead||'@example.invalid'),5);
  perform create_outreach_draft((legacy->>'id')::uuid,1,'legacy-'||legacy_lead||'@example.invalid','Legacy subject','Legacy body','[]'::jsonb);
  select id into legacy_outbox from outreach_outbox where enrollment_id=(legacy->>'id')::uuid;
  if claim_outreach_send(legacy_outbox,'Legacy subject','Legacy body',1) then raise exception 'Legacy Resend bypassed consent'; end if;
  if not exists(select 1 from cron.job where jobname='crm-personal-gmail'
    and schedule='*/5 * * * *' and command='select public.queue_personal_gmail()')
    or has_function_privilege('authenticated','public.configure_personal_gmail_scheduler(uuid,boolean)','EXECUTE')
    or has_function_privilege('service_role','public.queue_personal_gmail()','EXECUTE') then
    raise exception 'Gmail scheduler activation or privileges are unsafe'; end if;
  begin
    perform configure_personal_gmail_scheduler(actor,true);
    raise exception 'Admin activated scheduling without owner permission';
  exception when insufficient_privilege then null; end;
end;
$test$;
rollback;
