begin;

create table public.google_calendar_connections (
  user_id uuid primary key references public.agency_members(user_id),
  email text not null,
  google_subject text not null,
  status text not null default 'connected' check(status in ('connected','reconnect','disconnected')),
  last_error text,
  connected_at timestamptz not null default now()
);
create table public.google_calendar_credentials (
  user_id uuid primary key references public.google_calendar_connections(user_id) on delete cascade,
  refresh_secret text not null, access_secret text, access_expires_at timestamptz
);
create table public.google_calendar_oauth_states (
  state_hash text primary key, user_id uuid not null references public.agency_members(user_id),
  browser_hash text not null, verifier_secret text not null, expires_at timestamptz not null
);

alter table public.events
  add column user_id uuid references public.agency_members(user_id),
  add column meeting_type text not null default 'phone' check(meeting_type in ('phone','in_person','google_meet')),
  add column duration_minutes integer not null default 30 check(duration_minutes between 15 and 120),
  add column location text,
  add column calendar_sync boolean not null default false,
  add column google_event_id text,
  add column google_event_url text,
  add column google_meet_url text,
  add column google_calendar_subject text,
  add column sync_status text not null default 'not_required' check(sync_status in ('not_required','pending','synced','failed')),
  add column sync_error text,
  add column sync_lock uuid,
  add column sync_lease_until timestamptz,
  add column revision integer not null default 0,
  add column time_zone text;

update public.events e set user_id=coalesce(
  (select l.agent_user_id from public.leads l where e.related_type='lead' and l.id=e.related_id),
  (select c.agent_user_id from public.clients c where c.id=coalesce(case when e.related_type='client' then e.related_id end,e.client_id)),
  (select m.user_id from public.agency_members m where m.active and m.role='owner' order by m.created_at,m.user_id limit 1)
), time_zone=(select timezone from public.outreach_settings where id=1);
create index events_owner_window on public.events(user_id,event_date) where status='scheduled';
create unique index events_google_identity on public.events(user_id,google_event_id) where google_event_id is not null;

create table public.appointment_revisions (
  event_id uuid not null references public.events(id) on delete cascade, revision integer not null,
  snapshot jsonb not null, created_at timestamptz not null default now(), primary key(event_id,revision)
);
create table public.appointment_manage_tokens (
  event_id uuid primary key references public.events(id) on delete cascade, token_hash text not null unique,
  token_secret text not null, expires_at timestamptz not null
);
create table public.appointment_notifications (
  event_id uuid not null references public.events(id) on delete cascade, revision integer not null,
  kind text not null check(kind in ('confirmation','rescheduled','cancelled')),
  attempt_id uuid not null unique,
  status text not null default 'pending' check(status in ('pending','sent','failed')),
  last_error text, communication_id uuid, updated_at timestamptz not null default now(),
  primary key(event_id,revision,kind)
);
do $$
declare t text;
begin
  foreach t in array array['google_calendar_connections','google_calendar_credentials','google_calendar_oauth_states',
    'appointment_revisions','appointment_manage_tokens','appointment_notifications'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.connect_google_calendar(p_user uuid,p_email text,p_subject text,p_refresh text,p_access text,p_expires timestamptz)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
  if not exists(select 1 from agency_members where user_id=p_user and active) then
    raise exception 'Active agency membership is required.' using errcode='42501';
  end if;
  if exists(select 1 from events where user_id=p_user and sync_lease_until>now()) then
    raise exception 'Calendar is syncing. Retry shortly.' using errcode='PT409';
  end if;
  if exists(select 1 from events where user_id=p_user and google_event_id is not null and google_calendar_subject is not null
    and google_calendar_subject is distinct from p_subject) then
    raise exception 'Reconnect the same Google account that owns your existing appointments.' using errcode='PT409';
  end if;
  insert into google_calendar_connections(user_id,email,google_subject,status)
    values(p_user,lower(p_email),p_subject,'connected')
    on conflict(user_id) do update set email=excluded.email,google_subject=excluded.google_subject,status='connected',last_error=null,connected_at=now();
  insert into google_calendar_credentials(user_id,refresh_secret,access_secret,access_expires_at)
    values(p_user,p_refresh,p_access,p_expires)
    on conflict(user_id) do update set refresh_secret=excluded.refresh_secret,access_secret=excluded.access_secret,access_expires_at=excluded.access_expires_at;
end $$;
create function public.disconnect_google_calendar(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
  if exists(select 1 from events where user_id=p_user and sync_lease_until>now()) then
    raise exception 'Calendar is syncing. Retry shortly.' using errcode='PT409';
  end if;
  delete from google_calendar_credentials where user_id=p_user;
  delete from google_calendar_oauth_states where user_id=p_user;
  update google_calendar_connections set status='disconnected',last_error=null where user_id=p_user;
end $$;

create function public.appointment_revision_stamp() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then
    new.revision:=0;
  elsif row(new.subject,new.description,new.event_date,new.event_time,new.all_day,new.status,new.meeting_type,new.duration_minutes,new.location,new.calendar_sync,new.related_type,new.related_id,new.client_id,new.time_zone)
    is not distinct from row(old.subject,old.description,old.event_date,old.event_time,old.all_day,old.status,old.meeting_type,old.duration_minutes,old.location,old.calendar_sync,old.related_type,old.related_id,old.client_id,old.time_zone) then
    new.revision:=old.revision;
    return new;
  else
    if old.sync_lease_until>now() then raise exception 'Calendar is updating. Retry shortly.' using errcode='PT409'; end if;
    new.revision:=old.revision+1;
  end if;
  if new.status='scheduled' and not new.all_day and new.event_time is not null and new.time_zone is not null and new.user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||new.user_id::text,0));
    if exists(select 1 from events e where e.user_id=new.user_id and e.id<>new.id and e.status='scheduled' and not e.all_day
      and tstzrange((e.event_date+e.event_time::time) at time zone e.time_zone,
        ((e.event_date+e.event_time::time) at time zone e.time_zone)+make_interval(mins=>e.duration_minutes),'[)')
        && tstzrange((new.event_date+new.event_time::time) at time zone new.time_zone,
          ((new.event_date+new.event_time::time) at time zone new.time_zone)+make_interval(mins=>new.duration_minutes),'[)')) then
      raise exception 'This time conflicts with another appointment. Choose another time.' using errcode='PT409';
    end if;
  end if;
  new.sync_status:=case when new.meeting_type='google_meet' or new.calendar_sync or new.google_event_id is not null then 'pending' else 'not_required' end;
  new.sync_error:=null;
  return new;
end $$;
create trigger appointment_revision_stamp before insert or update on public.events for each row execute function public.appointment_revision_stamp();
create function public.appointment_revision_history() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' or new.revision is distinct from old.revision then
    insert into appointment_revisions(event_id,revision,snapshot)
      values(new.id,new.revision,to_jsonb(new)-'sync_lock'-'sync_lease_until');
  end if;
  return null;
end $$;
create trigger appointment_revision_history after insert or update on public.events for each row execute function public.appointment_revision_history();
insert into public.appointment_revisions(event_id,revision,snapshot) select id,revision,to_jsonb(e)-'sync_lock'-'sync_lease_until' from public.events e;

drop function public.save_calendar_event(uuid,jsonb,boolean,text);
create function public.save_calendar_event(p_id uuid,p_changes jsonb,p_create boolean,p_actor text,p_user uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  original public.events%rowtype;
  saved public.events%rowtype;
  linked_task uuid;
  account uuid;
  due timestamptz;
  agency_zone text;
  member_role text;
begin
  select role into member_role from agency_members where user_id=p_user and active;
  if member_role is null then raise exception 'Active agency membership is required.' using errcode='42501'; end if;
  if p_id is null or jsonb_typeof(p_changes)<>'object' then raise exception 'A valid event is required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into original from events where id=p_id for update;
  if not p_create and original.id is null then raise exception 'Event not found.' using errcode='P0002'; end if;
  if p_create and original.id is not null then raise exception 'This event already exists. Refresh before retrying.' using errcode='23505'; end if;
  if not p_create and original.user_id is distinct from p_user then raise exception 'Only the appointment owner can change it.' using errcode='42501'; end if;
  if original.sync_lease_until>now() then raise exception 'Calendar is syncing. Retry shortly.' using errcode='PT409'; end if;
  if p_changes ? 'expected_updated_at' and p_changes->>'expected_updated_at' is not null
    and original.updated_at is distinct from (p_changes->>'expected_updated_at')::timestamptz then
    raise exception 'This appointment changed. Refresh before retrying.' using errcode='PT409';
  end if;
  if p_changes ? 'expected_revision' and original.revision is distinct from (p_changes->>'expected_revision')::integer then
    raise exception 'This appointment changed. Refresh before retrying.' using errcode='PT409';
  end if;
  saved:=jsonb_populate_record(original,p_changes-'id'-'expected_updated_at'-'expected_revision'-'user_id');
  saved.id:=p_id; saved.user_id:=p_user;
  saved.subject:=coalesce(nullif(trim(p_changes->>'subject'),''),nullif(trim(p_changes->>'title'),''),original.subject);
  saved.title:=saved.subject;
  saved.status:=coalesce(saved.status,'scheduled'); saved.all_day:=coalesce(saved.all_day,false);
  saved.meeting_type:=coalesce(saved.meeting_type,'phone'); saved.duration_minutes:=coalesce(saved.duration_minutes,30);
  saved.calendar_sync:=coalesce(saved.calendar_sync,false); saved.revision:=coalesce(original.revision,0);
  saved.created_at:=coalesce(original.created_at,now()); saved.updated_at:=now();
  select timezone into agency_zone from outreach_settings where id=1;
  saved.time_zone:=coalesce(original.time_zone,agency_zone);
  if saved.time_zone is null then raise exception 'Agency time zone is not configured.' using errcode='P0002'; end if;
  if saved.subject is null or length(saved.subject)>240 or saved.event_date is null or saved.status not in ('scheduled','completed','cancelled')
    or saved.meeting_type not in ('phone','in_person','google_meet') or saved.duration_minutes not between 15 and 120
    or length(coalesce(saved.location,''))>1000 then raise exception 'Enter valid appointment details.' using errcode='22023'; end if;
  if original.status='cancelled' and saved.status<>'cancelled' then raise exception 'Cancelled appointments remain in history. Create a new appointment.' using errcode='PT409'; end if;
  saved.related_type:=nullif(saved.related_type,'');
  if (saved.related_type is null)<>(saved.related_id is null) then raise exception 'Choose a related record type and record.' using errcode='22023'; end if;
  account:=saved.client_id;
  if saved.related_type='client' then
    perform 1 from clients where id=saved.related_id and (member_role<>'agent' or agent_user_id is null or agent_user_id=p_user);
    if not found then raise exception 'Account not found or unavailable.' using errcode='42501'; end if;
    account:=saved.related_id;
  elsif saved.related_type='lead' then
    select account_id into account from leads where id=saved.related_id and archived_at is null
      and (member_role<>'agent' or agent_user_id is null or agent_user_id=p_user);
    if not found then raise exception 'Lead not found or unavailable.' using errcode='42501'; end if;
  elsif saved.related_type is not null and (p_create or saved.related_type is distinct from original.related_type or saved.related_id is distinct from original.related_id) then
    raise exception 'Link appointments to a lead or account.' using errcode='22023';
  end if;
  if account is not null then
    perform 1 from clients where id=account and (member_role<>'agent' or agent_user_id is null or agent_user_id=p_user);
    if not found then raise exception 'Account not found or unavailable.' using errcode='42501'; end if;
  end if;
  saved.client_id:=account;
  if saved.all_day then saved.event_time:=null; end if;
  if saved.all_day and (saved.meeting_type='google_meet' or saved.calendar_sync) then raise exception 'Calendar syncing requires a timed appointment.' using errcode='22023'; end if;
  if not saved.all_day and coalesce(saved.event_time,'')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception 'Choose a valid appointment time.' using errcode='22023'; end if;
  due:=(saved.event_date+coalesce(saved.event_time,'09:00')::time) at time zone saved.time_zone;
  if saved.status='scheduled' and not saved.all_day and (p_create or row(saved.event_date,saved.event_time,saved.duration_minutes,saved.status)
    is distinct from row(original.event_date,original.event_time,original.duration_minutes,original.status)) then
    if exists(select 1 from events e where e.user_id=p_user and e.id<>p_id and e.status='scheduled' and not e.all_day
      and tstzrange((e.event_date+e.event_time::time) at time zone e.time_zone,
        ((e.event_date+e.event_time::time) at time zone e.time_zone)+make_interval(mins=>e.duration_minutes),'[)')
        && tstzrange(due,due+make_interval(mins=>saved.duration_minutes),'[)')) then
      raise exception 'This time conflicts with another appointment. Choose another time.' using errcode='PT409';
    end if;
  end if;
  if p_create then
    insert into events(id,user_id,client_id,subject,title,description,event_date,event_time,all_day,status,related_type,related_id,
      meeting_type,duration_minutes,location,calendar_sync,time_zone,created_at,updated_at)
    values(p_id,p_user,saved.client_id,saved.subject,saved.title,saved.description,saved.event_date,saved.event_time,saved.all_day,saved.status,saved.related_type,saved.related_id,
      saved.meeting_type,saved.duration_minutes,saved.location,saved.calendar_sync,saved.time_zone,saved.created_at,saved.updated_at);
  else
    update events set client_id=saved.client_id,subject=saved.subject,title=saved.title,description=saved.description,
      event_date=saved.event_date,event_time=saved.event_time,all_day=saved.all_day,status=saved.status,related_type=saved.related_type,related_id=saved.related_id,
      meeting_type=saved.meeting_type,duration_minutes=saved.duration_minutes,location=saved.location,calendar_sync=saved.calendar_sync,time_zone=saved.time_zone
      where id=p_id;
  end if;
  select id into linked_task from tasks where event_id=p_id or (related_type='event' and related_id=p_id) order by created_at,id limit 1 for update;
  if linked_task is null then
    insert into tasks(subject,description,due_date,status,priority,related_type,related_id,event_id,account_id,created_by)
    values(saved.subject,saved.description,due,case saved.status when 'completed' then 'completed' when 'cancelled' then 'cancelled' else 'open' end,
      'medium','event',p_id,p_id,account,p_actor) returning id into linked_task;
  else
    update tasks set subject=saved.subject,description=saved.description,due_date=due,
      status=case saved.status when 'completed' then 'completed' when 'cancelled' then 'cancelled' else 'open' end,
      event_id=p_id,account_id=account,updated_by=p_actor where id=linked_task;
  end if;
  if saved.status='cancelled' then
    update tasks set status='cancelled',updated_by=p_actor
      where (event_id=p_id or (related_type='event' and related_id=p_id)) and status<>'cancelled';
  end if;
  update events set task_id=linked_task where id=p_id returning * into saved;
  if p_create then
    insert into notifications(client_id,type,message,href,read)
      values(account,'appointment','Appointment scheduled: '||saved.subject,'/scheduler?event='||p_id::text,false);
  end if;
  return to_jsonb(saved)-'sync_lock'-'sync_lease_until';
end $$;

create or replace function public.sync_agency_calendar_time_zone()
returns trigger language plpgsql set search_path=public as $$
declare linked uuid:=coalesce(new.event_id,case when new.related_type='event' then new.related_id end);
  e public.events%rowtype;
begin
  if linked is null then return null; end if;
  select * into e from events where id=linked;
  if not found then return null; end if;
  if tg_op='INSERT' or new.due_date is distinct from old.due_date then
    update events set event_date=(new.due_date at time zone e.time_zone)::date,
      event_time=to_char(new.due_date at time zone e.time_zone,'HH24:MI'),all_day=false
      where id=linked and new.due_date is not null and new.due_date is distinct from
      ((event_date+coalesce(event_time,'09:00')::time) at time zone e.time_zone);
  end if;
  if tg_op='UPDATE' and new.status is distinct from old.status then
    update events set status=case when e.status='cancelled' or new.status='cancelled' then 'cancelled'
      when new.status='completed' then 'completed' else 'scheduled' end where id=linked;
  end if;
  return null;
end $$;

create function public.claim_appointment_sync(p_id uuid,p_user uuid,p_lock uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e public.events%rowtype; calendar_subject text;
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
  select * into e from events where id=p_id for update;
  if not found then raise exception 'Appointment not found.' using errcode='P0002'; end if;
  if e.user_id is distinct from p_user or not exists(select 1 from agency_members where user_id=p_user and active) then
    raise exception 'Only the active appointment owner can sync it.' using errcode='42501'; end if;
  if exists(select 1 from events where user_id=p_user and sync_lease_until>now()) then
    raise exception 'Calendar is syncing. Retry shortly.' using errcode='PT409'; end if;
  if e.sync_status='not_required' then return to_jsonb(e)-'sync_lock'-'sync_lease_until'; end if;
  select google_subject into calendar_subject from google_calendar_connections where user_id=p_user and status='connected';
  if calendar_subject is not null and e.google_calendar_subject is not null and calendar_subject<>e.google_calendar_subject then
    raise exception 'Reconnect the Google account that owns this appointment.' using errcode='PT409'; end if;
  update events set sync_lock=p_lock,sync_lease_until=clock_timestamp()+interval '120 seconds',
    google_event_id=coalesce(google_event_id,'crm'||replace(id::text,'-','')||'r'||revision::text),
    google_calendar_subject=coalesce(google_calendar_subject,calendar_subject)
    where id=p_id returning * into e;
  return to_jsonb(e)-'sync_lock'-'sync_lease_until';
end $$;

create function public.claim_appointment_notification(p_id uuid,p_user uuid,p_revision integer,p_lock uuid) returns void
language plpgsql security definer set search_path=public as $$
declare e public.events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
  select * into e from events where id=p_id for update;
  if not found or e.user_id is distinct from p_user or not exists(select 1 from agency_members where user_id=p_user and active) then
    raise exception 'Only the active appointment owner can send notifications.' using errcode='42501'; end if;
  if e.revision<>p_revision then raise exception 'This appointment changed. Refresh before sending.' using errcode='PT409'; end if;
  if exists(select 1 from events where user_id=p_user and sync_lease_until>now()) then
    raise exception 'Calendar is updating. Retry shortly.' using errcode='PT409'; end if;
  update events set sync_lock=p_lock,sync_lease_until=clock_timestamp()+interval '120 seconds' where id=p_id;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('connect_google_calendar','disconnect_google_calendar','save_calendar_event','claim_appointment_sync','claim_appointment_notification',
      'appointment_revision_stamp','appointment_revision_history') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
