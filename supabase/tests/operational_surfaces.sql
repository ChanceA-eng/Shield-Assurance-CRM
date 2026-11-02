begin;
do $test$
declare
  account uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); message uuid:=gen_random_uuid();
  claim uuid:=gen_random_uuid(); policy uuid:=gen_random_uuid(); work text; state jsonb; version timestamptz;
  summary jsonb;
begin
  insert into clients(id,full_name) values(account,'Operational fixture');
  insert into leads(id,full_name,account_id) values(lead,'Linked operational lead',account);
  insert into communication_log(id,channel,direction,sent_at,metadata)
    values(message,'email','inbound',now(),jsonb_build_object('lead_id',lead));
  if not exists(select 1 from canonical_communications where id=message and conversation_key='client:'||account::text)
    then raise exception 'Linked lead conversation omitted from account'; end if;
  summary:=public.unread_message_summary();
  if (summary#>>array['byClient',account::text])::integer<>1 or (summary#>>array['byLead',lead::text])::integer<>1
    then raise exception 'Canonical unread counts do not reconcile'; end if;
  if not exists(select 1 from conversation_inbox where key='client:'||account::text and total=1 and unread=1)
    then raise exception 'Inbox counters differ from canonical thread'; end if;
  work:='message:client:'||account::text;
  state:=public.update_workday_source(work,null,'{"assignee":"Fixture agent"}');
  version:=(state->>'updated_at')::timestamptz;
  if not exists(select 1 from agent_workday where id=work and assignee='Fixture agent') then raise exception 'Source-only ownership not persisted'; end if;
  perform public.update_workday_source(work,version,jsonb_build_object('due_date',now()+interval '10 days'));
  if not exists(select 1 from agent_workday where id=work and not actionable and timing='upcoming' and urgency=5)
    then raise exception 'Source-only snooze did not defer work'; end if;
  begin
    perform public.update_workday_source(work,version,'{"assignee":"Stale agent"}');
    raise exception 'Expected stale version failure';
  exception when serialization_failure then null;
  end;
  update communication_log set read_at=now() where id=message;
  if exists(select 1 from conversation_inbox where key='client:'||account::text and unread<>0) then raise exception 'Read count not reconciled'; end if;
  if not exists(select 1 from agent_workday where id=work) then raise exception 'Reading incorrectly resolved work'; end if;
  insert into policies(id,client_id,insured_name,carrier,line_of_business,premium,effective_date,renewal_date)
    values(policy,account,'Operational fixture','Test','Auto',100,current_date,current_date+365);
  insert into claims(id,client_id,policy_id,type,date_of_loss) values(claim,account,policy,'Fixture claim',current_date);
  if not exists(select 1 from tasks where related_type='claim' and related_id=claim
      and action_href like '%context_type=claim&context_id='||claim::text)
    then raise exception 'Service work lacks exact context'; end if;
  insert into automation_runs(job,status) values('operational-fixture','running');
  begin
    insert into automation_runs(job,status) values('operational-fixture','running');
    raise exception 'Expected overlapping job exclusion';
  exception when unique_violation then null;
  end;
  if has_table_privilege('authenticated','public.canonical_communications','SELECT')
    or has_function_privilege('authenticated','public.unread_message_summary()','EXECUTE')
    then raise exception 'Operational data must remain service-role-only'; end if;
end;
$test$;
rollback;
