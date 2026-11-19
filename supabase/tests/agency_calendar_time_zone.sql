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
declare
  event_key uuid:='00000000-0000-4000-8000-000000000091';
  agency_zone text;
  expected_due timestamptz;
  saved_event public.events%rowtype;
begin
  select timezone into agency_zone from public.outreach_settings where id=1;
  if agency_zone is null then raise exception 'Agency time zone must be configured before this fixture'; end if;
  expected_due:=(date '2026-01-05' + time '09:00') at time zone agency_zone;

  perform public.save_calendar_event(event_key,
    jsonb_build_object('subject','Agency timezone fixture','event_date','2026-01-05','event_time','09:00','all_day',false),
    true,'timezone-fixture',pg_temp.fixture_owner());
  if not exists(select 1 from public.tasks where event_id=event_key and due_date=expected_due) then
    raise exception 'Calendar event task due instant did not use the agency time zone';
  end if;

  update public.tasks set due_date=expected_due+interval '1 hour' where event_id=event_key;
  select * into saved_event from public.events where id=event_key;
  if saved_event.event_date<>date '2026-01-05' or saved_event.event_time::time<>time '10:00' then
    raise exception 'Task reschedule did not preserve the agency-local appointment time';
  end if;
end;
$test$;
rollback;
