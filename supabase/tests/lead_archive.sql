begin;
do $test$
declare
  l uuid:=gen_random_uuid(); untouched uuid:=gen_random_uuid(); edited uuid:=gen_random_uuid();
  enrollment uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); result jsonb;
begin
  insert into leads(id,full_name,email,status) values(l,'Archive QA','archive-qa@example.invalid','new');
  insert into tasks(id,subject,due_date,status,related_type,related_id) values
    (untouched,'Call Archive QA',now()+interval '1 day','open','lead',l),
    (edited,'Email Archive QA',now()+interval '1 day','open','lead',l);
  insert into notifications(type,message,task_id,read) values('task_due','Archive QA due soon',untouched,false);
  insert into sequence_enrollments(id,lead_id,status,total_steps) values(enrollment,l,'active',3);
  insert into outreach_outbox(id,lead_id,step_number,to_email,subject,body,cited_signals)
    values(draft,l,1,'archive-qa@example.invalid','Hello','Body','["Recorded fact"]');

  result:=archive_leads(array[l,l],'Archive QA actor','Not a fit');
  if jsonb_array_length(result)<>1 or result->0->>'outcome'<>'archived' or (result->0->>'tasks_closed')::int<>2
    or (result->0->>'sequences_paused')::int<>1 or (result->0->>'drafts_rejected')::int<>1 then
    raise exception 'Archive summary was wrong: %',result; end if;
  if not exists(select 1 from leads where id=l and archived_at is not null and archive_reason='Not a fit') then raise exception 'Lead not archived'; end if;
  if exists(select 1 from tasks where related_id=l and status='open') then raise exception 'Archived lead kept open tasks'; end if;
  if exists(select 1 from notifications where task_id=untouched and read=false) then raise exception 'Archived lead kept alerts'; end if;
  if not exists(select 1 from sequence_enrollments where id=enrollment and status='paused' and ended_reason='lead_archived') then raise exception 'Sequence kept running'; end if;
  if not exists(select 1 from outreach_outbox where id=draft and status='rejected') then raise exception 'Draft stayed in approval'; end if;
  if get_actionable_leads_count()<>(select count(*) from leads where status in ('new','contacted') and archived_at is null
    and (last_viewed_at is null or coalesce(last_activity_at,created_at)>last_viewed_at or last_viewed_at<=now()-interval '24 hours')) then
    raise exception 'Archived lead counted as actionable'; end if;
  perform ensure_default_followups();
  if exists(select 1 from tasks where related_id=l and status='open') then raise exception 'Follow-up created for archived lead'; end if;
  if archive_leads(array[l],'Archive QA actor')->0->>'outcome'<>'already_archived' then raise exception 'Archive was not idempotent'; end if;

  update tasks set subject='Email Archive QA (handled)' where id=edited;
  result:=restore_leads(array[l],'Archive QA actor');
  if result->0->>'outcome'<>'restored' or (result->0->>'tasks_reopened')::int<>1 then raise exception 'Restore summary was wrong: %',result; end if;
  if not exists(select 1 from tasks where id=untouched and status='open') then raise exception 'Archived task was not reopened'; end if;
  if not exists(select 1 from tasks where id=edited and status='completed') then raise exception 'Edited task was reopened'; end if;
  if not exists(select 1 from sequence_enrollments where id=enrollment and status='paused') then raise exception 'Restore restarted outreach'; end if;
  if exists(select 1 from leads where id=l and (archived_at is not null or archive_effects is not null)) then raise exception 'Lead not restored'; end if;
  if restore_leads(array[l],'Archive QA actor')->0->>'outcome'<>'not_archived' then raise exception 'Restore was not idempotent'; end if;

  begin perform archive_leads(array[]::uuid[],'Archive QA actor'); raise exception 'Empty archive accepted';
  exception when sqlstate '22023' then null; end;
  if has_function_privilege('authenticated','public.archive_leads(uuid[],text,text)','execute')
    or has_function_privilege('anon','public.restore_leads(uuid[],text)','execute') then raise exception 'Archive RPC exposed'; end if;
end;
$test$;
rollback;
