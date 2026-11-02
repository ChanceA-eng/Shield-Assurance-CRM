begin;

alter table public.events add column if not exists updated_at timestamptz not null default now();

create or replace function public.calendar_stamp_event()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger calendar_stamp_event before update on public.events for each row execute function public.calendar_stamp_event();

create or replace function public.workspace_sync_calendar_task()
returns trigger language plpgsql set search_path = public as $$
declare
  linked uuid := coalesce(new.event_id, case when new.related_type = 'event' then new.related_id end);
begin
  if linked is null then return null; end if;
  if new.status is distinct from old.status then
    update public.events set status=case when new.status='completed' then 'completed' else 'scheduled' end where id=linked;
  end if;
  if new.due_date is distinct from old.due_date and new.due_date is not null then
    update public.events set event_date=(new.due_date at time zone 'America/Phoenix')::date,
      event_time=to_char(new.due_date at time zone 'America/Phoenix','HH24:MI'),all_day=false
    where id=linked and new.due_date is distinct from
      ((event_date + coalesce(event_time,'09:00')::time) at time zone 'America/Phoenix');
  end if;
  return null;
end;
$$;
drop trigger if exists workspace_sync_calendar_task on public.tasks;
create trigger workspace_sync_calendar_task after update of status,due_date on public.tasks for each row execute function public.workspace_sync_calendar_task();

create or replace function public.save_calendar_event(
  p_id uuid, p_changes jsonb, p_create boolean, p_actor text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  original public.events%rowtype;
  saved public.events%rowtype;
  linked_task uuid;
  account uuid;
  due timestamptz;
begin
  if p_id is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'A valid event is required.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into original from public.events where id = p_id for update;
  if not p_create and original.id is null then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;
  if p_create and original.id is not null then
    raise exception 'This event save already exists. Refresh before retrying.' using errcode = '23505';
  end if;
  if p_changes ? 'expected_updated_at' and p_changes->>'expected_updated_at' is not null
    and original.updated_at is distinct from (p_changes->>'expected_updated_at')::timestamptz then
    raise exception 'This event changed. Refresh before retrying.' using errcode = '23505';
  end if;
  saved := jsonb_populate_record(original, p_changes - 'id' - 'expected_updated_at');
  saved.id := p_id;
  saved.subject := coalesce(nullif(trim(p_changes->>'subject'), ''), nullif(trim(p_changes->>'title'), ''), original.subject);
  saved.title := saved.subject;
  saved.status := coalesce(saved.status, 'scheduled');
  saved.all_day := coalesce(saved.all_day, false);
  saved.created_at := coalesce(original.created_at, now());
  saved.updated_at := now();
  saved.related_type := nullif(saved.related_type, '');
  saved.related_id := nullif(p_changes->>'related_id', '')::uuid;
  if not (p_changes ? 'related_id') then saved.related_id := original.related_id; end if;
  if saved.subject is null or length(saved.subject) > 240 or saved.event_date is null
    or saved.status not in ('scheduled', 'completed') then
    raise exception 'Enter a valid title, date and status.' using errcode = '22023';
  end if;
  if (saved.related_type is null) <> (saved.related_id is null) then
    raise exception 'Choose both a related record type and record.' using errcode = '22023';
  end if;
  account := saved.client_id;
  if saved.related_type = 'client' then
    perform 1 from public.clients where id = saved.related_id;
    if not found then raise exception 'Account not found.' using errcode = '23503'; end if;
    account := saved.related_id;
  elsif saved.related_type = 'lead' then
    select account_id into account from public.leads where id = saved.related_id;
    if not found then raise exception 'Lead not found.' using errcode = '23503'; end if;
  elsif saved.related_type is not null and (p_create or saved.related_type is distinct from original.related_type or saved.related_id is distinct from original.related_id) then
    raise exception 'Link appointments to a lead or account.' using errcode = '22023';
  end if;
  saved.client_id := account;
  if saved.all_day then saved.event_time := null; end if;
  if not saved.all_day and coalesce(saved.event_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception 'Choose a valid Arizona event time.' using errcode = '22023';
  end if;
  due := (saved.event_date + coalesce(saved.event_time, '09:00')::time) at time zone 'America/Phoenix';
  if p_create then
    insert into public.events (id,client_id,subject,title,description,event_date,event_time,all_day,status,related_type,related_id,created_at,updated_at)
    values (saved.id,saved.client_id,saved.subject,saved.title,saved.description,saved.event_date,saved.event_time,saved.all_day,saved.status,saved.related_type,saved.related_id,saved.created_at,saved.updated_at);
  else
    update public.events set client_id=saved.client_id,subject=saved.subject,title=saved.title,description=saved.description,
      event_date=saved.event_date,event_time=saved.event_time,all_day=saved.all_day,status=saved.status,
      related_type=saved.related_type,related_id=saved.related_id,updated_at=saved.updated_at where id=p_id;
  end if;
  select id into linked_task from public.tasks where event_id=p_id or (related_type='event' and related_id=p_id) order by created_at,id limit 1 for update;
  if linked_task is null then
    insert into public.tasks(subject,description,due_date,status,priority,related_type,related_id,event_id,account_id,created_by)
    values(saved.subject,saved.description,due,case when saved.status='completed' then 'completed' else 'open' end,'medium','event',p_id,p_id,account,p_actor)
    returning id into linked_task;
  else
    update public.tasks set subject=saved.subject,description=saved.description,due_date=due,
      status=case when saved.status='completed' then 'completed' else 'open' end,event_id=p_id,account_id=account,updated_by=p_actor
    where id=linked_task;
  end if;
  update public.events set task_id=linked_task where id=p_id returning * into saved;
  if p_create then
    insert into public.notifications(client_id,type,message,href,read)
    values(account,'appointment','Appointment scheduled: '||saved.subject,'/scheduler?event='||p_id::text,false);
  end if;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.save_calendar_event(uuid,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.save_calendar_event(uuid,jsonb,boolean,text) to service_role;
commit;
