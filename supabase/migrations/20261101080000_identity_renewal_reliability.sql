-- Unapplied Phase 1 migration. Requires the shared-account-workspace migration.
begin;

create table public.policy_issue_operations (
  request_id uuid primary key,
  request jsonb not null,
  policy_id uuid not null,
  created_at timestamptz not null default now()
);
create table public.lead_merge_archive (
  absorbed_id uuid primary key,
  survivor_id uuid not null,
  snapshot jsonb not null,
  merged_at timestamptz not null default now()
);
alter table public.policy_issue_operations enable row level security;
alter table public.lead_merge_archive enable row level security;
alter table public.policies add column issued_lead_id uuid references public.leads(id) on delete set null;
alter table public.tasks
  add column renewal_policy_id uuid references public.policies(id) on delete set null,
  add column renewal_term date,
  add column renewal_canonical boolean not null default false,
  add column automation_provenance jsonb not null default '{}'::jsonb;
create unique index tasks_renewal_term_unique on public.tasks(renewal_policy_id, renewal_term)
  where renewal_canonical;
alter table public.notifications add column renewal_key text;
create unique index notifications_renewal_key_unique on public.notifications(renewal_key) where renewal_key is not null;

create or replace function public.issue_policy_atomic(p_request_id uuid, p_account_id uuid, p_lead_id uuid, p_policy jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  request jsonb := jsonb_build_object('account_id', p_account_id, 'lead_id', p_lead_id, 'policy', p_policy);
  previous public.policy_issue_operations%rowtype;
  policy public.policies%rowtype;
  lead public.leads%rowtype;
begin
  if p_request_id is null or p_account_id is null or jsonb_typeof(p_policy) <> 'object' then
    raise exception 'An issuance ID, explicit account and policy are required.' using errcode = '22023';
  end if;
  -- Locks retries before any side effects; account contacts are never updated.
  perform pg_advisory_xact_lock(hashtextextended('issue:' || p_request_id::text, 0));
  select * into previous from public.policy_issue_operations where request_id = p_request_id;
  if found then
    if previous.request <> request then raise exception 'Issuance ID reused with different details.' using errcode = '23505'; end if;
    select * into policy from public.policies where id = previous.policy_id;
    if not found then raise exception 'Previously issued policy no longer exists.' using errcode = 'P0002'; end if;
    return jsonb_build_object('policy', to_jsonb(policy), 'created', false);
  end if;
  if p_lead_id is not null then
    select * into lead from public.leads where id = p_lead_id for update;
    if not found then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
    if lead.account_id is not null and lead.account_id <> p_account_id then
      raise exception 'Lead is linked to another account.' using errcode = '23514';
    end if;
  end if;
  perform 1 from public.clients where id = p_account_id for key share;
  if not found then raise exception 'Account not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from jsonb_object_keys(p_policy) k where k not in (
    'account_id','client_id','insured_name','phone','email','address','carrier','line_of_business','sub_type','premium',
    'policy_number','effective_date','renewal_date','expiration_date','billing_type','source','prior_policy_id','status'
  )) then raise exception 'Unsupported policy fields.' using errcode = '22023'; end if;
  if coalesce(p_policy->>'account_id', p_account_id::text) <> p_account_id::text
    or coalesce(p_policy->>'client_id', p_account_id::text) <> p_account_id::text then
    raise exception 'Conflicting policy account IDs.' using errcode = '23514';
  end if;
  select * into policy from jsonb_populate_record(null::public.policies,
    jsonb_build_object('id', gen_random_uuid(), 'client_id', p_account_id, 'account_id', p_account_id,
      'status', 'issued', 'premium', 0, 'source', 'manual', 'created_at', now())
    || p_policy || jsonb_build_object('issued_lead_id', p_lead_id));
  if nullif(trim(policy.insured_name), '') is null or nullif(trim(policy.carrier), '') is null
    or nullif(trim(policy.line_of_business), '') is null or nullif(trim(policy.policy_number), '') is null
    or policy.effective_date is null or policy.expiration_date is null or policy.premium < 0
    or policy.expiration_date < policy.effective_date then
    raise exception 'Valid policy details and term dates are required.' using errcode = '22023';
  end if;
  insert into public.policies select policy.* returning * into policy;
  if p_lead_id is not null then
    update public.leads set account_id = p_account_id, status = 'won', lost_reason = null, stage_changed_at = now()
      where id = p_lead_id;
  end if;
  insert into public.policy_issue_operations(request_id, request, policy_id) values (p_request_id, request, policy.id);
  return jsonb_build_object('policy', to_jsonb(policy), 'created', true);
end;
$fn$;

create or replace function public.update_policy_atomic(p_id uuid, p_updates jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare policy public.policies%rowtype; target uuid;
begin
  select * into policy from public.policies where id = p_id for update;
  if not found then raise exception 'Policy not found.' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_updates) <> 'object' or p_updates = '{}'::jsonb or exists (
    select 1 from jsonb_object_keys(p_updates) k where k not in (
      'account_id','client_id','insured_name','phone','email','address','carrier','line_of_business','sub_type','premium',
      'policy_number','effective_date','renewal_date','expiration_date','billing_type','source','prior_policy_id','status'
    )
  ) then raise exception 'Valid policy updates are required.' using errcode = '22023'; end if;
  if p_updates ? 'account_id' or p_updates ? 'client_id' then
    target := coalesce(p_updates->>'account_id', p_updates->>'client_id')::uuid;
    if target is null or (p_updates ? 'account_id' and p_updates ? 'client_id'
      and p_updates->>'account_id' is distinct from p_updates->>'client_id') then
      raise exception 'Select one valid account.' using errcode = '22023';
    end if;
    if policy.issued_lead_id is not null and target is distinct from coalesce(policy.account_id, policy.client_id) then
      raise exception 'A placed policy cannot be reassigned away from its linked lead.' using errcode = '23514';
    end if;
    perform 1 from public.clients where id = target for key share;
    if not found then raise exception 'Account not found.' using errcode = 'P0002'; end if;
    p_updates := p_updates || jsonb_build_object('account_id', target, 'client_id', target);
  end if;
  select * into policy from jsonb_populate_record(policy, p_updates);
  if policy.premium is null or policy.premium < 0 or policy.effective_date is null or policy.expiration_date is null
    or policy.expiration_date < policy.effective_date or nullif(trim(policy.insured_name), '') is null
    or nullif(trim(policy.carrier), '') is null or nullif(trim(policy.line_of_business), '') is null then
    raise exception 'Invalid policy details.' using errcode = '22023';
  end if;
  update public.policies set
    client_id = policy.client_id, account_id = policy.account_id, insured_name = policy.insured_name,
    phone = policy.phone, email = policy.email, address = policy.address, carrier = policy.carrier,
    line_of_business = policy.line_of_business, sub_type = policy.sub_type, premium = policy.premium,
    policy_number = policy.policy_number, effective_date = policy.effective_date, renewal_date = policy.renewal_date,
    expiration_date = policy.expiration_date, billing_type = policy.billing_type, source = policy.source,
    prior_policy_id = policy.prior_policy_id, status = policy.status where id = p_id returning * into policy;
  return jsonb_build_object('policy', to_jsonb(policy));
end;
$fn$;

-- Survivor wins scalar conflicts; arrays are a lossless union. Raw source rows are archived separately.
create or replace function public.merge_lead_json(p_preferred jsonb, p_incoming jsonb)
returns jsonb language plpgsql immutable set search_path = public as $fn$
declare result jsonb := p_preferred; item record;
begin
  if p_preferred is null or p_preferred in ('null'::jsonb, '""'::jsonb, '{}'::jsonb, '[]'::jsonb) then return p_incoming; end if;
  if jsonb_typeof(p_preferred) = 'object' and jsonb_typeof(p_incoming) = 'object' then
    for item in select * from jsonb_each(p_incoming) loop
      result := jsonb_set(result, array[item.key], coalesce(public.merge_lead_json(result->item.key, item.value), 'null'::jsonb));
    end loop;
  elsif jsonb_typeof(p_preferred) = 'array' and jsonb_typeof(p_incoming) = 'array' then
    select coalesce(jsonb_agg(value order by position), '[]'::jsonb) into result from (
      select value, min(position) position from jsonb_array_elements(p_preferred || p_incoming) with ordinality a(value, position) group by value
    ) items;
  end if;
  return result;
end;
$fn$;

create or replace function public.merge_leads_atomic(p_survivor_id uuid, p_merge_ids uuid[], p_fields jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  ids uuid[]; absorbed uuid[]; survivor public.leads%rowtype; other public.leads%rowtype;
  merged jsonb; column_name text; relation record; account uuid; expected integer; matched integer;
  active_id uuid; fields jsonb;
begin
  if p_survivor_id is null or coalesce(cardinality(p_merge_ids), 0) = 0 or array_position(p_merge_ids, null) is not null
    or p_survivor_id = any(p_merge_ids) or jsonb_typeof(p_fields) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_fields) k where k not in (
      'full_name','email','phone','address','line_of_business','estimated_premium'
    )) then raise exception 'Valid distinct leads and reviewed fields are required.' using errcode = '22023'; end if;
  select array_agg(distinct id order by id) into absorbed from unnest(p_merge_ids) a(id);
  ids := array_append(absorbed, p_survivor_id);
  -- Serialize all merges, then lock parents in deterministic order against concurrent intake/link/save operations.
  perform pg_advisory_xact_lock(hashtextextended('crm:lead-merge', 0));
  perform 1 from public.leads where id = any(ids) order by id for update;
  get diagnostics matched = row_count;
  expected := cardinality(ids);
  if matched <> expected then
    if exists (select 1 from public.leads where id = p_survivor_id) and not exists (
      select 1 from unnest(absorbed) a(id) where not exists (
        select 1 from public.lead_merge_archive m where m.absorbed_id = a.id and m.survivor_id = p_survivor_id
      )
    ) then return jsonb_build_object('ok', true, 'survivor_id', p_survivor_id, 'merged', cardinality(absorbed), 'replayed', true); end if;
    raise exception 'A requested lead no longer exists. Refresh before merging.' using errcode = 'P0002';
  end if;
  if (select count(distinct account_id) from public.leads where id = any(ids)) > 1 then
    raise exception 'Leads linked to different accounts cannot be merged.' using errcode = '23514';
  end if;
  select account_id into account from public.leads where id = any(ids) and account_id is not null limit 1;
  select * into survivor from public.leads where id = p_survivor_id;
  merged := to_jsonb(survivor);
  for other in select * from public.leads where id = any(absorbed) order by id loop
    insert into public.lead_merge_archive(absorbed_id, survivor_id, snapshot)
      values (other.id, p_survivor_id, to_jsonb(other));
    merged := public.merge_lead_json(merged, to_jsonb(other));
  end loop;
  merged := jsonb_set(merged, '{form_payload}', coalesce(nullif(merged->'form_payload', 'null'::jsonb), '{}'::jsonb)
    || jsonb_build_object('merged_from', coalesce(merged#>'{form_payload,merged_from}', '[]'::jsonb) || (
      select jsonb_agg(jsonb_build_object('id', id, 'full_name', full_name, 'merged_at', now(), 'snapshot', to_jsonb(l)))
        from public.leads l where id = any(absorbed)
    )));
  -- Preserve the old max-premium fallback unless the agent deliberately selects another value.
  select jsonb_set(merged, '{estimated_premium}', coalesce(to_jsonb(max(estimated_premium)), 'null'::jsonb))
    into merged from public.leads where id = any(ids);
  -- Owned-record guards validate the destination lead during child reassignment.
  update public.leads set account_id = account where id = p_survivor_id;
  -- Repoint every actual lead FK, including intake snapshots, messages, notes, assets, import rows and policies.
  -- Keep exactly one live outreach enrollment, preserving every other enrollment/outbox row.
  select id into active_id from public.sequence_enrollments where lead_id = any(ids) and status in ('active','paused')
    order by (lead_id = p_survivor_id) desc, enrolled_at, id limit 1 for update;
  update public.sequence_enrollments set status = 'cancelled', ended_at = now(),
    ended_reason = concat_ws('; ', ended_reason, 'Lead merge: retained enrollment ' || active_id::text)
    where lead_id = any(ids) and status in ('active','paused') and id <> active_id;
  for relation in
    select ns.nspname schema_name, cls.relname table_name, att.attname column_name
    from pg_constraint c join pg_class cls on cls.oid = c.conrelid
      join pg_namespace ns on ns.oid = cls.relnamespace
      join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.leads'::regclass
      and cardinality(c.conkey) = 1 and ns.nspname = 'public'
    order by cls.relname, att.attname
  loop
    execute format('update %I.%I set %I = $1 where %I = any($2)',
      relation.schema_name, relation.table_name, relation.column_name, relation.column_name) using p_survivor_id, absorbed;
  end loop;
  for relation in
    select c.table_name from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'related_type'
      and exists(select 1 from information_schema.tables t where t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE')
      and c.table_name in (select c2.table_name from information_schema.columns c2 where c2.table_schema = 'public' and c2.column_name = 'related_id')
  loop
    execute format('update public.%I set related_id = $1 where related_type = ''lead'' and related_id = any($2)', relation.table_name)
      using p_survivor_id, absorbed;
  end loop;
  -- Inbound email/SMS currently store their lead relation in JSON metadata, not a foreign key.
  for relation in
    select c.table_name from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'metadata' and c.data_type = 'jsonb'
        and exists(select 1 from information_schema.tables t where t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE')
  loop
    execute format('update public.%I set metadata = jsonb_set(metadata, ''{lead_id}'', to_jsonb($1::text))
      where metadata->>''lead_id'' = any($2)', relation.table_name)
      using p_survivor_id, array(select id::text from unnest(absorbed) a(id));
  end loop;
  if account is not null then
    update public.communication_log set client_id = account
      where metadata->>'lead_id' = p_survivor_id::text and client_id is null;
  end if;
  update public.notifications n set href = replace(n.href, 'lead=' || a.id::text, 'lead=' || p_survivor_id::text)
    from unnest(absorbed) a(id) where n.href like '%lead=' || a.id::text || '%';
  update public.lead_merge_archive set survivor_id = p_survivor_id where survivor_id = any(absorbed);
  -- Fill ownership on legacy children that are not normalized by a row trigger.
  if account is not null then
    update public.client_assets set client_id = account where lead_id = p_survivor_id and client_id is null;
    update public.interactions set client_id = account where lead_id = p_survivor_id and client_id is null;
    update public.client_activities set client_id = account where lead_id = p_survivor_id and client_id is null;
    update public.tasks set account_id = account where related_type = 'lead' and related_id = p_survivor_id and account_id is null;
  end if;
  update public.leads set form_payload = merged->'form_payload' where id = p_survivor_id;
  foreach column_name in array array['industry','category','business','website','est_employees','est_revenue','risk_exposure',
    'details','zip','state','primary_coverage','vehicle_details','confirmed_fields'] loop
    execute format('update public.leads set %I = (jsonb_populate_record(null::public.leads, $1)).%I where id = $2',
      column_name, column_name) using merged, p_survivor_id;
  end loop;
  fields := jsonb_build_object('full_name', merged->'full_name', 'email', merged->'email', 'phone', merged->'phone',
    'address', merged->'address', 'line_of_business', merged->'line_of_business', 'estimated_premium', merged->'estimated_premium') || p_fields;
  select * into survivor from jsonb_populate_record(survivor, fields);
  if nullif(trim(survivor.full_name), '') is null or survivor.estimated_premium < 0 then
    raise exception 'Invalid reviewed lead fields.' using errcode = '22023';
  end if;
  update public.leads set full_name = survivor.full_name, email = survivor.email, phone = survivor.phone,
    address = survivor.address, line_of_business = survivor.line_of_business, estimated_premium = survivor.estimated_premium
    where id = p_survivor_id;
  delete from public.leads where id = any(absorbed);
  return jsonb_build_object('ok', true, 'survivor_id', p_survivor_id, 'merged', cardinality(absorbed));
end;
$fn$;

create or replace function public.reconcile_legacy_renewal_tasks(p_policy_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  policy public.policies%rowtype; task public.tasks%rowtype; canonical uuid; term date; owner uuid;
  count integer := 0; milestone integer; alert_message text; notification_id uuid; notification_key text; label text;
begin
  for policy in select * from public.policies where p_policy_id is null or id = p_policy_id order by id for update loop
    term := coalesce(policy.renewal_date, policy.expiration_date);
    owner := coalesce(policy.account_id, policy.client_id);
    if term is null or owner is null then continue; end if;
    update public.tasks set
      status = case when status = 'open' then 'cancelled' else status end,
      automation_provenance = automation_provenance || jsonb_build_object('superseded_term', term,
        'previous_status', status, 'superseded_at', now())
      where renewal_policy_id = policy.id and renewal_term is distinct from term
        and not automation_provenance ? 'superseded_term';
    select id into canonical from public.tasks where renewal_policy_id = policy.id and renewal_term = term and renewal_canonical;
    for task in select * from public.tasks where
      (related_type = 'policy' and related_id = policy.id and subject like 'Review renewal options for %')
      or (related_type = 'renewal_pipeline' and related_id = policy.id and subject like 'Renewal pipeline initialized for %')
      or (related_type = 'client' and related_id = owner and description like '%[renewal:' || policy.id::text || ':' || term::text || ']%')
      order by (renewal_canonical) desc, (status <> 'open') desc, created_at, id for update
    loop
      if task.automation_provenance ? 'renewal_reconciled' then continue; end if;
      if canonical is null then canonical := task.id; end if;
      update public.tasks set renewal_policy_id = policy.id, renewal_term = term,
        renewal_canonical = (id = canonical), account_id = owner, related_type = 'client', related_id = owner,
        description = coalesce(description, '') || case when position('[renewal:' || policy.id::text || ':' || term::text || ']' in coalesce(description,'')) = 0
          then E'\n[renewal:' || policy.id::text || ':' || term::text || ']' else '' end,
        status = case when id <> canonical and status = 'open' then 'cancelled' else status end,
        automation_provenance = automation_provenance || jsonb_build_object('renewal_reconciled', now(),
          'original', to_jsonb(task), 'canonical_task_id', canonical)
      where id = task.id;
      count := count + 1;
    end loop;
    -- Adopt an existing radar alert before enabling the unique milestone key; leave duplicates as historical rows.
    foreach milestone in array array[45,30,15,7,0] loop
      notification_key := policy.id::text || ':' || term::text || ':' || milestone::text;
      if exists(select 1 from public.notifications where renewal_key = notification_key) then continue; end if;
      label := concat_ws(' ', nullif(policy.carrier, ''), nullif(policy.line_of_business, ''));
      alert_message := 'Renewal ' || case when milestone = 0 then 'is due now' else 'is within ' || milestone::text || ' days' end
        || ': ' || coalesce(nullif(trim(policy.insured_name), ''), 'Policy')
        || case when label <> '' then ' (' || label || ')' else '' end || ' renews ' || term::text || '.';
      select id into notification_id from public.notifications n where n.type = 'renewal' and n.message = alert_message
        and n.renewal_key is null order by created_at, id limit 1 for update;
      if notification_id is not null then
        update public.notifications set renewal_key = notification_key where id = notification_id;
      end if;
    end loop;
  end loop;
  return count;
end;
$fn$;

create or replace function public.persist_renewal_radar(
  p_policy_id uuid, p_renewal_date date, p_milestone integer, p_task jsonb, p_message text
)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare policy public.policies%rowtype; task public.tasks%rowtype; owner uuid; inserted integer := 0; escalated integer := 0; notified integer := 0;
begin
  select * into policy from public.policies where id = p_policy_id for update;
  if not found then raise exception 'Policy no longer exists.' using errcode = 'P0002'; end if;
  owner := coalesce(policy.account_id, policy.client_id);
  if owner is null or p_renewal_date is distinct from coalesce(policy.renewal_date, policy.expiration_date)
    or lower(policy.status) not in ('active','issued','bound','in_force','inforce') then
    raise exception 'Policy changed during renewal processing. Retry radar.' using errcode = '40001';
  end if;
  if p_milestone is null or p_milestone not in (45,30,15,7,0) or p_task->>'priority' not in ('medium','high') then
    raise exception 'Invalid renewal milestone.' using errcode = '22023';
  end if;
  select * into task from public.tasks where renewal_policy_id = p_policy_id and renewal_term = p_renewal_date and renewal_canonical for update;
  if not found then
    insert into public.tasks(subject, description, due_date, status, priority, kind, related_type, related_id, account_id,
      renewal_policy_id, renewal_term, renewal_canonical)
    values (p_task->>'subject', p_task->>'description', (p_task->>'due_date')::timestamptz, 'open', p_task->>'priority',
      'task','client',owner,owner,p_policy_id,p_renewal_date,true);
    inserted := 1;
  elsif task.status = 'open' and task.priority <> 'high' and p_task->>'priority' = 'high' then
    update public.tasks set priority = 'high' where id = task.id;
    escalated := 1;
  end if;
  update public.tasks set account_id = owner, related_type = 'client', related_id = owner
    where renewal_policy_id = p_policy_id and renewal_term = p_renewal_date and renewal_canonical
      and (account_id is distinct from owner or related_type is distinct from 'client' or related_id is distinct from owner);
  insert into public.notifications(client_id, type, message, href, read, renewal_key)
    values (owner, 'renewal', p_message, '/clients/' || owner::text || '?tab=policies', false,
      p_policy_id::text || ':' || p_renewal_date::text || ':' || p_milestone::text)
    on conflict (renewal_key) where renewal_key is not null do nothing;
  get diagnostics notified = row_count;
  return jsonb_build_object('tasksCreated', inserted, 'tasksEscalated', escalated, 'notifications', notified);
end;
$fn$;

-- Only server-side authenticated routes/cron may invoke data-changing operations.
revoke all on function public.issue_policy_atomic(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.update_policy_atomic(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.merge_leads_atomic(uuid,uuid[],jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_legacy_renewal_tasks(uuid) from public, anon, authenticated;
revoke all on function public.persist_renewal_radar(uuid,date,integer,jsonb,text) from public, anon, authenticated;
grant execute on function public.issue_policy_atomic(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.update_policy_atomic(uuid,jsonb) to service_role;
grant execute on function public.merge_leads_atomic(uuid,uuid[],jsonb) to service_role;
grant execute on function public.reconcile_legacy_renewal_tasks(uuid) to service_role;
grant execute on function public.persist_renewal_radar(uuid,date,integer,jsonb,text) to service_role;
grant all on public.policy_issue_operations, public.lead_merge_archive to service_role;
commit;
