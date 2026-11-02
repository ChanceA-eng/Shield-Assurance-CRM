-- Run on a disposable database after the calendar migration, never on customer data.
begin;
do $test$
declare
  account uuid := gen_random_uuid();
  lead uuid := gen_random_uuid();
  event uuid := gen_random_uuid();
  saved jsonb;
  due timestamptz;
  version text;
begin
  insert into public.clients(id,full_name) values(account,'Calendar test account');
  insert into public.leads(id,full_name,account_id) values(lead,'Calendar test lead',account);
  saved := public.save_calendar_event(event,jsonb_build_object('subject','Test call','event_date','2026-11-02','event_time','14:15','all_day',false,'related_type','lead','related_id',lead),true,'QA');
  select due_date into due from public.tasks where event_id=event;
  if due <> '2026-11-02T21:15:00Z'::timestamptz then raise exception 'Incorrect Arizona task time: %',due; end if;
  if (select count(*) from public.tasks where event_id=event and account_id=account) <> 1 then raise exception 'Missing canonical account task'; end if;
  if (select count(*) from public.notifications where href='/scheduler?event='||event::text) <> 1 then raise exception 'Missing appointment notification'; end if;
  version := saved->>'updated_at';
  perform public.save_calendar_event(event,jsonb_build_object('event_date','2026-11-03','event_time','10:30','expected_updated_at',version),false,'QA');
  select due_date into due from public.tasks where event_id=event;
  if due <> '2026-11-03T17:30:00Z'::timestamptz then raise exception 'Task not rescheduled'; end if;
  begin
    perform public.save_calendar_event(event,jsonb_build_object('status','completed','expected_updated_at',version),false,'QA');
    raise exception 'Stale write was accepted';
  exception when unique_violation then null;
  end;
  perform public.save_calendar_event(event,'{"status":"completed"}',false,'QA');
  if (select status from public.tasks where event_id=event) <> 'completed' then raise exception 'Completion not synced'; end if;
  update public.tasks set status='open' where event_id=event;
  if (select status from public.events where id=event) <> 'scheduled' then raise exception 'Reopen not synced'; end if;
  update public.tasks set due_date='2026-11-04T20:00:00Z' where event_id=event;
  if (select event_date from public.events where id=event) <> '2026-11-04'::date or
     (select event_time from public.events where id=event) <> '13:00' then raise exception 'Task snooze not synced to Arizona appointment'; end if;
  perform public.save_calendar_event(event,'{"all_day":true}',false,'QA');
  if not (select all_day from public.events where id=event) then raise exception 'All-day event unexpectedly converted'; end if;
  select due_date into due from public.tasks where event_id=event;
  if due <> '2026-11-04T16:00:00Z'::timestamptz then raise exception 'All-day task not due 9 AM Arizona'; end if;
  begin
    perform public.save_calendar_event(gen_random_uuid(),'{"subject":"Invalid","event_date":"2026-11-02","event_time":"25:00"}',true,'QA');
    raise exception 'Invalid time was accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.events where subject='Invalid') <> 0 then raise exception 'Invalid save did not roll back'; end if;
  begin
    perform public.save_calendar_event(event,'{"subject":"Duplicate"}',true,'QA');
    raise exception 'Duplicate save was accepted';
  exception when unique_violation then null;
  end;
end;
$test$;
create function public.calendar_test_notification_failure()
returns trigger language plpgsql as $$
begin
  if new.type='appointment' then raise exception 'Test notification persistence failure'; end if;
  return new;
end;
$$;
create trigger calendar_test_notification_failure before insert on public.notifications
  for each row execute function public.calendar_test_notification_failure();
do $test$
declare
  event uuid := gen_random_uuid();
begin
  begin
    perform public.save_calendar_event(event,'{"subject":"Rollback call","event_date":"2026-11-02","event_time":"14:15"}',true,'QA');
    raise exception 'Notification failure was swallowed';
  exception when raise_exception then
    if sqlerrm <> 'Test notification persistence failure' then raise; end if;
  end;
  if exists(select 1 from public.events where id=event) or exists(select 1 from public.tasks where event_id=event) then
    raise exception 'Notification failure left a partially saved appointment or task';
  end if;
end;
$test$;
rollback;
