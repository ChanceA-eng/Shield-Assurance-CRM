begin;

alter table public.certificates
  add column if not exists requested_at timestamptz,
  add column if not exists requested_for date,
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists issued_by uuid,
  add column if not exists document_id uuid,
  add column if not exists delivery_reported_at timestamptz,
  add column if not exists delivery_method text,
  add column if not exists delivery_reference text,
  add column if not exists delivery_reported_by uuid;

update public.certificates set requested_at = created_at where requested_at is null;
alter table public.certificates
  alter column requested_at set default clock_timestamp(),
  alter column requested_at set not null,
  alter column issue_date drop not null,
  alter column status set default 'requested',
  add constraint certificates_version_check check (version > 0),
  add constraint certificates_delivery_report_check
    check ((delivery_reported_at is null and delivery_method is null and delivery_reported_by is null)
      or (delivery_reported_at is not null and nullif(btrim(delivery_method), '') is not null and delivery_reported_by is not null)),
  add constraint certificates_delivery_status_check
    check (status <> 'delivery_reported' or delivery_reported_at is not null);

alter table public.certificates
  add constraint certificates_document_id_fkey
  foreign key (document_id) references public.client_files(id) on delete restrict;

create table if not exists public.certificate_record_events (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.certificates(id) on delete restrict,
  actor_id uuid,
  event_type text not null check (event_type in ('created', 'updated', 'status_changed')),
  from_status text,
  to_status text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists certificate_record_events_certificate_idx
  on public.certificate_record_events(certificate_id, created_at, id);
revoke all on public.certificate_record_events from public, anon, authenticated;

create or replace function public.prepare_certificate_record_update()
returns trigger language plpgsql set search_path=public as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.validate_certificate_document()
returns trigger language plpgsql set search_path=public as $$
declare attached_file public.client_files%rowtype;
begin
  if new.document_id is null then return new; end if;
  select * into attached_file from public.client_files where id=new.document_id;
  if attached_file.id is null
    or attached_file.client_id is distinct from new.client_id
    or attached_file.status is distinct from 'uploaded'
    or attached_file.metadata->>'source_kind' is distinct from 'stored'
    or nullif(attached_file.metadata->'storage'->>'path', '') is null then
    raise exception 'Choose an uploaded private account document for this certificate.' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function public.record_certificate_record_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare event_name text;
begin
  if tg_op = 'UPDATE' then
    event_name := case when old.status is distinct from new.status then 'status_changed' else 'updated' end;
    insert into public.certificate_record_events(certificate_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, new.updated_by, event_name, old.status, new.status,
      jsonb_build_object('certificate_holder', new.certificate_holder, 'description', new.description,
        'requested_for', new.requested_for, 'issue_date', new.issue_date, 'document_id', new.document_id,
        'reviewed_at', new.reviewed_at, 'issued_by', new.issued_by,
        'delivery_reported_at', new.delivery_reported_at, 'delivery_method', new.delivery_method,
        'delivery_reference', new.delivery_reference, 'version', new.version));
  else
    insert into public.certificate_record_events(certificate_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, new.updated_by, 'created', null, new.status,
      jsonb_build_object('certificate_holder', new.certificate_holder, 'description', new.description,
        'requested_for', new.requested_for, 'issue_date', new.issue_date,
        'delivery_reported_at', new.delivery_reported_at, 'delivery_method', new.delivery_method,
        'delivery_reference', new.delivery_reference, 'version', new.version));
  end if;
  return null;
end;
$$;

drop trigger if exists certificate_record_version_trigger on public.certificates;
create trigger certificate_record_version_trigger before update on public.certificates
  for each row execute function public.prepare_certificate_record_update();
drop trigger if exists certificate_document_validation_trigger on public.certificates;
create trigger certificate_document_validation_trigger before insert or update of document_id, client_id on public.certificates
  for each row execute function public.validate_certificate_document();
drop trigger if exists certificate_record_event_trigger on public.certificates;
create trigger certificate_record_event_trigger after insert or update on public.certificates
  for each row execute function public.record_certificate_record_event();

do $patch$
declare definition text;
  old text := $old$active:=lower(record_data.status) in ('open','pending','requested','in_progress','in progress','submitted');$old$;
  replacement text := $new$active:=lower(record_data.status) in ('open','pending','requested','in_progress','in progress','submitted','in_review','issued');$new$;
begin
  definition := pg_get_functiondef('public.sync_service_action_core(text,uuid)'::regprocedure);
  if strpos(definition, old) = 0 then raise exception 'Service action status baseline changed'; end if;
  execute replace(definition, old, replacement);
end;
$patch$;

revoke all on function public.prepare_certificate_record_update() from public, anon, authenticated;
revoke all on function public.validate_certificate_document() from public, anon, authenticated;
revoke all on function public.record_certificate_record_event() from public, anon, authenticated;

commit;
