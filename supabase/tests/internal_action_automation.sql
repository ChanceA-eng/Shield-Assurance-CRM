begin;
do $test$
<<fixture>>
declare
  account uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); policy uuid:=gen_random_uuid();
  claim uuid:=gen_random_uuid(); message uuid; reply_task uuid; outbox uuid:=gen_random_uuid();
  receipt jsonb; task_id uuid; version timestamptz;
  unmatched uuid:=gen_random_uuid(); unlinked uuid:=gen_random_uuid(); linked_reply uuid;
begin
  insert into clients(id,full_name) values(account,'Internal automation fixture');
  insert into leads(id,full_name,email,account_id) values(lead,'Automation lead','internal-automation@example.invalid',account);
  insert into policies(id,client_id,insured_name,carrier,line_of_business,premium,effective_date,renewal_date)
    values(policy,account,'Automation fixture','Test','Auto',100,current_date,current_date+365);
  insert into claims(id,client_id,policy_id,type,date_of_loss) values(claim,account,policy,'Fixture claim',current_date);
  select id into task_id from tasks where automation_key='service:claim:'||claim::text;
  if task_id is null then raise exception 'Service did not queue a task immediately'; end if;
  perform sync_service_action('claim',claim);
  perform sync_service_action('claim',claim);
  if (select count(*) from tasks where related_type='claim' and related_id=claim)<>1 then raise exception 'Service task duplicated'; end if;
  if (select count(*) from notifications n where n.task_id=fixture.task_id and automation_key='service:claim:'||claim::text||':'||claim::text)<>1
    then raise exception 'Service notification duplicated'; end if;
  update tasks set assignee='Servicing agent',due_date=now()+interval '10 days' where id=task_id;
  select updated_at into version from tasks where id=task_id;
  perform sync_service_action('claim',claim);
  if not exists(select 1 from tasks where id=task_id and assignee='Servicing agent' and updated_at=version)
    then raise exception 'Reconciliation overwrote ownership, snooze or optimistic version'; end if;
  update tasks set status='completed' where id=task_id;
  perform sync_service_action('claim',claim);
  if not exists(select 1 from tasks where id=task_id and status='completed') then raise exception 'Manual completion requeued unchanged work'; end if;
  update claims set status='closed' where id=claim;
  update claims set status='open' where id=claim;
  if not exists(select 1 from tasks where id=task_id and status='open') then raise exception 'Reopened claim did not reopen its task'; end if;
  update claims set status='closed' where id=claim;
  if not exists(select 1 from tasks where id=task_id and status='completed') then raise exception 'Closing claim left task open'; end if;

  receipt:=ingest_inbound_message('internal-fixture:'||lead::text,account,lead,'email','internal-automation@example.invalid',
    'agency@example.invalid','Question','Please call',now(),'internal-fixture');
  message:=(receipt->>'id')::uuid;
  perform alert_inbound_message(message,false);
  perform alert_inbound_message(message,false);
  select id into reply_task from tasks where inbound_reply_key='client:'||account::text and status='open';
  if reply_task is null then raise exception 'Inbound did not create an ordinary task'; end if;
  if (select count(*) from notifications where message_log_id=fixture.message)<>1 then raise exception 'Inbound notification duplicated'; end if;
  update communication_log set read_at=now() where id=message;
  if not exists(select 1 from tasks where id=reply_task and status='open') then raise exception 'Reading completed a reply'; end if;
  insert into communication_log(client_id,channel,direction,sent_at,metadata) values(account,'email','outbound',now()+interval '1 minute',
    '{"delivery_status":"failed"}');
  if not exists(select 1 from tasks where id=reply_task and status='open') then raise exception 'Failed outbound completed a reply'; end if;
  insert into communication_log(client_id,channel,direction,sent_at,metadata) values(account,'email','outbound',now()+interval '2 minutes',
    '{"delivery_status":"accepted_by_provider"}');
  if not exists(select 1 from tasks where id=reply_task and status='completed') then raise exception 'Accepted reply left task open'; end if;
  receipt:=ingest_inbound_message('internal-fixture-next:'||lead::text,account,lead,'email','internal-automation@example.invalid',
    'agency@example.invalid','Another question','Please call again',now()+interval '3 minutes','internal-fixture-next');
  perform alert_inbound_message((receipt->>'id')::uuid,false);
  if not exists(select 1 from tasks where id=reply_task and status='open') then raise exception 'New inbound did not reopen follow-up'; end if;
  update tasks set status='completed' where id=reply_task;
  perform sync_reply_action((receipt->>'id')::uuid,true);
  if not exists(select 1 from tasks where id=reply_task and status='completed') then raise exception 'Reconciliation undid manual completion'; end if;

  insert into outreach_outbox(id,lead_id,to_email,subject,body) values(outbox,lead,'internal-automation@example.invalid','Fixture draft','Not sent');
  if not exists(select 1 from tasks where automation_key='outreach:'||outbox::text and action_category='approval' and related_id=lead)
    then raise exception 'Draft approval missing from canonical lead tasks'; end if;
  update outreach_outbox set status='sending',sent_at=now() where id=outbox;
  if exists(select 1 from tasks where automation_key='outreach:'||outbox::text and status='open') then raise exception 'Claimed approval remains open'; end if;
  update outreach_outbox set status='acceptance_unknown' where id=outbox;
  if not exists(select 1 from tasks where automation_key='outreach:'||outbox::text and status='open' and action_category='delivery')
    then raise exception 'Uncertain delivery did not queue internal review'; end if;
  update outreach_outbox set status='sent' where id=outbox;
  if exists(select 1 from tasks where automation_key='outreach:'||outbox::text and status='open') then raise exception 'Recorded send left approval unresolved'; end if;
  if has_function_privilege('authenticated','public.reconcile_internal_actions()','EXECUTE')
    or has_function_privilege('anon','public.sync_service_action(text,uuid)','EXECUTE') then raise exception 'Internal automation exposed'; end if;

  insert into communication_log(id,channel,direction,body,sent_at,metadata)
    values(unmatched,'email','inbound','Please call',now(),jsonb_build_object('from',unmatched::text||'@example.invalid'));
  perform alert_inbound_message(unmatched,false);
  perform alert_inbound_message(unmatched,false);
  if (select count(*) from tasks where related_type='conversation' and related_id=unmatched and status='open'
      and action_href like '/communication?conversation=%')<>1
    or (select count(*) from notifications where message_log_id=unmatched)<>1
    then raise exception 'Unmatched inbound missing its unique ordinary follow-up'; end if;

  insert into leads(id,full_name,email) values(unlinked,'Unlinked automation fixture',unlinked::text||'@example.invalid');
  receipt:=ingest_inbound_message('link-fixture:'||unlinked::text,null,unlinked,'email',unlinked::text||'@example.invalid',
    'agency@example.invalid','Link question','Please call',now()+interval '4 minutes','link-fixture');
  perform alert_inbound_message((receipt->>'id')::uuid,false);
  select id into linked_reply from tasks where related_type='lead' and related_id=unlinked and action_category='reply';
  if linked_reply is null then raise exception 'Unlinked lead follow-up missing'; end if;
  update leads set account_id=fixture.account where id=unlinked;
  perform sync_reply_action((receipt->>'id')::uuid,true);
  if (select count(*) from tasks where status='open' and action_category='reply'
      and (account_id=fixture.account or (related_type='lead' and related_id=unlinked)))<>1
    then raise exception 'Account linking duplicated reply work'; end if;
  insert into communication_log(client_id,channel,direction,sent_at,metadata)
    values(account,'email','outbound',now()+interval '5 minutes','{"delivery_status":"accepted_by_provider"}');
  if exists(select 1 from tasks where status='open' and action_category='reply'
      and (account_id=fixture.account or (related_type='lead' and related_id=unlinked)))
    then raise exception 'Linked lead reply left an orphaned open task'; end if;
end;
$test$;
rollback;
