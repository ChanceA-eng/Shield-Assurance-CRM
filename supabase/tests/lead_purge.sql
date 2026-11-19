begin;
do $test$
declare
  l uuid:=gen_random_uuid(); linked uuid:=gen_random_uuid(); active uuid:=gen_random_uuid(); account uuid:=gen_random_uuid();
  task uuid:=gen_random_uuid(); shared_note uuid:=gen_random_uuid(); result jsonb;
begin
  insert into leads(id,full_name,email,status) values
    (l,'Purge QA','purge-qa@example.invalid','new'),
    (active,'Purge QA active','purge-active@example.invalid','new');
  insert into clients(id,full_name) values(account,'Purge QA account');
  insert into leads(id,full_name,status,account_id) values(linked,'Purge QA linked','new',account);
  insert into tasks(id,subject,due_date,status,related_type,related_id) values(task,'Call Purge QA',now()+interval '1 day','open','lead',l);
  insert into notifications(type,message,task_id,read) values('task_due','Purge QA due',task,false);
  insert into events(subject,title,event_date,related_type,related_id) values('Purge QA','Purge QA',current_date,'lead',l);
  insert into interactions(lead_id,content) values(l,'Lead-only note');
  insert into client_assets(lead_id,title,asset_type) values(l,'Lead-only file','document');
  insert into sequence_enrollments(lead_id,status,total_steps) values(l,'active',3);
  insert into outreach_outbox(lead_id,step_number,to_email,subject,body,cited_signals) values(l,1,'purge-qa@example.invalid','Hi','Body','["Recorded fact"]');
  insert into communication_log(direction,channel,subject,body,metadata) values('outbound','email','Purge QA','Body',jsonb_build_object('lead_id',l));
  insert into interactions(id,lead_id,client_id,content) values(shared_note,linked,account,'Account note');

  begin perform purge_leads(array[active],'Purge QA actor');
  exception when others then raise exception 'Unarchived lead check errored: %',sqlerrm; end;
  if purge_leads(array[active],'Purge QA actor')->0->>'outcome'<>'not_archived' or not exists(select 1 from leads where id=active) then
    raise exception 'Active lead was deleted'; end if;

  perform archive_leads(array[l,linked],'Purge QA actor');
  result:=purge_leads(array[l,linked],'Purge QA actor');
  if (select count(*) from jsonb_array_elements(result) r where r->>'outcome'='deleted')<>2 then raise exception 'Purge summary wrong: %',result; end if;
  if exists(select 1 from leads where id in (l,linked)) then raise exception 'Leads not deleted'; end if;
  if exists(select 1 from tasks where id=task) or exists(select 1 from notifications where task_id=task)
    or exists(select 1 from events where related_type='lead' and related_id=l) then raise exception 'Tasks, alerts or events left behind'; end if;
  if exists(select 1 from interactions where content='Lead-only note') or exists(select 1 from client_assets where title='Lead-only file') then raise exception 'Lead notes or files left behind'; end if;
  if exists(select 1 from sequence_enrollments where lead_id=l) or exists(select 1 from outreach_outbox where lead_id=l)
    or exists(select 1 from lead_intake_events where lead_id=l) then raise exception 'Automation left behind'; end if;
  if exists(select 1 from communication_log where metadata->>'lead_id'=l::text) then raise exception 'Lead messages left behind'; end if;
  if exists(select 1 from client_activities where lead_id=l or (client_id is null and metadata::text like '%'||l::text||'%')) then raise exception 'Lead history left behind'; end if;
  if not exists(select 1 from interactions where id=shared_note and client_id=account and lead_id is null) then raise exception 'Account note was not kept'; end if;
  if not exists(select 1 from clients where id=account) then raise exception 'Account was deleted'; end if;
  if has_function_privilege('authenticated','public.purge_leads(uuid[],text)','execute') then raise exception 'Purge RPC exposed'; end if;
end;
$test$;
rollback;
