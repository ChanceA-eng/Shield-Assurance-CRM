begin;
do $test$
declare
  owner uuid:=gen_random_uuid(); event_key uuid:=gen_random_uuid(); claimed jsonb;
  lock_key uuid:=gen_random_uuid(); task_status text; saved jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values(owner,'zoom-fixture-'||owner||'@example.invalid',now());
  insert into public.agency_members(user_id,email,role) select id,email,'owner' from auth.users where id=owner;
  perform public.connect_zoom(owner,'zoom@example.invalid','zoom-user','encrypted-refresh','encrypted-access',now()+interval '1 hour');
  saved:=public.save_calendar_event(event_key,jsonb_build_object('subject','Zoom fixture','event_date','2035-02-01',
    'event_time','10:00','meeting_type','zoom'),true,'Zoom fixture',owner);
  if saved->>'sync_status'<>'pending' then raise exception 'Zoom appointments must require meeting sync'; end if;
  claimed:=public.claim_appointment_sync(event_key,owner,lock_key);
  if claimed->>'google_event_id' is not null or claimed->>'zoom_subject'<>'zoom-user' then
    raise exception 'Zoom-only appointments must not require a Google identity'; end if;
  begin
    perform public.disconnect_zoom(owner);
    raise exception 'Disconnect must not race an appointment sync';
  exception when sqlstate 'PT409' then null;
  end;
  update public.events set zoom_meeting_id='12345678901',zoom_join_url='https://zoom.us/j/12345678901',
    sync_status='synced',sync_lock=null,sync_lease_until=null where id=event_key;
  begin
    perform public.connect_zoom(owner,'different@example.invalid','different-user','refresh','access',now()+interval '1 hour');
    raise exception 'Must not change the provider account owning a meeting';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.claim_zoom_refresh(owner,lock_key);
  begin
    perform public.claim_zoom_refresh(owner,gen_random_uuid());
    raise exception 'Concurrent refresh must be rejected';
  exception when sqlstate 'PT409' then null;
  end;
  update public.zoom_credentials set refresh_lock=null,refresh_lease_until=null where user_id=owner;
  saved:=public.save_calendar_event(event_key,jsonb_build_object('event_time','11:00','expected_revision',0),false,'Zoom fixture',owner);
  if saved->>'revision'<>'1' or saved->>'sync_status'<>'pending' or saved->>'zoom_meeting_id'<>'12345678901' then
    raise exception 'Reschedule must preserve Zoom identity and require sync'; end if;
  saved:=public.save_calendar_event(event_key,jsonb_build_object('status','cancelled','expected_revision',1),false,'Zoom fixture',owner);
  select status into task_status from public.tasks where event_id=event_key limit 1;
  if saved->>'status'<>'cancelled' or saved->>'sync_status'<>'pending' or task_status<>'cancelled' then
    raise exception 'Cancellation must retain history, stop reminders and require remote sync'; end if;
  begin
    perform public.save_calendar_event(gen_random_uuid(),jsonb_build_object('subject','Invalid Zoom','event_date','2035-02-02',
      'all_day',true,'meeting_type','zoom'),true,'Zoom fixture',owner);
    raise exception 'All-day Zoom appointments must not be accepted';
  exception when invalid_parameter_value then null;
  end;
  if has_table_privilege('authenticated','public.zoom_credentials','select')
    or has_function_privilege('authenticated','public.claim_zoom_refresh(uuid,uuid)','execute')
    or has_function_privilege('anon','public.connect_zoom(uuid,text,text,text,text,timestamptz)','execute') then
    raise exception 'Zoom secrets and privileged RPCs must not be exposed';
  end if;
  perform public.disconnect_zoom(owner);
  if exists(select 1 from public.zoom_credentials where user_id=owner) then raise exception 'Disconnect must delete local tokens'; end if;
end $test$;
rollback;
