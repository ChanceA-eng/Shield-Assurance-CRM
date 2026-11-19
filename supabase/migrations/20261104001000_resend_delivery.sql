begin;

alter table public.marketing_email_consents alter column recorded_by drop not null;
alter table public.marketing_email_consents
  add column recorded_by_auth uuid references auth.users(id) on delete set null,
  add column revocation_source text;

create table public.resend_send_attempts (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  to_email text not null check(to_email=lower(trim(to_email))),
  subject text not null,
  content_hash text not null,
  purpose text not null check(purpose in ('service','marketing')),
  lead_id uuid references public.leads(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  status text not null default 'sending' check(status in ('sending','accepted')),
  provider_id text unique,
  created_at timestamptz not null default now()
);
create index resend_attempt_recipient_idx on public.resend_send_attempts(to_email,created_at desc);
create table public.resend_delivery_events (
  event_id text primary key,
  attempt_id uuid not null references public.resend_send_attempts(id) on delete cascade,
  type text not null,
  occurred_at timestamptz not null
);
create index resend_event_attempt_idx on public.resend_delivery_events(attempt_id,occurred_at desc);
create table public.email_suppressions (
  email text primary key check(email=lower(trim(email))),
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.resend_send_attempts enable row level security;
alter table public.resend_delivery_events enable row level security;
alter table public.email_suppressions enable row level security;
revoke all on public.resend_send_attempts,public.resend_delivery_events,public.email_suppressions from anon,authenticated;
grant all on public.resend_send_attempts,public.resend_delivery_events,public.email_suppressions to service_role;

create function public.begin_resend_send(
  p_request_key text,p_to text,p_subject text,p_hash text,p_purpose text,
  p_lead_id uuid default null,p_client_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare attempt public.resend_send_attempts%rowtype;
begin
  if nullif(trim(p_request_key),'') is null or length(p_request_key)>256
    or p_to is null or p_to is distinct from lower(trim(p_to)) or p_to not like '%@%'
    or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_purpose is null or p_purpose not in ('service','marketing')
    then raise exception 'Invalid email send details.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('resend:'||p_request_key,0));
  select * into attempt from resend_send_attempts where request_key=p_request_key for update;
  if found then
    if attempt.content_hash<>p_hash then raise exception 'This send request was already used for different content.' using errcode='PT409'; end if;
    return jsonb_build_object('id',attempt.id,'status',attempt.status,'provider_id',attempt.provider_id,'claimed',false);
  end if;
  if exists(select 1 from email_suppressions where email=p_to)
    or exists(select 1 from outreach_opt_outs where email=p_to)
    then raise exception 'This address is blocked from email. Nothing was sent.' using errcode='42501'; end if;
  if p_lead_id is not null and not exists(select 1 from leads where id=p_lead_id and archived_at is null and lower(trim(email))=p_to)
    then raise exception 'Restore the lead and confirm its email before sending.' using errcode='42501'; end if;
  if p_lead_id is not null and not exists(select 1 from marketing_email_consents where email=p_to and revoked_at is null)
    and not exists(select 1 from leads where id=p_lead_id and (
      source='website' or form_payload #>> '{_intake,channel}'='website'
      or form_payload #>> '{metadata,contactConsent,accepted}'='true'))
    and not exists(select 1 from clients where id=p_client_id and email_consent=true and lower(trim(email))=p_to)
    and not exists(select 1 from communication_log where direction='inbound' and lower(metadata->>'from')=p_to)
    then raise exception 'This imported contact has not requested email or given recorded permission.' using errcode='42501'; end if;
  if p_purpose='marketing' and not exists(select 1 from marketing_email_consents where email=p_to and revoked_at is null)
    then raise exception 'Recorded marketing permission is required.' using errcode='42501'; end if;
  insert into resend_send_attempts(request_key,to_email,subject,content_hash,purpose,lead_id,client_id)
    values(p_request_key,p_to,p_subject,p_hash,p_purpose,case when p_client_id is null then p_lead_id else null end,p_client_id) returning * into attempt;
  return jsonb_build_object('id',attempt.id,'status',attempt.status,'claimed',true);
end;
$$;

create function public.finish_resend_send(p_id uuid,p_provider_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if nullif(trim(p_provider_id),'') is null then raise exception 'Missing provider receipt.' using errcode='22023'; end if;
  update resend_send_attempts set status='accepted',provider_id=p_provider_id
    where id=p_id and (provider_id is null or provider_id=p_provider_id);
  if not found then raise exception 'Email acceptance could not be recorded. Do not resend.' using errcode='PT409'; end if;
end;
$$;

create function public.record_resend_event(p_event_id text,p_provider_id text,p_type text,p_occurred_at timestamptz,p_attempt_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare attempt public.resend_send_attempts%rowtype;
begin
  if p_type not in ('email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed')
    then raise exception 'Unsupported email event.' using errcode='22023'; end if;
  select * into attempt from resend_send_attempts where provider_id=p_provider_id or id=p_attempt_id for update;
  -- Purged or unrelated messages do not recreate contact history.
  if not found then return; end if;
  if attempt.provider_id is not null and attempt.provider_id<>p_provider_id
    then raise exception 'Email receipt does not match this send.' using errcode='22023'; end if;
  insert into resend_delivery_events(event_id,attempt_id,type,occurred_at)
    values(p_event_id,attempt.id,p_type,p_occurred_at) on conflict do nothing;
  if not found then return; end if;
  update resend_send_attempts set status='accepted',provider_id=p_provider_id where id=attempt.id;
  if p_type in ('email.bounced','email.complained','email.suppressed') then
    insert into email_suppressions(email,reason) values(attempt.to_email,p_type) on conflict(email) do nothing;
    perform public.process_outreach_reply(null,attempt.to_email,null,'unsubscribe',null);
  end if;
  update outreach_outbox set status='accepted_by_provider',provider='resend',sent_at=coalesce(sent_at,attempt.created_at),error=null
    where 'outreach:'||id::text=attempt.request_key and status in ('sending','acceptance_unknown');
end;
$$;

create function public.unsubscribe_marketing_email(p_email text,p_reason text default 'Recipient used the unsubscribe link.')
returns void language plpgsql security definer set search_path=public as $$
begin
  update marketing_email_consents set revoked_at=now(),revocation_source=p_reason where email=lower(trim(p_email)) and revoked_at is null;
  perform public.process_outreach_reply(null,lower(trim(p_email)),null,'unsubscribe',null);
  update outreach_opt_outs set reason=p_reason where email=lower(trim(p_email));
end;
$$;

create or replace function public.claim_outreach_send(
  p_outbox_id uuid,p_subject text,p_body text,p_expected_revision integer default null
) returns boolean language plpgsql security definer set search_path=public as $$
declare item public.outreach_outbox%rowtype; enrollment public.sequence_enrollments%rowtype; cap integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('outreach-send-cap',0));
  select * into item from outreach_outbox where id=p_outbox_id;
  if item.enrollment_id is not null then
    select * into enrollment from sequence_enrollments where id=item.enrollment_id for update;
    if enrollment.id is null or enrollment.status<>'active' or item.step_number<>enrollment.current_step+1 then return false; end if;
  end if;
  select * into item from outreach_outbox where id=p_outbox_id for update;
  if item.id is null or item.status<>'pending_approval' then return false; end if;
  if p_expected_revision is not null and item.draft_revision<>p_expected_revision then return false; end if;
  if item.requires_manual_approval and p_expected_revision is null then return false; end if;
  if not exists(select 1 from leads l where l.id=item.lead_id and archived_at is null
    and lower(btrim(l.email))=lower(btrim(item.to_email)) and coalesce(l.status,'') not in ('won','lost')
    and coalesce(l.form_payload #>> '{metadata,contactConsent,accepted}','true')<>'false') then return false; end if;
  if exists(select 1 from outreach_opt_outs where email=lower(btrim(item.to_email)))
    or exists(select 1 from email_suppressions where email=lower(btrim(item.to_email)))
    or not exists(select 1 from marketing_email_consents where email=lower(btrim(item.to_email)) and revoked_at is null)
    then return false; end if;
  if exists(select 1 from outreach_outbox o where o.enrollment_id=item.enrollment_id
    and o.step_number=item.step_number and o.id<>item.id
    and o.status in ('sending','acceptance_unknown','accepted_by_provider','sent','failed')) then return false; end if;
  select daily_send_cap into cap from outreach_settings where id=1;
  if (select count(*) from outreach_outbox where status in ('sent','sending','acceptance_unknown','accepted_by_provider')
    and sent_at >= (date_trunc('day',now() at time zone 'America/Phoenix') at time zone 'America/Phoenix')) >= coalesce(cap,20)
    then return false; end if;
  update outreach_outbox set status='sending',subject=p_subject,body=p_body,sent_at=now(),error=null where id=item.id;
  return true;
end;
$$;

revoke all on function public.begin_resend_send(text,text,text,text,text,uuid,uuid),public.finish_resend_send(uuid,text),
  public.record_resend_event(text,text,text,timestamptz,uuid),public.unsubscribe_marketing_email(text,text) from public,anon,authenticated;
grant execute on function public.begin_resend_send(text,text,text,text,text,uuid,uuid),public.finish_resend_send(uuid,text),
  public.record_resend_event(text,text,text,timestamptz,uuid),public.unsubscribe_marketing_email(text,text) to service_role;
commit;
