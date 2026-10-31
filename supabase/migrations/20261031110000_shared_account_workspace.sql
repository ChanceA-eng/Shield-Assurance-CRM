-- Keep legacy stores intact while making tasks, notes and assets share account ownership.
do $migration$
begin
  alter table public.leads
    add column if not exists account_id uuid references public.clients(id) on delete set null,
    add column if not exists confirmed_fields jsonb not null default '{}'::jsonb;
  create index if not exists leads_account_id_idx on public.leads(account_id);

  alter table public.client_assets
    alter column client_id drop not null,
    add column if not exists lead_id uuid references public.leads(id) on delete set null,
    add column if not exists archived_at timestamptz,
    add column if not exists created_by text,
    add column if not exists updated_by text;
  alter table public.client_assets add constraint client_assets_owner_check check (client_id is not null or lead_id is not null);
  create index if not exists client_assets_lead_id_idx on public.client_assets(lead_id);

  alter table public.interactions
    add column if not exists client_id uuid references public.clients(id) on delete cascade,
    add column if not exists note_type text not null default 'general',
    add column if not exists pinned boolean not null default false,
    add column if not exists author_id uuid,
    add column if not exists author_name text,
    add column if not exists updated_by text,
    add column if not exists updated_at timestamptz,
    add column if not exists archived_at timestamptz;
  update public.interactions set updated_at = created_at where updated_at is null;
  alter table public.interactions alter column updated_at set default now(), alter column updated_at set not null;
  alter table public.interactions drop constraint if exists interactions_lead_id_fkey;
  alter table public.interactions add constraint interactions_lead_id_fkey foreign key (lead_id) references public.leads(id) on delete set null;
  alter table public.interactions add constraint interactions_owner_check check (lead_id is not null or client_id is not null) not valid;
  create index if not exists interactions_client_id_idx on public.interactions(client_id);

  alter table public.client_activities
    alter column client_id drop not null,
    add column if not exists lead_id uuid references public.leads(id) on delete set null;
  create index if not exists client_activities_lead_id_idx on public.client_activities(lead_id);

  alter table public.tasks
    add column if not exists kind text not null default 'task',
    add column if not exists note_id uuid references public.interactions(id) on delete set null,
    add column if not exists completed_at timestamptz,
    add column if not exists updated_at timestamptz,
    add column if not exists created_by text,
    add column if not exists updated_by text,
    add column if not exists reminder_version integer not null default 1;
  update public.tasks set updated_at = created_at where updated_at is null;
  alter table public.tasks alter column updated_at set default now(), alter column updated_at set not null;
  alter table public.tasks add constraint tasks_kind_check check (kind in ('task', 'reminder'));
  alter table public.tasks add constraint tasks_reminder_date_check check (kind <> 'reminder' or due_date is not null);

  insert into public.interactions (id, client_id, content, note_type, follow_up_completed, created_at, updated_at)
  select id, client_id, coalesce(nullif(value, ''), title), 'general', true, created_at, updated_at
  from public.client_assets where asset_type = 'note'
  on conflict (id) do nothing;

  insert into public.tasks (id, account_id, subject, description, due_date, status, priority, related_type, related_id, created_at, updated_at)
  select id, client_id, subject, description, (due_date + time '16:00') at time zone 'America/Phoenix', status, priority, 'client', client_id, created_at, updated_at
  from public.client_tasks
  on conflict (id) do nothing;

  create table public.lead_intake_events (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads(id) on delete cascade,
    submission_key text not null unique,
    source_submission_id text,
    submitted_at timestamptz not null,
    received_at timestamptz not null default now(),
    time_basis text not null check (time_basis in ('submitted', 'received')),
    snapshot jsonb not null,
    opened_at timestamptz,
    dismissed_at timestamptz,
    handled_at timestamptz,
    acknowledged_by uuid
  );
  create index lead_intake_events_queue_idx on public.lead_intake_events(submitted_at desc, received_at desc, id desc)
    where opened_at is null and dismissed_at is null and handled_at is null;
  create index lead_intake_events_lead_idx on public.lead_intake_events(lead_id, submitted_at desc);
  create index lead_intake_events_source_id_idx on public.lead_intake_events(source_submission_id);
  alter table public.lead_intake_events enable row level security;

  alter table public.tasks add column if not exists intake_event_id uuid references public.lead_intake_events(id) on delete set null;
  create unique index tasks_intake_event_unique on public.tasks(intake_event_id) where intake_event_id is not null;
  alter table public.notifications
    add column if not exists task_id uuid references public.tasks(id) on delete cascade,
    add column if not exists reminder_version integer,
    add column if not exists intake_event_id uuid references public.lead_intake_events(id) on delete set null;
  create unique index notifications_reminder_unique on public.notifications(task_id, reminder_version) where task_id is not null;
  create unique index notifications_intake_unique on public.notifications(intake_event_id) where intake_event_id is not null;

  create or replace function public.workspace_is_website(p_source text)
  returns boolean language sql immutable as $fn$
    select lower(coalesce(p_source, '')) like 'website%'
      or lower(coalesce(p_source, '')) in ('web', 'web-form', 'guided-business-review', 'coverage-guide', 'quote-request');
  $fn$;

  create or replace function public.workspace_has_website_submission(p_source text, p_payload jsonb)
  returns boolean language sql immutable as $fn$
    select public.workspace_is_website(p_source) or public.workspace_is_website(p_payload->>'source')
      or coalesce(p_payload#>>'{_intake,channel}' = 'website', false);
  $fn$;

  create or replace function public.workspace_submission_key(p_lead_id uuid, p_payload jsonb)
  returns text language sql immutable as $fn$
    select case
      when coalesce(nullif(p_payload->>'id', ''), nullif(p_payload->>'submission_id', '')) is not null
        then 'website:' || coalesce(nullif(p_payload->>'id', ''), p_payload->>'submission_id')
      else 'lead:' || p_lead_id::text || ':' || md5((coalesce(p_payload, '{}'::jsonb) - 'previous_submissions' - 'profile' - 'lead_context' - '_request' - '_intake')::text)
    end;
  $fn$;

  create or replace function public.workspace_intake_date(p_payload jsonb)
  returns timestamptz language plpgsql stable as $fn$
  declare
    candidate text;
    parsed timestamptz;
  begin
    foreach candidate in array array[
      p_payload#>>'{metadata,submittedAt}', p_payload->>'submitted_at',
      p_payload->>'submission_date', p_payload#>>'{metadata,contactConsent,timestamp}',
      p_payload#>>'{metadata,consent,timestamp}', p_payload->>'created_at'
    ] loop
      if nullif(trim(candidate), '') is null then continue; end if;
      begin
        if candidate ~ '^\d{4}-\d{2}-\d{2}([T ].*)?$' then
          if candidate ~ '[T ]\d{2}:\d{2}' and candidate ~* '(Z|[+-]\d{2}(:?\d{2})?)$' then parsed := candidate::timestamptz;
          else parsed := candidate::timestamp at time zone 'America/Phoenix';
          end if;
          return parsed;
        end if;
      exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
        raise warning 'Invalid website submission timestamp; trying the next available timestamp.';
      end;
    end loop;
    return null;
  end;
  $fn$;

  -- Import historical submissions without generating new tasks or pretending they arrived today.
  insert into public.lead_intake_events (
    lead_id, submission_key, source_submission_id, submitted_at, received_at, time_basis, snapshot, handled_at
  )
  select l.id, public.workspace_submission_key(l.id, l.form_payload),
    coalesce(nullif(l.form_payload->>'id', ''), nullif(l.form_payload->>'submission_id', '')),
    coalesce(public.workspace_intake_date(l.form_payload), l.created_at),
    l.created_at,
    case when public.workspace_intake_date(l.form_payload) is null then 'received' else 'submitted' end,
    l.form_payload - 'previous_submissions',
    case when l.status <> 'new' then now() else null end
  from public.leads l
  where public.workspace_has_website_submission(l.source, l.form_payload) and l.form_payload is not null
  order by l.created_at desc
  on conflict (submission_key) do nothing;

  insert into public.lead_intake_events (
    lead_id, submission_key, source_submission_id, submitted_at, received_at, time_basis, snapshot, handled_at
  )
  select l.id, public.workspace_submission_key(l.id, prior),
    coalesce(nullif(prior->>'id', ''), nullif(prior->>'submission_id', '')),
    coalesce(public.workspace_intake_date(prior), l.created_at), l.created_at,
    case when public.workspace_intake_date(prior) is null then 'received' else 'submitted' end,
    prior - 'previous_submissions', now()
  from public.leads l
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(l.form_payload->'previous_submissions') = 'array' then l.form_payload->'previous_submissions' else '[]'::jsonb end
  ) prior
  where public.workspace_has_website_submission(l.source, l.form_payload)
  on conflict (submission_key) do nothing;

  create or replace function public.workspace_prepare_owned_record()
  returns trigger language plpgsql set search_path = public as $fn$
  declare linked_id uuid;
  begin
    if new.lead_id is not null then
      select account_id into linked_id from public.leads where id = new.lead_id;
      if new.client_id is not null and linked_id is distinct from new.client_id then
        raise exception 'The lead and account do not own the same record.' using errcode = '23514';
      end if;
      new.client_id := coalesce(linked_id, new.client_id);
    end if;
    if tg_op = 'UPDATE' then new.updated_at := clock_timestamp(); end if;
    return new;
  end;
  $fn$;
  create trigger workspace_prepare_asset before insert or update on public.client_assets
    for each row execute function public.workspace_prepare_owned_record();
  create trigger workspace_prepare_note before insert or update on public.interactions
    for each row execute function public.workspace_prepare_owned_record();

  create or replace function public.workspace_prepare_task()
  returns trigger language plpgsql set search_path = public as $fn$
  begin
    if new.related_type = 'lead' and new.related_id is not null then
      if not exists (select 1 from public.leads where id = new.related_id) then
        raise exception 'The related lead no longer exists.' using errcode = '23503';
      end if;
      select account_id into new.account_id from public.leads where id = new.related_id;
    elsif new.related_type = 'client' and new.related_id is not null then
      if not exists (select 1 from public.clients where id = new.related_id) then
        raise exception 'The related client no longer exists.' using errcode = '23503';
      end if;
      new.account_id := new.related_id;
    end if;
    if new.note_id is not null and not exists (
      select 1 from public.interactions i where i.id = new.note_id and (
        (new.related_type = 'lead' and i.lead_id = new.related_id)
        or (new.account_id is not null and i.client_id = new.account_id)
      )
    ) then raise exception 'This note and task do not belong to the same profile.' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' then
      new.updated_at := clock_timestamp();
      if new.status = 'completed' and old.status <> 'completed' then new.completed_at := clock_timestamp(); end if;
      if new.status <> 'completed' then new.completed_at := null; end if;
      if new.due_date is distinct from old.due_date or new.kind is distinct from old.kind
        or (new.status = 'open' and old.status <> 'open') then
        new.reminder_version := old.reminder_version + 1;
      end if;
      if new.status <> 'open' or new.reminder_version <> old.reminder_version then
        update public.notifications set read = true where task_id = new.id and read = false;
      end if;
    elsif new.status = 'completed' then new.completed_at := clock_timestamp();
    end if;
    return new;
  end;
  $fn$;
  create trigger workspace_prepare_task before insert or update on public.tasks
    for each row execute function public.workspace_prepare_task();

  create or replace function public.workspace_sync_calendar_task()
  returns trigger language plpgsql set search_path = public as $fn$
  declare linked_event uuid;
  begin
    if new.status is distinct from old.status then
      linked_event := coalesce(new.event_id, case when new.related_type = 'event' then new.related_id else null end);
      if linked_event is not null then
        update public.events set status = case when new.status = 'completed' then 'completed' else 'scheduled' end where id = linked_event;
      end if;
    end if;
    return null;
  end;
  $fn$;
  create trigger workspace_sync_calendar_task after update of status on public.tasks
    for each row execute function public.workspace_sync_calendar_task();

  create or replace function public.workspace_audit_change()
  returns trigger language plpgsql set search_path = public as $fn$
  declare
    after_row jsonb := to_jsonb(new);
    before_row jsonb;
    account_id uuid;
    lead_id uuid;
    label text;
    action text;
    actor text;
  begin
    if tg_table_name = 'client_assets' and after_row->>'asset_type' = 'note' then return null; end if;
    if tg_op = 'UPDATE' then before_row := to_jsonb(old); end if;
    if tg_table_name = 'tasks' then
      account_id := new.account_id;
      if new.related_type = 'lead' then lead_id := new.related_id; end if;
      label := new.subject;
      action := case when tg_op = 'INSERT' then 'Task created'
        when new.status = 'completed' and old.status <> 'completed' then 'Task completed'
        when new.status = 'open' and old.status = 'completed' then 'Task reopened'
        when new.due_date is distinct from old.due_date then 'Task rescheduled' else 'Task updated' end;
    elsif tg_table_name = 'interactions' then
      account_id := new.client_id; lead_id := new.lead_id;
      label := case new.note_type when 'call' then 'Call note' when 'underwriting' then 'Underwriting note'
        when 'service' then 'Service note' else 'Note' end;
      action := case when tg_op = 'INSERT' then 'Note added' else 'Note updated' end;
    else
      account_id := new.client_id; lead_id := new.lead_id; label := new.title;
      action := case when tg_op = 'INSERT' then 'Asset added'
        when new.archived_at is not null and old.archived_at is null then 'Asset archived'
        when new.archived_at is null and old.archived_at is not null then 'Asset restored' else 'Asset updated' end;
    end if;
    actor := coalesce(after_row->>'updated_by', after_row->>'author_name', after_row->>'created_by');
    insert into public.client_activities (client_id, lead_id, activity_type, title, body, metadata, occurred_at)
    values (account_id, lead_id, lower(replace(action, ' ', '_')), action || ': ' || label,
      coalesce(after_row->>'content', after_row->>'description'),
      jsonb_build_object('record_table', tg_table_name, 'record_id', new.id, 'before', before_row, 'after', after_row, 'actor', actor), clock_timestamp());
    if lead_id is not null then update public.leads set last_activity_at = clock_timestamp() where id = lead_id; end if;
    if account_id is not null then update public.clients set last_activity_at = clock_timestamp() where id = account_id; end if;
    return null;
  end;
  $fn$;
  create trigger workspace_audit_asset after insert or update on public.client_assets for each row execute function public.workspace_audit_change();
  create trigger workspace_audit_note after insert or update on public.interactions for each row execute function public.workspace_audit_change();
  create trigger workspace_audit_task after insert or update on public.tasks for each row execute function public.workspace_audit_change();

  -- Old deployed clients may still write these stores. Mirror their writes into the canonical stores.
  create or replace function public.workspace_sync_legacy_task()
  returns trigger language plpgsql set search_path = public as $fn$
  begin
    if tg_op = 'DELETE' then
      delete from public.tasks where id = old.id and account_id = old.client_id;
      return old;
    end if;
    insert into public.tasks (id, account_id, subject, description, due_date, status, priority, related_type, related_id, created_at, updated_at)
    values (new.id, new.client_id, new.subject, new.description, (new.due_date + time '16:00') at time zone 'America/Phoenix',
      new.status, new.priority, 'client', new.client_id, new.created_at, new.updated_at)
    on conflict (id) do update set subject = excluded.subject, description = excluded.description, due_date = excluded.due_date,
      status = excluded.status, priority = excluded.priority, updated_at = excluded.updated_at;
    return new;
  end;
  $fn$;
  create trigger workspace_sync_legacy_task after insert or update or delete on public.client_tasks
    for each row execute function public.workspace_sync_legacy_task();

  create or replace function public.workspace_sync_legacy_note()
  returns trigger language plpgsql set search_path = public as $fn$
  begin
    if tg_op = 'DELETE' then
      if old.asset_type = 'note' then update public.interactions set archived_at = now() where id = old.id; end if;
      return old;
    end if;
    if new.asset_type = 'note' then
      insert into public.interactions (id, client_id, content, follow_up_completed, created_at, updated_at)
      values (new.id, new.client_id, coalesce(nullif(new.value, ''), new.title), true, new.created_at, new.updated_at)
      on conflict (id) do update set content = excluded.content;
    end if;
    return new;
  end;
  $fn$;
  create trigger workspace_sync_legacy_note after insert or update or delete on public.client_assets
    for each row execute function public.workspace_sync_legacy_note();

  create or replace function public.workspace_sync_account_link()
  returns trigger language plpgsql set search_path = public as $fn$
  begin
    if new.account_id is not null and old.account_id is distinct from new.account_id then
      if old.account_id is not null then raise exception 'Account reassignment requires an explicit merge.' using errcode = '23514'; end if;
      update public.client_assets set client_id = new.account_id where lead_id = new.id;
      update public.interactions set client_id = new.account_id where lead_id = new.id;
      update public.tasks set account_id = new.account_id where related_type = 'lead' and related_id = new.id;
      update public.client_activities set client_id = new.account_id where lead_id = new.id;
    end if;
    return null;
  end;
  $fn$;
  create trigger workspace_sync_account_link after update of account_id on public.leads
    for each row execute function public.workspace_sync_account_link();

  create or replace function public.link_lead_account(p_lead_id uuid, p_client_id uuid default null, p_create boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $fn$
  declare lead public.leads%rowtype; linked_account_id uuid;
  begin
    select * into lead from public.leads where id = p_lead_id for update;
    if not found then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
    if lead.account_id is not null then
      if p_client_id is not null and lead.account_id <> p_client_id then raise exception 'This lead is already linked to another account.' using errcode = '23514'; end if;
      return lead.account_id;
    end if;
    if p_client_id is not null then
      if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'Client not found.' using errcode = 'P0002'; end if;
      linked_account_id := p_client_id;
    elsif p_create then
      insert into public.clients (full_name, email, phone, address, source)
      values (lead.full_name, lead.email, lead.phone, lead.address, lead.source) returning id into linked_account_id;
    else
      raise exception 'Choose an existing account or explicitly create one.' using errcode = '22023';
    end if;
    update public.leads set account_id = linked_account_id where id = lead.id;
    return linked_account_id;
  end;
  $fn$;

  create or replace function public.save_note_with_reminder(
    p_id uuid, p_lead_id uuid, p_client_id uuid, p_content text, p_note_type text,
    p_author_id uuid, p_author_name text, p_reminder jsonb default null
  )
  returns jsonb language plpgsql security definer set search_path = public as $fn$
  declare note public.interactions%rowtype; task public.tasks%rowtype; account_id uuid := p_client_id;
  begin
    if p_lead_id is not null and p_client_id is not null then
      raise exception 'Choose exactly one lead or account for this note.' using errcode = '22023';
    end if;
    if p_lead_id is not null then
      select l.account_id into account_id from public.leads l where l.id = p_lead_id for update;
      if not found then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
    elsif p_client_id is not null then
      perform 1 from public.clients where id = p_client_id for update;
      if not found then raise exception 'Client not found.' using errcode = 'P0002'; end if;
    else raise exception 'A note needs a lead or client.' using errcode = '22023';
    end if;
    if nullif(trim(p_content), '') is null or p_note_type is null or p_note_type not in ('general', 'call', 'underwriting', 'service') then
      raise exception 'Valid note content and type are required.' using errcode = '22023';
    end if;
    insert into public.interactions (id, lead_id, client_id, content, note_type, author_id, author_name, follow_up_completed)
    values (p_id, p_lead_id, account_id, trim(p_content), p_note_type, p_author_id, p_author_name, true)
    on conflict (id) do nothing;
    select * into note from public.interactions where id = p_id for update;
    if note.lead_id is distinct from p_lead_id or note.client_id is distinct from account_id
      or note.content <> trim(p_content) or note.note_type <> p_note_type then
      raise exception 'This save id has already been used for a different note.' using errcode = '23505';
    end if;
    if p_reminder is not null then
      if nullif(trim(p_reminder->>'subject'), '') is null or nullif(p_reminder->>'due_date', '') is null
        or coalesce(p_reminder->>'priority', 'medium') not in ('low', 'medium', 'high') then
        raise exception 'A reminder needs an action, date, time and valid priority.' using errcode = '22023';
      end if;
      insert into public.tasks (id, subject, description, kind, due_date, priority, related_type, related_id, account_id, note_id, created_by)
      values (p_id, p_reminder->>'subject', trim(p_content), 'reminder', (p_reminder->>'due_date')::timestamptz,
        coalesce(p_reminder->>'priority', 'medium'), case when p_lead_id is not null then 'lead' else 'client' end,
        coalesce(p_lead_id, p_client_id), account_id, p_id, p_author_name)
      on conflict (id) do nothing;
      select * into task from public.tasks where id = p_id;
      if task.note_id is distinct from p_id or task.subject <> p_reminder->>'subject'
        or task.due_date <> (p_reminder->>'due_date')::timestamptz
        or task.priority <> coalesce(p_reminder->>'priority', 'medium') then
        raise exception 'This save id has already been used for a different reminder.' using errcode = '23505';
      end if;
    end if;
    return jsonb_build_object('note', to_jsonb(note), 'reminder', case when task.id is null then null else to_jsonb(task) end);
  end;
  $fn$;

  create or replace function public.dispatch_due_reminders()
  returns integer language plpgsql security definer set search_path = public as $fn$
  declare inserted integer;
  begin
    insert into public.notifications (client_id, task_id, reminder_version, type, message, href, read)
    select t.account_id, t.id, t.reminder_version, 'reminder', 'Reminder due: ' || t.subject,
      case when t.related_type = 'lead' then '/leads?lead=' || t.related_id::text
        when t.related_type = 'client' then '/clients/' || t.related_id::text || '?tab=tasks' else '/tasks' end, false
    from public.tasks t
    where t.kind = 'reminder' and t.status = 'open' and t.due_date <= now()
    on conflict (task_id, reminder_version) where task_id is not null do nothing;
    get diagnostics inserted = row_count;
    return inserted;
  end;
  $fn$;

  create or replace function public.create_intake_work(p_event_id uuid)
  returns void language plpgsql security definer set search_path = public as $fn$
  declare event public.lead_intake_events%rowtype; lead public.leads%rowtype; local_due timestamp; due timestamptz;
  begin
    select * into event from public.lead_intake_events where id = p_event_id;
    select * into lead from public.leads where id = event.lead_id;
    if not found then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
    local_due := date_trunc('day', now() at time zone 'America/Phoenix') + interval '16 hours';
    if local_due < (now() at time zone 'America/Phoenix') + interval '15 minutes' then local_due := local_due + interval '1 day'; end if;
    while extract(dow from local_due) in (0, 6) loop local_due := local_due + interval '1 day'; end loop;
    due := local_due at time zone 'America/Phoenix';
    insert into public.tasks (subject, description, due_date, priority, related_type, related_id, account_id, intake_event_id)
    values (lead.full_name || ': respond to website request',
      'Review the submitted answers, confirm what they need, and contact them using their requested method.',
      due, 'high', 'lead', lead.id, lead.account_id, event.id)
    on conflict (intake_event_id) where intake_event_id is not null do nothing;
    insert into public.notifications (client_id, intake_event_id, type, message, href, read)
    values (lead.account_id, event.id, 'new_lead', lead.full_name || ' submitted a website request. Review their answers.',
      '/leads?lead=' || lead.id::text || '&intake=' || event.id::text, false)
    on conflict (intake_event_id) where intake_event_id is not null do nothing;
  end;
  $fn$;

  create or replace function public.workspace_capture_intake()
  returns trigger language plpgsql set search_path = public as $fn$
  declare key text; event_id uuid; owner_id uuid; submitted timestamptz;
  begin
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'new' then
      update public.lead_intake_events set handled_at = now() where lead_id = new.id and handled_at is null;
    end if;
    if new.form_payload is null or not public.workspace_has_website_submission(new.source, new.form_payload) then return null; end if;
    if tg_op = 'UPDATE' and new.form_payload is not distinct from old.form_payload then return null; end if;
    key := public.workspace_submission_key(new.id, new.form_payload);
    select e.lead_id into owner_id from public.lead_intake_events e where submission_key = key;
    if owner_id is not null then
      if owner_id <> new.id then raise exception 'This website submission already belongs to another lead.' using errcode = '23505'; end if;
      return null;
    end if;
    submitted := public.workspace_intake_date(new.form_payload);
    insert into public.lead_intake_events (lead_id, submission_key, source_submission_id, submitted_at, time_basis, snapshot)
    values (new.id, key, coalesce(nullif(new.form_payload->>'id', ''), nullif(new.form_payload->>'submission_id', '')),
      coalesce(submitted, now()), case when submitted is null then 'received' else 'submitted' end, new.form_payload - 'previous_submissions')
    returning id into event_id;
    if tg_op = 'INSERT' then perform public.create_intake_work(event_id); end if;
    return null;
  end;
  $fn$;
  create trigger workspace_capture_intake after insert or update of form_payload, status on public.leads
    for each row execute function public.workspace_capture_intake();

  -- Return payload and the events it represents from one database snapshot.
  create or replace function public.lead_profile_snapshot(p_lead_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $fn$
    select to_jsonb(l) || jsonb_build_object('intake_event_ids', coalesce((
      select jsonb_agg(e.id order by e.submitted_at desc, e.received_at desc, e.id desc)
      from public.lead_intake_events e where e.lead_id = l.id
        and e.opened_at is null and e.dismissed_at is null and e.handled_at is null
    ), '[]'::jsonb))
    from public.leads l where l.id = p_lead_id;
  $fn$;

  create or replace function public.acknowledge_intake_events(p_ids uuid[], p_action text, p_actor uuid)
  returns integer language plpgsql security definer set search_path = public as $fn$
  declare expected integer; matched integer; acknowledged_at timestamptz := clock_timestamp();
  begin
    if coalesce(cardinality(p_ids), 0) = 0 or array_position(p_ids, null) is not null
      or p_action is null or p_action not in ('opened', 'dismissed', 'handled') then
      raise exception 'Valid submissions and an acknowledgment action are required.' using errcode = '22023';
    end if;
    select count(distinct id) into expected from unnest(p_ids) as ids(id);
    perform 1 from public.lead_intake_events where id = any(p_ids) for update;
    get diagnostics matched = row_count;
    if matched <> expected then raise exception 'A website request no longer exists. Refresh the queue.' using errcode = 'P0002'; end if;
    update public.lead_intake_events set
      opened_at = case when p_action = 'opened' then coalesce(opened_at, acknowledged_at) else opened_at end,
      dismissed_at = case when p_action = 'dismissed' then coalesce(dismissed_at, acknowledged_at) else dismissed_at end,
      handled_at = case when p_action = 'handled' then coalesce(handled_at, acknowledged_at) else handled_at end,
      acknowledged_by = coalesce(acknowledged_by, p_actor)
    where id = any(p_ids);
    return matched;
  end;
  $fn$;

  create or replace function public.workspace_preserve_confirmed_identity()
  returns trigger language plpgsql set search_path = public as $fn$
  begin
    if new.form_payload is distinct from old.form_payload
      and public.workspace_has_website_submission(new.source, new.form_payload) then
      if old.confirmed_fields ? 'full_name' then new.full_name := old.full_name; end if;
      if old.confirmed_fields ? 'email' then new.email := old.email; end if;
      if old.confirmed_fields ? 'phone' then new.phone := old.phone; end if;
      if old.confirmed_fields ? 'address' then new.address := old.address; end if;
      if old.confirmed_fields ? 'line_of_business' then new.line_of_business := old.line_of_business; end if;
    end if;
    return new;
  end;
  $fn$;
  create trigger workspace_preserve_confirmed_identity before update of form_payload on public.leads
    for each row execute function public.workspace_preserve_confirmed_identity();

  create or replace function public.apply_website_resubmission(
    p_lead_id uuid, p_payload jsonb, p_full_name text default null, p_email text default null, p_phone text default null
  )
  returns boolean language plpgsql security definer set search_path = public as $fn$
  declare lead public.leads%rowtype; key text; payload jsonb; history jsonb; event_id uuid;
  begin
    select * into lead from public.leads where id = p_lead_id for update;
    if not found then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
    key := public.workspace_submission_key(lead.id, p_payload);
    if exists (select 1 from public.lead_intake_events where submission_key = key) then return false; end if;
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
  $fn$;

  create or replace function public.workspace_protect_lead_history()
  returns trigger language plpgsql set search_path = public as $fn$
  begin
    if old.account_id is null and (
      exists (select 1 from public.tasks where related_type = 'lead' and related_id = old.id)
      or exists (select 1 from public.client_assets where lead_id = old.id)
      or exists (select 1 from public.interactions where lead_id = old.id)
    ) then
      raise exception 'This lead has saved work. Mark it inactive instead of deleting its history.' using errcode = '23514';
    end if;
    if old.account_id is not null then
      update public.tasks set related_type = 'client', related_id = old.account_id where related_type = 'lead' and related_id = old.id;
    end if;
    return old;
  end;
  $fn$;
  create trigger workspace_protect_lead_history before delete on public.leads for each row execute function public.workspace_protect_lead_history();

  create or replace function public.patch_lead_profile(p_lead_id uuid, p_changes jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $fn$
  declare original public.leads%rowtype; changed public.leads%rowtype; confirmations jsonb;
  begin
    select * into original from public.leads where id = p_lead_id for update;
    if not found then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
    if exists (select 1 from jsonb_object_keys(p_changes) field where field not in (
      'full_name', 'phone', 'email', 'address', 'zip', 'state', 'business', 'primary_coverage',
      'vehicle_details', 'details', 'line_of_business', 'source', 'status', 'stage_changed_at', 'estimated_premium'
    )) then raise exception 'Unsupported profile field.' using errcode = '22023'; end if;
    changed := jsonb_populate_record(original, p_changes);
    if nullif(trim(changed.full_name), '') is null then raise exception 'A lead needs a name.' using errcode = '22023'; end if;
    select coalesce(jsonb_object_agg(field, jsonb_build_object('confirmed_at', now())), '{}'::jsonb) into confirmations
    from jsonb_object_keys(p_changes) field where field in ('full_name', 'phone', 'email', 'address', 'line_of_business');
    update public.leads set full_name = changed.full_name, phone = changed.phone, email = changed.email,
      address = changed.address, zip = changed.zip, state = changed.state, business = changed.business,
      primary_coverage = changed.primary_coverage, vehicle_details = changed.vehicle_details, details = changed.details,
      line_of_business = changed.line_of_business, source = changed.source, status = changed.status,
      stage_changed_at = changed.stage_changed_at, estimated_premium = changed.estimated_premium,
      confirmed_fields = original.confirmed_fields || confirmations
    where id = p_lead_id returning * into changed;
    if original.account_id is not null then
      update public.clients set
        full_name = case when p_changes ? 'full_name' then changed.full_name else full_name end,
        phone = case when p_changes ? 'phone' then changed.phone else phone end,
        email = case when p_changes ? 'email' then changed.email else email end,
        address = case when p_changes ? 'address' then changed.address else address end
      where id = original.account_id;
    end if;
    return to_jsonb(changed);
  end;
  $fn$;

  revoke all on function public.link_lead_account(uuid, uuid, boolean) from public, anon, authenticated;
  revoke all on function public.save_note_with_reminder(uuid, uuid, uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;
  revoke all on function public.dispatch_due_reminders() from public, anon, authenticated;
  revoke all on function public.create_intake_work(uuid) from public, anon, authenticated;
  revoke all on function public.apply_website_resubmission(uuid, jsonb, text, text, text) from public, anon, authenticated;
  revoke all on function public.patch_lead_profile(uuid, jsonb) from public, anon, authenticated;
  revoke all on function public.lead_profile_snapshot(uuid) from public, anon, authenticated;
  revoke all on function public.acknowledge_intake_events(uuid[], text, uuid) from public, anon, authenticated;
  grant execute on function public.link_lead_account(uuid, uuid, boolean) to service_role;
  grant execute on function public.save_note_with_reminder(uuid, uuid, uuid, text, text, uuid, text, jsonb) to service_role;
  grant execute on function public.dispatch_due_reminders() to service_role;
  grant execute on function public.create_intake_work(uuid) to service_role;
  grant execute on function public.apply_website_resubmission(uuid, jsonb, text, text, text) to service_role;
  grant execute on function public.patch_lead_profile(uuid, jsonb) to service_role;
  grant execute on function public.lead_profile_snapshot(uuid) to service_role;
  grant execute on function public.acknowledge_intake_events(uuid[], text, uuid) to service_role;
  grant all on table public.lead_intake_events to service_role;

  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('crm-due-reminders', '* * * * *', 'select public.dispatch_due_reminders()');
  perform pg_notify('pgrst', 'reload schema');
end
$migration$;
