begin;

-- Keep only submission identity, not customer payload, after a lead is erased.
create table public.website_submission_receipts (
  submission_key text primary key,
  lead_id uuid references public.leads(id) on delete set null,
  recorded_at timestamptz not null default now()
);
alter table public.website_submission_receipts enable row level security;
revoke all on public.website_submission_receipts from public,anon,authenticated;
grant select,insert,update on public.website_submission_receipts to service_role;

create function public.website_receipt_key(p_payload jsonb)
returns text language sql immutable set search_path=public as $$
  select case
    when coalesce(nullif(trim(p_payload->>'id'),''),nullif(trim(p_payload->>'submission_id'),'')) is not null
      then 'website:'||coalesce(nullif(trim(p_payload->>'id'),''),trim(p_payload->>'submission_id'))
    else 'website-payload:'||md5((coalesce(p_payload,'{}'::jsonb)
      -'previous_submissions'-'profile'-'lead_context'-'_request'-'_intake')::text)
  end;
$$;

insert into public.website_submission_receipts(submission_key,lead_id,recorded_at)
select public.website_receipt_key(snapshot),lead_id,min(received_at)
from public.lead_intake_events
group by public.website_receipt_key(snapshot),lead_id
order by min(received_at)
on conflict(submission_key) do nothing;

create function public.website_submission_receipts_for(p_payloads jsonb)
returns table("position" integer,lead_id uuid)
language sql stable security definer set search_path=public as $$
  select p.ordinality::integer-1,r.lead_id
  from jsonb_array_elements(p_payloads) with ordinality p(payload,ordinality)
  join public.website_submission_receipts r on r.submission_key=public.website_receipt_key(p.payload);
$$;

create function public.remember_website_submission()
returns trigger language plpgsql security definer set search_path=public as $$
declare key text;
begin
  key:=public.website_receipt_key(new.snapshot);
  perform pg_advisory_xact_lock(hashtextextended('website-receipt:'||key,0));
  if exists(select 1 from public.website_submission_receipts where submission_key=key) then
    raise exception 'This website submission has already been processed.' using errcode='23505';
  end if;
  insert into public.website_submission_receipts(submission_key,lead_id,recorded_at)
    values(key,new.lead_id,new.received_at);
  return new;
end;
$$;
create trigger remember_website_submission before insert on public.lead_intake_events
  for each row execute function public.remember_website_submission();

create or replace function public.apply_website_resubmission(p_lead_id uuid,p_payload jsonb,p_full_name text default null,p_email text default null,p_phone text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare lead public.leads%rowtype; key text; payload jsonb; history jsonb; event_id uuid; receipt_key text;
begin
  select * into lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'Lead not found.' using errcode='P0002'; end if;
  receipt_key:=public.website_receipt_key(p_payload);
  perform pg_advisory_xact_lock(hashtextextended('website-receipt:'||receipt_key,0));
  if exists(select 1 from public.website_submission_receipts where submission_key=receipt_key) then return false; end if;
  key:=public.workspace_submission_key(lead.id,p_payload);
  if exists(select 1 from public.lead_intake_events where submission_key=key) then return false; end if;
  if lead.archived_at is not null then perform public.restore_leads(array[lead.id],'Website request'); end if;
  payload:=p_payload-'previous_submissions';
  payload:=jsonb_set(payload,'{_intake}','{"channel":"website"}'::jsonb);
  if lead.form_payload->'profile' is not null then payload:=jsonb_set(payload,'{profile}',lead.form_payload->'profile'); end if;
  history:=coalesce(lead.form_payload->'previous_submissions','[]'::jsonb)
    ||jsonb_build_array(coalesce(lead.form_payload,'{}'::jsonb)-'previous_submissions');
  payload:=jsonb_set(payload,'{previous_submissions}',history);
  update public.leads l set form_payload=payload,last_activity_at=now(),
    full_name=case when l.confirmed_fields?'full_name' then l.full_name else coalesce(nullif(trim(p_full_name),''),l.full_name) end,
    email=case when l.confirmed_fields?'email' then l.email else coalesce(nullif(lower(trim(p_email)),''),l.email) end,
    phone=case when l.confirmed_fields?'phone' then l.phone else coalesce(nullif(trim(p_phone),''),l.phone) end,
    status=case when l.status in ('lost','inactive') then 'new' else l.status end,
    stage_changed_at=case when l.status in ('lost','inactive') then now() else l.stage_changed_at end,
    lost_reason=case when l.status in ('lost','inactive') then null else l.lost_reason end
  where l.id=lead.id;
  select id into event_id from public.lead_intake_events where submission_key=key;
  if event_id is null then raise exception 'The website source did not produce an intake event.' using errcode='23514'; end if;
  perform public.create_intake_work(event_id);
  return true;
end;
$$;
revoke all on function public.website_submission_receipts_for(jsonb) from public,anon,authenticated;
grant execute on function public.website_submission_receipts_for(jsonb) to service_role;
revoke all on function public.remember_website_submission() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
