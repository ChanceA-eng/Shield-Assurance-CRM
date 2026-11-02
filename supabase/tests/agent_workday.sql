begin;
do $test$
declare
  account uuid:=gen_random_uuid();
  lead uuid:=gen_random_uuid();
  intake uuid:=gen_random_uuid();
  task uuid:=gen_random_uuid();
  message uuid:=gen_random_uuid();
  reply_task uuid:=gen_random_uuid();
begin
  insert into clients(id,full_name) values(account,'Workday fixture account');
  insert into leads(id,full_name,account_id) values(lead,'Workday fixture lead',account);
  insert into lead_intake_events(id,lead_id,submission_key,time_basis,snapshot,submitted_at,received_at,opened_at,dismissed_at)
    values(intake,lead,'test:'||intake::text,'received','{}',now()-interval '1 day',now()-interval '1 day',now(),now());
  if not exists(select 1 from agent_workday where id='intake:'||intake::text) then raise exception 'Opening/dismissing lost unresolved website request'; end if;
  insert into tasks(id,subject,status,related_type,related_id,intake_event_id,due_date,assignee)
    values(task,'Respond to website request','open','lead',lead,intake,now()-interval '1 hour','Test agent');
  if (select count(*) from agent_workday where source_id in (intake,task)) <> 1 then raise exception 'Task and intake duplicated'; end if;
  if not exists(select 1 from agent_workday where task_id=task and assignee='Test agent' and timing='overdue' and actionable) then raise exception 'Owner or urgency lost'; end if;
  update tasks set status='completed' where id=task;
  if exists(select 1 from agent_workday where source_id in (intake,task)) then raise exception 'Completed work reappeared'; end if;
  update tasks set status='open' where id=task;
  if not exists(select 1 from agent_workday where task_id=task) then raise exception 'Reopened work missing'; end if;
  insert into communication_log(id,client_id,channel,direction,subject,body,sent_at,read_at,metadata)
    values(message,account,'email','inbound','Question','Please call',now(),now(),'{}');
  insert into tasks(subject,status,related_type,related_id,assignee)
    values('Reply to Workday fixture account','open','client',account,'Reply agent') returning id into reply_task;
  if (select count(*) from agent_workday where kind='reply' and source_id=message)<>1 then raise exception 'Read inbound reply not actionable'; end if;
  if exists(select 1 from agent_workday where kind='task' and subject='Reply to Workday fixture account') then raise exception 'Conversation and reply task duplicated'; end if;
  update tasks set due_date=now()+interval '10 days' where id=reply_task;
  if not exists(select 1 from agent_workday where source_id=message and task_id=reply_task and assignee='Reply agent'
    and timing='upcoming' and not actionable and urgency=5) then raise exception 'Snoozed reply still urgent or lost owner'; end if;
  update tasks set status='completed' where id=reply_task;
  if not exists(select 1 from agent_workday where source_id=message and task_id is null and actionable) then
    raise exception 'Completing follow-up falsely answered the conversation'; end if;
  insert into communication_log(client_id,channel,direction,subject,body,sent_at,metadata)
    values(account,'email','outbound','Re: Question','Answered',now()+interval '1 second','{"status":"failed"}');
  if not exists(select 1 from agent_workday where source_id=message) then raise exception 'Failed outbound falsely answered message'; end if;
  insert into communication_log(client_id,channel,direction,subject,body,sent_at,metadata)
    values(account,'email','outbound','Re: Question','Answered',now()+interval '2 seconds','{"status":"accepted_by_provider"}');
  if exists(select 1 from agent_workday where source_id=message) then raise exception 'Answered conversation remains unanswered'; end if;
  insert into communication_log(channel,direction,sent_at,metadata) values
    ('email','inbound',now(), '{"from":"Example Sender <PERSON@example.invalid>","to":"agency@example.invalid"}'),
    ('email','outbound',now()+interval '1 second','{"from":"agency@example.invalid","to":"person@example.invalid"}'),
    ('sms','inbound',now(),'{"from":"+1 (555) 222-3333","to":"+15559998888"}'),
    ('sms','outbound',now()+interval '1 second','{"from":"+15559998888","to":"555-222-3333"}');
  if exists(select 1 from agent_workday where id in ('message:unmatched:person@example.invalid','message:unmatched:5552223333')) then
    raise exception 'Normalized unmatched reply left a false unanswered conversation'; end if;
  if public.crm_normalize_address('bad sender')<>'' or public.crm_normalize_address('Example <PERSON@example.invalid>')<>'person@example.invalid'
    or public.crm_normalize_address('+1 (555) 222-3333')<>'5552223333' then raise exception 'Address normalization differs from conversation identity'; end if;
  insert into tasks(subject,status,due_date) values('Future task','open',now()+interval '10 days');
  if not exists(select 1 from agent_workday where subject='Future task' and timing='upcoming' and not actionable) then raise exception 'Upcoming task counted as urgent'; end if;
  insert into policies(id,client_id,insured_name,carrier,line_of_business,premium,effective_date,renewal_date)
    values(gen_random_uuid(),account,'Workday fixture account','Test carrier','Auto',100,current_date,current_date+365);
  insert into claims(policy_id,client_id,type,status,date_of_loss) select id,account,'Collision','open',current_date from policies where client_id=account;
  if not exists(select 1 from agent_workday where kind='service' and name='Workday fixture account') then raise exception 'Open claim without a task disappeared'; end if;
end;
$test$;
rollback;
