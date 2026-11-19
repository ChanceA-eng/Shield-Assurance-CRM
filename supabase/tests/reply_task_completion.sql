begin;
do $test$
<<fixture>>
declare
  account uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); other_account uuid:=gen_random_uuid();
  unrelated uuid:=gen_random_uuid(); reply_task uuid; lead_task uuid; duplicate uuid:=gen_random_uuid();
  receipt jsonb; unsuccessful text;
begin
  insert into clients(id,full_name) values(account,'Cross-channel reply fixture'),(other_account,'Other reply fixture');
  insert into leads(id,full_name,email) values(lead,'Lead reply fixture',lead::text||'@example.invalid');
  insert into tasks(id,subject,status,related_type,related_id,account_id)
    values(unrelated,'Call about renewal','open','client',account,account);
  receipt:=ingest_inbound_message('reply-fixture:'||account::text,account,null,'email','fixture@example.invalid',
    'agency@example.invalid','Question','Please call',now(),'reply-fixture');
  perform alert_inbound_message((receipt->>'id')::uuid,false);
  select id into reply_task from tasks where inbound_reply_key='client:'||account::text and status='open';
  if reply_task is null then raise exception 'Inbound email did not create reply work'; end if;
  foreach unsuccessful in array array['failed','pending','scheduled','sending','acceptance_unknown','bounced','suppressed','cancelled','complained',''] loop
    insert into communication_log(client_id,channel,direction,sent_at,metadata)
      values(account,'sms','outbound',now()+interval '1 minute',jsonb_build_object('delivery_status',unsuccessful));
    if not exists(select 1 from tasks where id=reply_task and status='open')
      then raise exception 'Unsuccessful or unverified outbound (%) completed reply work',unsuccessful; end if;
  end loop;
  insert into communication_log(client_id,channel,direction,sent_at,metadata)
    values(other_account,'email','outbound',now()+interval '2 minutes','{"delivery_status":"accepted_by_provider"}');
  if not exists(select 1 from tasks where id=reply_task and status='open') then raise exception 'Other account send closed reply work'; end if;
  insert into tasks(id,subject,status,related_type,related_id,action_category)
    values(duplicate,'Reply to earlier email','open','client',account,'reply');
  insert into notifications(client_id,type,message,read,task_id)
    values(account,'message','Duplicate reply follow-up',false,duplicate);
  insert into communication_log(client_id,channel,direction,sent_at,metadata)
    values(account,'sms','outbound',now()+interval '2 minutes','{"delivery_status":"accepted_by_provider"}');
  if not exists(select 1 from tasks where id=reply_task and status='completed') then raise exception 'Text did not complete email reply task'; end if;
  if exists(select 1 from tasks where id=duplicate and status='open') then raise exception 'Duplicate reply work stayed open'; end if;
  if exists(select 1 from notifications where task_id in (reply_task,duplicate) and not read)
    then raise exception 'Answered reply notification remained active'; end if;
  if not exists(select 1 from tasks where id=unrelated and status='open') then raise exception 'Reply completed unrelated work'; end if;
  receipt:=ingest_inbound_message('reply-next:'||account::text,account,null,'email','fixture@example.invalid',
    'agency@example.invalid','New question','Please call again',now()+interval '3 minutes','reply-next');
  perform alert_inbound_message((receipt->>'id')::uuid,false);
  if not exists(select 1 from tasks where id=reply_task and status='open') then raise exception 'New inbound did not reopen reply work'; end if;
  insert into communication_log(client_id,channel,direction,sent_at,metadata)
    values(account,'email','outbound',now()+interval '2 minutes','{"delivery_status":"delivered"}');
  if not exists(select 1 from tasks where id=reply_task and status='open') then raise exception 'Older send closed newer inbound'; end if;
  insert into communication_log(client_id,channel,direction,sent_at,metadata)
    values(account,'email','outbound',now()+interval '4 minutes','{"delivery_status":"accepted_by_provider","historical_import":true}');
  if not exists(select 1 from tasks where id=reply_task and status='open') then raise exception 'Historical import closed live work'; end if;
  receipt:=ingest_inbound_message('lead-reply:'||lead::text,null,lead,'sms',lead::text||'@example.invalid',
    'agency@example.invalid',null,'Please send my quote',now()+interval '5 minutes','lead-reply');
  perform alert_inbound_message((receipt->>'id')::uuid,false);
  select id into lead_task from tasks where related_type='lead' and related_id=lead and action_category='reply';
  if lead_task is null then raise exception 'Lead text did not create reply work'; end if;
  insert into communication_log(channel,direction,sent_at,metadata) values('email','outbound',now()+interval '6 minutes',
    jsonb_build_object('lead_id',lead,'delivery_status','accepted_by_provider'));
  if not exists(select 1 from tasks where id=lead_task and status='completed') then raise exception 'Lead email did not complete text reply task'; end if;
  if not exists(select 1 from tasks where id=reply_task and status='open') then raise exception 'Lead send completed other client reply work'; end if;
  if not exists(select 1 from tasks where id=unrelated and status='open') then raise exception 'Lead reply completed unrelated client work'; end if;
end;
$test$;
rollback;
