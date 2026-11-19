begin;

alter table public.policy_change_requests
  add column if not exists request_type text not null default 'other',
  add column if not exists requested_effective_date date,
  add column if not exists carrier_submitted_at timestamptz,
  add column if not exists carrier_confirmed_on date,
  add column if not exists confirmation_reference text,
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid,
  add column if not exists closed_at timestamptz;

alter table public.policy_change_requests
  drop constraint if exists policy_change_requests_status_check,
  drop constraint if exists policy_change_requests_request_type_check;

alter table public.policy_change_requests
  add constraint policy_change_requests_status_check
    check (status in ('draft', 'submitted', 'waiting_on_carrier', 'waiting_on_client', 'confirmed', 'closed', 'cancelled', 'reopened', 'processed')),
  add constraint policy_change_requests_request_type_check
    check (request_type in ('address_change', 'name_change', 'vehicle_addition', 'vehicle_removal', 'property_addition', 'property_removal', 'endorsement', 'certificate', 'cancellation', 'rewrite', 'other')),
  add constraint policy_change_requests_version_check check (version > 0),
  add constraint policy_change_requests_confirmation_check
    check ((carrier_confirmed_on is null and confirmation_reference is null)
      or (carrier_confirmed_on is not null and nullif(btrim(confirmation_reference), '') is not null)),
  add constraint policy_change_requests_confirmed_evidence_check
    check (status <> 'confirmed' or (carrier_confirmed_on is not null and nullif(btrim(confirmation_reference), '') is not null));

create table if not exists public.policy_change_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.policy_change_requests(id) on delete cascade,
  actor_id uuid,
  event_type text not null check (event_type in ('created', 'updated', 'status_changed')),
  from_status text,
  to_status text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists policy_change_request_events_request_idx
  on public.policy_change_request_events(request_id, created_at, id);

revoke all on public.policy_change_request_events from public, anon, authenticated;

do $patch$
declare definition text; old text; replacement text;
begin
  definition := pg_get_functiondef('public.sync_internal_action(text,text,boolean,text,text,uuid,uuid,text,text,timestamp with time zone,text,boolean)'::regprocedure);
  old := 'service_template:=automation_rule_policy(''service'')->''task_templates''->p_related_type;';
  replacement := 'service_template:=coalesce(automation_rule_policy(''service'')->''task_templates''->p_related_type,
      case when p_related_type=''policy_change_request'' then jsonb_build_object(''description'',''Automatically queued from the source record. Resolve the request in its linked record.'') end);';
  if strpos(definition, old) = 0 then raise exception 'Service task template baseline changed'; end if;
  execute replace(definition, old, replacement);
end;
$patch$;

create or replace function public.record_policy_change_request_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare event_name text;
begin
  if tg_op = 'UPDATE' then
    event_name := case when old.status is distinct from new.status then 'status_changed' else 'updated' end;
    insert into public.policy_change_request_events(request_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, new.updated_by, event_name, old.status, new.status,
      jsonb_build_object('request_type', new.request_type, 'description', new.description,
        'requested_effective_date', new.requested_effective_date,
        'carrier_submitted_at', new.carrier_submitted_at,
        'carrier_confirmed_on', new.carrier_confirmed_on,
        'confirmation_reference', new.confirmation_reference, 'version', new.version));
  else
    insert into public.policy_change_request_events(request_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, coalesce(new.updated_by, new.requested_by), 'created', null, new.status,
      jsonb_build_object('request_type', new.request_type, 'description', new.description,
        'requested_effective_date', new.requested_effective_date, 'version', new.version));
  end if;
  return null;
end;
$$;

create or replace function public.prepare_policy_change_request_update()
returns trigger language plpgsql set search_path=public as $$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := clock_timestamp();
  elsif new.status <> 'closed' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists policy_change_request_version_trigger on public.policy_change_requests;
create trigger policy_change_request_version_trigger
  before update on public.policy_change_requests
  for each row execute function public.prepare_policy_change_request_update();

drop trigger if exists policy_change_request_event_trigger on public.policy_change_requests;
create trigger policy_change_request_event_trigger
  after insert or update on public.policy_change_requests
  for each row execute function public.record_policy_change_request_event();

create or replace function public.sync_service_action(p_kind text, p_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare record_data record; active boolean; href text;
begin
  if p_kind <> 'policy_change_request' then
    if p_kind not in ('claim', 'endorsement', 'certificate') then
      raise exception 'Unsupported service source' using errcode='22023';
    end if;
    select created_at into record_data from (
      select created_at from claims where p_kind='claim' and id=p_id
      union all select created_at from endorsements where p_kind='endorsement' and id=p_id
      union all select created_at from certificates where p_kind='certificate' and id=p_id
    ) source;
    if record_data.created_at is null or not public.automation_rule_allows('service', record_data.created_at) then return null; end if;
    return public.sync_service_action_core(p_kind, p_id);
  end if;
  select request.id, request.status, request.created_at, policy.client_id as account_id, account.full_name
      into record_data
      from policy_change_requests request
      join policies policy on policy.id = request.policy_id
      join clients account on account.id = policy.client_id
      where request.id = p_id;
  if record_data.id is null then return null; end if;
  if not public.automation_rule_allows('service', record_data.created_at) then return null; end if;
  active := lower(record_data.status) not in ('confirmed', 'closed', 'cancelled', 'processed');
  href := '/clients/'||record_data.account_id::text||'?tab=policies&service_request='||p_id::text;
  return public.sync_internal_action('service:'||p_kind||':'||p_id::text,p_id::text,active,'service',
    p_kind,p_id,record_data.account_id,'Review policy change request: '||record_data.full_name,
    href,record_data.created_at,null,public.automation_notification_allows('service_events',record_data.created_at));
end;
$$;

create or replace function public.sync_policy_change_request_service_action()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.sync_service_action('policy_change_request', new.id);
  return new;
end;
$$;

drop trigger if exists policy_change_request_service_action_trigger on public.policy_change_requests;
create trigger policy_change_request_service_action_trigger
  after insert or update of status on public.policy_change_requests
  for each row execute function public.sync_policy_change_request_service_action();

alter table public.claims
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid;

create table if not exists public.claim_record_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete restrict,
  actor_id uuid,
  event_type text not null check (event_type in ('created', 'updated', 'status_changed')),
  from_status text,
  to_status text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists claim_record_events_claim_idx on public.claim_record_events(claim_id, created_at, id);
revoke all on public.claim_record_events from public, anon, authenticated;

create or replace function public.prepare_claim_record_update()
returns trigger language plpgsql set search_path=public as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.record_claim_record_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare event_name text;
begin
  if tg_op = 'UPDATE' then
    event_name := case when old.status is distinct from new.status then 'status_changed' else 'updated' end;
    insert into public.claim_record_events(claim_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, new.updated_by, event_name, old.status, new.status,
      jsonb_build_object('claim_number', new.claim_number, 'type', new.type, 'description', new.description,
        'date_of_loss', new.date_of_loss, 'adjuster_name', new.adjuster_name,
        'adjuster_contact', new.adjuster_contact, 'reserve_amount', new.reserve_amount,
        'payout_amount', new.payout_amount, 'version', new.version));
  else
    insert into public.claim_record_events(claim_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, new.updated_by, 'created', null, new.status,
      jsonb_build_object('claim_number', new.claim_number, 'type', new.type, 'description', new.description,
        'date_of_loss', new.date_of_loss, 'adjuster_name', new.adjuster_name,
        'adjuster_contact', new.adjuster_contact, 'reserve_amount', new.reserve_amount,
        'payout_amount', new.payout_amount, 'version', new.version));
  end if;
  return null;
end;
$$;

drop trigger if exists claim_record_version_trigger on public.claims;
create trigger claim_record_version_trigger before update on public.claims
  for each row execute function public.prepare_claim_record_update();
drop trigger if exists claim_record_event_trigger on public.claims;
create trigger claim_record_event_trigger after insert or update on public.claims
  for each row execute function public.record_claim_record_event();

revoke all on function public.record_policy_change_request_event() from public, anon, authenticated;
revoke all on function public.prepare_policy_change_request_update() from public, anon, authenticated;
revoke all on function public.sync_policy_change_request_service_action() from public, anon, authenticated;
revoke all on function public.prepare_claim_record_update() from public, anon, authenticated;
revoke all on function public.record_claim_record_event() from public, anon, authenticated;
revoke all on function public.sync_service_action(text, uuid) from public, anon, authenticated;

commit;
