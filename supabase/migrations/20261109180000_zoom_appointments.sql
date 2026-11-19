begin;

create table public.zoom_connections (
  user_id uuid primary key references public.agency_members(user_id),
  email text not null, zoom_subject text not null,
  status text not null default 'connected' check(status in ('connected','reconnect','disconnected')),
  last_error text, connected_at timestamptz not null default now()
);
create table public.zoom_credentials (
  user_id uuid primary key references public.zoom_connections(user_id) on delete cascade,
  refresh_secret text not null, access_secret text, access_expires_at timestamptz,
  refresh_lock uuid, refresh_lease_until timestamptz
);
create table public.zoom_oauth_states (
  state_hash text primary key, user_id uuid not null references public.agency_members(user_id),
  browser_hash text not null, expires_at timestamptz not null
);
alter table public.events
  drop constraint events_meeting_type_check,
  add constraint events_meeting_type_check check(meeting_type in ('phone','in_person','google_meet','zoom')),
  add column zoom_meeting_id text,
  add column zoom_join_url text,
  add column zoom_subject text,
  add column zoom_create_attempted_at timestamptz;
create unique index events_zoom_identity on public.events(user_id,zoom_meeting_id) where zoom_meeting_id is not null;

do $$
declare t text; source text;
begin
  foreach t in array array['zoom_connections','zoom_credentials','zoom_oauth_states'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  select pg_get_functiondef('public.save_calendar_event(uuid,jsonb,boolean,text,uuid)'::regprocedure) into source;
  if strpos(source,'''phone'',''in_person'',''google_meet''')=0
    or strpos(source,'saved.meeting_type=''google_meet'' or saved.calendar_sync')=0 then
    raise exception 'Unexpected save_calendar_event definition; review Zoom migration.';
  end if;
  source:=replace(source,'''phone'',''in_person'',''google_meet''','''phone'',''in_person'',''google_meet'',''zoom''');
  source:=replace(source,'saved.meeting_type=''google_meet'' or saved.calendar_sync','saved.meeting_type in (''google_meet'',''zoom'') or saved.calendar_sync');
  execute source;
  select pg_get_functiondef('public.appointment_revision_stamp()'::regprocedure) into source;
  if strpos(source,'new.meeting_type=''google_meet'' or new.calendar_sync or new.google_event_id is not null')=0 then
    raise exception 'Unexpected appointment revision definition; review Zoom migration.';
  end if;
  source:=replace(source,'new.meeting_type=''google_meet'' or new.calendar_sync or new.google_event_id is not null',
    'new.meeting_type in (''google_meet'',''zoom'') or new.calendar_sync or new.google_event_id is not null or new.zoom_meeting_id is not null or new.zoom_create_attempted_at is not null');
  execute source;
end $$;

create function public.connect_zoom(p_user uuid,p_email text,p_subject text,p_refresh text,p_access text,p_expires timestamptz)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
  if not exists(select 1 from agency_members where user_id=p_user and active) then
    raise exception 'Active agency membership is required.' using errcode='42501'; end if;
  if exists(select 1 from events where user_id=p_user and sync_lease_until>now())
    or exists(select 1 from zoom_credentials where user_id=p_user and refresh_lease_until>now()) then
    raise exception 'Zoom is updating. Retry shortly.' using errcode='PT409'; end if;
  if exists(select 1 from events where user_id=p_user and (zoom_meeting_id is not null or zoom_create_attempted_at is not null)
    and zoom_subject is not null and zoom_subject is distinct from p_subject) then
    raise exception 'Reconnect the Zoom account that owns your existing appointments.' using errcode='PT409'; end if;
  insert into zoom_connections(user_id,email,zoom_subject,status) values(p_user,lower(p_email),p_subject,'connected')
    on conflict(user_id) do update set email=excluded.email,zoom_subject=excluded.zoom_subject,status='connected',last_error=null,connected_at=now();
  insert into zoom_credentials(user_id,refresh_secret,access_secret,access_expires_at)
    values(p_user,p_refresh,p_access,p_expires)
    on conflict(user_id) do update set refresh_secret=excluded.refresh_secret,access_secret=excluded.access_secret,access_expires_at=excluded.access_expires_at,
      refresh_lock=null,refresh_lease_until=null;
end $$;
create function public.disconnect_zoom(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
  if not exists(select 1 from agency_members where user_id=p_user and active) then
    raise exception 'Active agency membership is required.' using errcode='42501'; end if;
  if exists(select 1 from events where user_id=p_user and sync_lease_until>now())
    or exists(select 1 from zoom_credentials where user_id=p_user and refresh_lease_until>now()) then
    raise exception 'Zoom is updating. Retry shortly.' using errcode='PT409'; end if;
  delete from zoom_credentials where user_id=p_user;
  delete from zoom_oauth_states where user_id=p_user;
  update zoom_connections set status='disconnected',last_error=null where user_id=p_user;
end $$;
create function public.claim_zoom_refresh(p_user uuid,p_lock uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare credentials public.zoom_credentials%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
  if not exists(select 1 from agency_members where user_id=p_user and active)
    or not exists(select 1 from zoom_connections where user_id=p_user and status='connected') then
    raise exception 'Reconnect your Zoom account.' using errcode='42501'; end if;
  select * into credentials from zoom_credentials where user_id=p_user for update;
  if not found then raise exception 'Reconnect your Zoom account.' using errcode='P0002'; end if;
  if credentials.refresh_lease_until>now() then raise exception 'Zoom authorization is refreshing. Retry shortly.' using errcode='PT409'; end if;
  update zoom_credentials set refresh_lock=p_lock,refresh_lease_until=clock_timestamp()+interval '60 seconds' where user_id=p_user;
  return jsonb_build_object('refresh_secret',credentials.refresh_secret,'access_secret',credentials.access_secret,'access_expires_at',credentials.access_expires_at);
end $$;

create or replace function public.claim_appointment_sync(p_id uuid,p_user uuid,p_lock uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e public.events%rowtype; calendar_subject text; connected_zoom_subject text;
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
  select zoom_subject into connected_zoom_subject from zoom_connections where user_id=p_user and status='connected';
  if connected_zoom_subject is not null and e.zoom_subject is not null and connected_zoom_subject<>e.zoom_subject then
    raise exception 'Reconnect the Zoom account that owns this appointment.' using errcode='PT409'; end if;
  update events set sync_lock=p_lock,sync_lease_until=clock_timestamp()+interval '120 seconds',
    google_event_id=case when calendar_sync or meeting_type='google_meet'
      then coalesce(google_event_id,'crm'||replace(id::text,'-','')||'r'||revision::text) else google_event_id end,
    google_calendar_subject=case when calendar_sync or meeting_type='google_meet' then coalesce(google_calendar_subject,calendar_subject) else google_calendar_subject end,
    zoom_subject=case when meeting_type='zoom' then coalesce(zoom_subject,connected_zoom_subject) else zoom_subject end
    where id=p_id returning * into e;
  return to_jsonb(e)-'sync_lock'-'sync_lease_until';
end $$;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('connect_zoom','disconnect_zoom','claim_zoom_refresh') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
