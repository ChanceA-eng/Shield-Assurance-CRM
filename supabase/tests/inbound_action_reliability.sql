begin;
do $test$
declare
  account uuid:=gen_random_uuid();
  first_message uuid:=gen_random_uuid();
  second_message uuid:=gen_random_uuid();
  third_message uuid:=gen_random_uuid();
begin
  insert into clients(id,full_name) values(account,'Inbound fixture');
  insert into communication_log(id,client_id,channel,direction,subject,body,sent_at,metadata)
    values(first_message,account,'email','inbound','Question','Call me',now(),'{}'),
      (second_message,account,'sms','inbound',null,'Another question',now(),'{}');
  perform alert_inbound_message(first_message,false);
  perform alert_inbound_message(first_message,false);
  perform alert_inbound_message(second_message,false);
  if (select count(*) from tasks where inbound_reply_key='client:'||account::text and status='open')<>1 then raise exception 'Duplicate reply work'; end if;
  if (select count(*) from notifications where message_log_id in(first_message,second_message))<>2 then raise exception 'Lost or duplicate message notification'; end if;
  update tasks set status='completed' where inbound_reply_key='client:'||account::text;
  perform alert_inbound_message(second_message,false);
  if exists(select 1 from tasks where inbound_reply_key='client:'||account::text and status='open') then raise exception 'Retry reopened completed message work'; end if;
  insert into communication_log(id,client_id,channel,direction,subject,body,sent_at,metadata)
    values(third_message,account,'email','inbound','New question','Call again',now()+interval '1 minute','{}');
  perform alert_inbound_message(third_message,false);
  if (select count(*) from tasks where inbound_reply_key='client:'||account::text and status='open')<>1 then raise exception 'New reply work not created after completion'; end if;
end;
$test$;
create function public.inbound_test_task_failure() returns trigger language plpgsql as $$
begin
  if new.subject like 'Reply to Rollback fixture%' then raise exception 'Forced reply task failure'; end if;
  return new;
end;
$$;
create trigger inbound_test_task_failure before insert on public.tasks for each row execute function public.inbound_test_task_failure();
do $test$
declare
  account uuid:=gen_random_uuid();
  log_id uuid:=gen_random_uuid();
begin
  insert into clients(id,full_name) values(account,'Rollback fixture');
  insert into communication_log(id,client_id,channel,direction,sent_at,metadata) values(log_id,account,'email','inbound',now(),'{}');
  begin
    perform alert_inbound_message(log_id,false);
    raise exception 'Task failure was swallowed';
  exception when raise_exception then
    if sqlerrm<>'Forced reply task failure' then raise; end if;
  end;
  if exists(select 1 from notifications where message_log_id=log_id) then raise exception 'Partial notification survived failed task'; end if;
end;
$test$;
rollback;
