begin;

alter table public.policy_change_requests
  add column if not exists assigned_to uuid;

create index if not exists policy_change_requests_assigned_status_idx
  on public.policy_change_requests(assigned_to, status);

create table if not exists public.policy_change_request_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.policy_change_requests(id) on delete restrict,
  file_id uuid not null references public.client_files(id) on delete restrict,
  file_snapshot jsonb not null,
  added_by uuid,
  added_at timestamptz not null default clock_timestamp(),
  unique(request_id, file_id)
);

create index if not exists policy_change_request_documents_request_idx
  on public.policy_change_request_documents(request_id, added_at, id);

revoke all on public.policy_change_request_documents from public, anon, authenticated;
grant select, insert on public.policy_change_request_documents to service_role;

create or replace function public.validate_policy_change_request_document()
returns trigger language plpgsql set search_path=public as $$
declare request_account uuid;
  document public.client_files%rowtype;
begin
  select policy.client_id into request_account
    from public.policy_change_requests request
    join public.policies policy on policy.id=request.policy_id
    where request.id=new.request_id;
  select * into document from public.client_files where id=new.file_id;
  if request_account is null or document.id is null or document.client_id is distinct from request_account
    or document.status<>'uploaded'
    or document.metadata->>'source_kind'<>'stored'
    or nullif(document.metadata#>>'{storage,path}','') is null then
    raise exception 'Choose a stored private document uploaded to this account.' using errcode='23514';
  end if;
  new.file_snapshot:=jsonb_build_object('file_name',document.file_name,'file_type',document.file_type,
    'file_size',document.file_size,'source_kind','stored');
  return new;
end;
$$;

drop trigger if exists policy_change_request_document_validate_trigger on public.policy_change_request_documents;
create trigger policy_change_request_document_validate_trigger
  before insert or update on public.policy_change_request_documents
  for each row execute function public.validate_policy_change_request_document();

create or replace function public.record_policy_change_request_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare event_name text;
begin
  if tg_op = 'UPDATE' then
    event_name := case when old.status is distinct from new.status then 'status_changed' else 'updated' end;
    insert into public.policy_change_request_events(request_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, new.updated_by, event_name, old.status, new.status,
      jsonb_build_object('request_type', new.request_type, 'description', new.description,
        'requested_effective_date', new.requested_effective_date, 'assigned_to', new.assigned_to,
        'carrier_submitted_at', new.carrier_submitted_at,
        'carrier_confirmed_on', new.carrier_confirmed_on,
        'confirmation_reference', new.confirmation_reference, 'version', new.version));
  else
    insert into public.policy_change_request_events(request_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, coalesce(new.updated_by, new.requested_by), 'created', null, new.status,
      jsonb_build_object('request_type', new.request_type, 'description', new.description,
        'requested_effective_date', new.requested_effective_date, 'assigned_to', new.assigned_to,
        'version', new.version));
  end if;
  return null;
end;
$$;

create or replace function public.sync_policy_change_request_service_action()
returns trigger language plpgsql security definer set search_path=public as $$
declare assigned_email text;
  action_id uuid;
begin
  action_id:=public.sync_service_action('policy_change_request',new.id);
  select email into assigned_email from public.agency_members
    where user_id=new.assigned_to and active;
  if action_id is not null then
    update public.tasks set assignee=assigned_email where id=action_id;
  end if;
  return new;
end;
$$;

drop trigger if exists policy_change_request_service_action_trigger on public.policy_change_requests;
create trigger policy_change_request_service_action_trigger
  after insert or update of status, assigned_to on public.policy_change_requests
  for each row execute function public.sync_policy_change_request_service_action();

revoke all on function public.validate_policy_change_request_document() from public, anon, authenticated;
revoke all on function public.record_policy_change_request_event() from public, anon, authenticated;
revoke all on function public.sync_policy_change_request_service_action() from public, anon, authenticated;

commit;
