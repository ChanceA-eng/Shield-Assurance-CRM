begin;
alter table public.leads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archive_reason text,
  add column if not exists archive_effects jsonb;
create index if not exists leads_active_created_idx on public.leads(created_at desc) where archived_at is null;
create index if not exists leads_archived_idx on public.leads(archived_at desc) where archived_at is not null;

create or replace function public.archive_leads(p_ids uuid[],p_actor text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target uuid; results jsonb:='[]'::jsonb; closed jsonb; paused jsonb; drafts integer; requests integer;
  stamp timestamptz:=clock_timestamp();
begin
  if coalesce(cardinality(p_ids),0)=0 or array_position(p_ids,null) is not null or nullif(trim(p_actor),'') is null then
    raise exception 'Choose at least one lead to archive.' using errcode='22023';
  end if;
  if cardinality(p_ids)>200 then raise exception 'Archive up to 200 leads at a time.' using errcode='22023'; end if;
  perform 1 from public.leads where id=any(p_ids) order by id for update;
  for target in select distinct id from unnest(p_ids) as ids(id) order by 1 loop
    if not exists(select 1 from public.leads where id=target) then
      results:=results||jsonb_build_object('id',target,'outcome','missing'); continue;
    end if;
    if exists(select 1 from public.leads where id=target and archived_at is not null) then
      results:=results||jsonb_build_object('id',target,'outcome','already_archived'); continue;
    end if;
    -- Reject drafts first so their approval reminders resolve normally and are never reopened by restore.
    with changed as (
      update public.outreach_outbox set status='rejected',error='Lead archived before this email was approved.'
      where lead_id=target and status='pending_approval' returning id
    ) select count(*) into drafts from changed;
    -- Closing tasks also clears their alerts through workspace_prepare_task.
    with changed as (
      update public.tasks set status='completed',updated_by=p_actor
      where related_type='lead' and related_id=target and status='open'
      returning id,updated_at
    ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at)),'[]'::jsonb) into closed from changed;
    with changed as (
      update public.lead_intake_events set dismissed_at=stamp
      where lead_id=target and opened_at is null and dismissed_at is null and handled_at is null returning id
    ) select count(*) into requests from changed;
    update public.notifications n set read=true from public.lead_intake_events e
      where n.intake_event_id=e.id and e.lead_id=target and n.read=false;
    with changed as (
      update public.sequence_enrollments set status='paused',ended_reason='lead_archived'
      where lead_id=target and status='active' returning id
    ) select coalesce(jsonb_agg(id),'[]'::jsonb) into paused from changed;
    update public.leads set archived_at=stamp,archived_by=p_actor,archive_reason=nullif(trim(p_reason),''),
      archive_effects=jsonb_build_object('tasks',closed,'sequences',paused,'drafts_rejected',drafts,'requests_dismissed',requests)
    where id=target;
    results:=results||jsonb_build_object('id',target,'outcome','archived','tasks_closed',jsonb_array_length(closed),
      'sequences_paused',jsonb_array_length(paused),'drafts_rejected',drafts,'requests_dismissed',requests);
  end loop;
  return results;
end;
$$;

create or replace function public.restore_leads(p_ids uuid[],p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target uuid; lead public.leads%rowtype; results jsonb:='[]'::jsonb; reopened integer;
begin
  if coalesce(cardinality(p_ids),0)=0 or array_position(p_ids,null) is not null or nullif(trim(p_actor),'') is null then
    raise exception 'Choose at least one lead to restore.' using errcode='22023';
  end if;
  if cardinality(p_ids)>200 then raise exception 'Restore up to 200 leads at a time.' using errcode='22023'; end if;
  perform 1 from public.leads where id=any(p_ids) order by id for update;
  for target in select distinct id from unnest(p_ids) as ids(id) order by 1 loop
    select * into lead from public.leads where id=target;
    if not found then results:=results||jsonb_build_object('id',target,'outcome','missing'); continue; end if;
    if lead.archived_at is null then results:=results||jsonb_build_object('id',target,'outcome','not_archived'); continue; end if;
    -- Only reopen tasks archiving closed that nobody has touched since.
    with changed as (
      update public.tasks t set status='open',updated_by=p_actor
      from jsonb_to_recordset(coalesce(lead.archive_effects->'tasks','[]'::jsonb)) as closed(id uuid,updated_at timestamptz)
      where t.id=closed.id and t.status='completed' and t.updated_at=closed.updated_at
      returning t.id
    ) select count(*) into reopened from changed;
    update public.leads set archived_at=null,archived_by=null,archive_reason=null,archive_effects=null,last_activity_at=now()
    where id=target;
    results:=results||jsonb_build_object('id',target,'outcome','restored','tasks_reopened',reopened,
      'sequences_paused',(select count(*) from public.sequence_enrollments where lead_id=target and status='paused'));
  end loop;
  return results;
end;
$$;

create or replace function public.get_actionable_leads_count()
returns integer language plpgsql as $$
declare total_alerts integer;
begin
  select count(*) into total_alerts from public.leads
  where status in ('new','contacted') and archived_at is null
    and (last_viewed_at is null or coalesce(last_activity_at,created_at)>last_viewed_at or last_viewed_at<=now()-interval '24 hours');
  return total_alerts;
end;
$$;

create or replace function public.ensure_default_followups()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare created integer; due timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('default-followups',0));
  if extract(isodow from now() at time zone 'America/Phoenix') in (6,7) then return 0; end if;
  due:=(date_trunc('day',now() at time zone 'America/Phoenix')+interval '1 day 9 hours') at time zone 'America/Phoenix';
  while extract(isodow from due at time zone 'America/Phoenix') in (6,7) loop due:=due+interval '1 day'; end loop;
  insert into public.tasks(subject,description,due_date,status,priority,related_type,related_id)
  select case when l.status='quoted' then 'Follow up on '||l.full_name||'''s quote'
    when l.status='contacted' then 'Follow up with '||l.full_name else 'Make first contact with '||l.full_name end,
    'Review the profile and contact the prospect about their next step.',due,'open','medium','lead',l.id
  from public.leads l where l.status in ('new','contacted','quoted') and l.archived_at is null
    and not exists(select 1 from public.tasks t where t.status='open' and t.related_type='lead' and t.related_id=l.id);
  get diagnostics created=row_count;
  return created;
end;
$$;

-- A new website request from an archived lead brings the lead back before creating its work.
create or replace function public.apply_website_resubmission(p_lead_id uuid,p_payload jsonb,p_full_name text default null,p_email text default null,p_phone text default null)
returns boolean language plpgsql security definer set search_path to 'public' as $$
  declare lead public.leads%rowtype; key text; payload jsonb; history jsonb; event_id uuid;
  begin
    select * into lead from public.leads where id = p_lead_id for update;
    if not found then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
    key := public.workspace_submission_key(lead.id, p_payload);
    if exists (select 1 from public.lead_intake_events where submission_key = key) then return false; end if;
    if lead.archived_at is not null then perform public.restore_leads(array[lead.id],'Website request'); end if;
    payload := p_payload - 'previous_submissions';
    payload := jsonb_set(payload, '{_intake}', '{"channel":"website"}'::jsonb);
    if lead.form_payload->'profile' is not null then payload := jsonb_set(payload, '{profile}', lead.form_payload->'profile'); end if;
    history := coalesce(lead.form_payload->'previous_submissions', '[]'::jsonb)
      || jsonb_build_array(coalesce(lead.form_payload, '{}'::jsonb) - 'previous_submissions');
    payload := jsonb_set(payload, '{previous_submissions}', history);
    update public.leads l set
      form_payload = payload, last_activity_at = now(),
      full_name = case when l.confirmed_fields ? 'full_name' then l.full_name else coalesce(nullif(trim(p_full_name), ''), l.full_name) end,
      email = case when l.confirmed_fields ? 'email' then l.email else coalesce(nullif(lower(trim(p_email)), ''), l.email) end,
      phone = case when l.confirmed_fields ? 'phone' then l.phone else coalesce(nullif(trim(p_phone), ''), l.phone) end,
      status = case when l.status in ('lost', 'inactive') then 'new' else l.status end,
      stage_changed_at = case when l.status in ('lost', 'inactive') then now() else l.stage_changed_at end,
      lost_reason = case when l.status in ('lost', 'inactive') then null else l.lost_reason end
    where l.id = lead.id;
    select id into event_id from public.lead_intake_events where submission_key = key;
    if event_id is null then raise exception 'The website source did not produce an intake event.' using errcode = '23514'; end if;
    perform public.create_intake_work(event_id);
    return true;
  end;
$$;

revoke all on function public.archive_leads(uuid[],text,text) from public,anon,authenticated;
revoke all on function public.restore_leads(uuid[],text) from public,anon,authenticated;
grant execute on function public.archive_leads(uuid[],text,text) to service_role;
grant execute on function public.restore_leads(uuid[],text) to service_role;
notify pgrst,'reload schema';
commit;
