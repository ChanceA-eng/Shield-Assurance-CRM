begin;
create function pg_temp.fixture_owner() returns uuid language plpgsql as $f$
declare owner uuid;
begin
  select user_id into owner from public.agency_members where active order by created_at limit 1;
  if owner is null then
    owner:=gen_random_uuid();
    insert into auth.users(id,email,email_confirmed_at) values(owner,'calendar-fixture-'||owner||'@example.invalid',now());
    insert into public.agency_members(user_id,email,role) select id,email,'owner' from auth.users where id=owner;
  end if;
  return owner;
end $f$;

do $test$
<<fixture>>
declare
  first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); completed_id uuid:=gen_random_uuid();
  event_id uuid:=gen_random_uuid(); event_task uuid;
  first_version timestamptz; second_version timestamptz; requested jsonb; changed integer;
  original_due timestamptz:='2026-11-03T16:00:00-07:00'; new_due timestamptz:='2026-11-05T10:30:00-07:00';
begin
  insert into tasks(id,subject,due_date,status,priority) values
    (first_id,'Bulk fixture one',original_due,'open','high'),
    (second_id,'Bulk fixture two',original_due,'open','medium'),
    (completed_id,'Bulk fixture completed',original_due,'completed','low');
  select updated_at into first_version from tasks where id=first_id;
  select updated_at into second_version from tasks where id=second_id;
  requested:=jsonb_build_array(jsonb_build_object('id',first_id,'expected_updated_at',first_version),jsonb_build_object('id',second_id,'expected_updated_at',second_version));
  insert into notifications(task_id,reminder_version,type,message,read) select id,reminder_version,'reminder','Bulk fixture reminder',false from tasks where id=first_id;
  select count(*) into changed from bulk_reschedule_tasks(requested,new_due,'Bulk fixture actor');
  if changed<>2 or exists(select 1 from tasks where id in(first_id,second_id) and (due_date<>new_due or status<>'open' or updated_by<>'Bulk fixture actor')) then
    raise exception 'Bulk update failed to save all selected tasks'; end if;
  if (select priority from tasks where id=first_id)<>'high' or (select priority from tasks where id=second_id)<>'medium' then
    raise exception 'Bulk reschedule changed unrelated fields'; end if;
  if exists(select 1 from notifications where task_id=first_id and not read) or (select reminder_version from tasks where id=first_id)<>2 then
    raise exception 'Reminder invalidation did not follow existing task triggers'; end if;
  begin
    perform bulk_reschedule_tasks(requested,original_due,'Stale fixture');
    raise exception 'Stale task versions accepted';
  exception when sqlstate 'PT409' then null; end;
  select updated_at into first_version from tasks where id=first_id;
  select updated_at into second_version from tasks where id=second_id;
  update tasks set description='Concurrent edit' where id=second_id;
  requested:=jsonb_build_array(jsonb_build_object('id',first_id,'expected_updated_at',first_version),jsonb_build_object('id',second_id,'expected_updated_at',second_version));
  begin
    perform bulk_reschedule_tasks(requested,original_due,'Atomic failure fixture');
    raise exception 'Concurrent edit accepted';
  exception when sqlstate 'PT409' then null; end;
  if (select due_date from tasks where id=first_id)<>new_due then raise exception 'Conflict partially rescheduled the first task'; end if;
  begin
    perform bulk_reschedule_tasks(jsonb_build_array(jsonb_build_object('id',completed_id,'expected_updated_at',updated_at)),new_due,'Completed fixture')
      from tasks where id=completed_id;
    raise exception 'Completed task rescheduled';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform bulk_reschedule_tasks(jsonb_build_array(jsonb_build_object('id',first_id,'expected_updated_at',first_version),jsonb_build_object('id',first_id,'expected_updated_at',first_version)),new_due,'Duplicate fixture');
    raise exception 'Duplicate selected IDs accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform bulk_reschedule_tasks('[]',new_due,'Empty fixture'); raise exception 'Empty selection accepted';
  exception when invalid_parameter_value then null; end;
  perform save_calendar_event(event_id,jsonb_build_object('title','Bulk linked appointment','event_date','2026-11-03','event_time','16:00'),true,'Bulk fixture',pg_temp.fixture_owner());
  select id into event_task from tasks where tasks.event_id=fixture.event_id;
  perform bulk_reschedule_tasks(jsonb_build_array(jsonb_build_object('id',id,'expected_updated_at',updated_at)),new_due,'Bulk calendar fixture') from tasks where id=event_task;
  if not exists(select 1 from events where id=fixture.event_id and event_date='2026-11-05' and event_time='10:30') then
    raise exception 'Bulk reschedule did not synchronize the linked appointment in Arizona'; end if;
  if has_function_privilege('authenticated','public.bulk_reschedule_tasks(jsonb,timestamptz,text)','EXECUTE') or
    has_function_privilege('anon','public.bulk_reschedule_tasks(jsonb,timestamptz,text)','EXECUTE') then
    raise exception 'Bulk mutation bypasses authenticated API'; end if;
  begin
    perform bulk_reschedule_tasks(jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'expected_updated_at',first_version)),new_due,'Missing fixture');
    raise exception 'Missing task accepted';
  exception when sqlstate 'PT409' then null; end;
  with inserted as (
    insert into tasks(subject,due_date,status,priority)
      select 'Bulk maximum fixture',original_due,'open','medium' from generate_series(1,200)
      returning id,updated_at
  ) select jsonb_agg(jsonb_build_object('id',id,'expected_updated_at',updated_at)) into requested from inserted;
  begin
    perform bulk_reschedule_tasks(requested||jsonb_build_array(jsonb_build_object('id',first_id,'expected_updated_at',first_version)),new_due,'Over maximum fixture');
    raise exception '201 tasks accepted';
  exception when invalid_parameter_value then null; end;
  select count(*) into changed from bulk_reschedule_tasks(requested,new_due,'Maximum fixture');
  if changed<>200 then raise exception 'The exact 200 task limit failed'; end if;
end;
$test$;
rollback;
