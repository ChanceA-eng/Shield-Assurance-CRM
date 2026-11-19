begin;
do $test$
declare
  lead_id uuid:=gen_random_uuid(); other_lead uuid:=gen_random_uuid();
  open_task uuid:=gen_random_uuid(); closed_task uuid:=gen_random_uuid();
  other_task uuid:=gen_random_uuid();
begin
  insert into public.leads(id,full_name,status) values
    (lead_id,'Deleted lead task QA','new'),(other_lead,'Unchanged lead task QA','new');
  insert into public.tasks(id,subject,status,related_type,related_id) values
    (open_task,'Deleted lead open task','open','lead',lead_id),
    (closed_task,'Deleted lead closed task','completed','lead',lead_id),
    (other_task,'Unchanged lead task','open','lead',other_lead);
  insert into public.notifications(type,message,task_id,read)
    values('task_due','Deleted lead task alert',open_task,false);
  perform public.archive_leads(array[lead_id],'Task cleanup QA');
  if exists(select 1 from public.tasks where related_id=lead_id and status='open') then
    raise exception 'Archive left an open task'; end if;
  perform public.restore_leads(array[lead_id],'Task cleanup QA');
  if not exists(select 1 from public.tasks where id=open_task and status='open') then
    raise exception 'Restore did not preserve the task lifecycle'; end if;

  delete from public.leads where id=lead_id;
  if exists(select 1 from public.tasks where id in (open_task,closed_task)) then
    raise exception 'Deleting a lead left orphaned tasks'; end if;
  if exists(select 1 from public.notifications where task_id=open_task) then
    raise exception 'Deleting a lead left task alerts'; end if;
  if not exists(select 1 from public.tasks where id=other_task and status='open') then
    raise exception 'Deleting a lead changed unrelated work'; end if;
end;
$test$;
rollback;
