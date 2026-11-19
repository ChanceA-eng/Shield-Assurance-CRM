begin;

alter table public.outreach_outbox
  add column draft_revision integer not null default 0,
  add column requires_manual_approval boolean not null default false;

create function public.rewrite_outreach_draft(
  p_outbox_id uuid, p_actor_id uuid, p_revision integer,
  p_subject text, p_body text, p_signals jsonb
) returns integer language plpgsql security definer set search_path=public as $$
declare
  item public.outreach_outbox%rowtype;
begin
  select * into item from outreach_outbox where id=p_outbox_id;
  if item.enrollment_id is not null then
    perform 1 from sequence_enrollments where id=item.enrollment_id for update;
  end if;
  select * into item from outreach_outbox where id=p_outbox_id for update;
  if item.id is null or item.status<>'pending_approval' or item.draft_revision is distinct from p_revision then
    raise sqlstate 'PT409' using message='This draft changed or is no longer awaiting approval. Refresh before rewriting.';
  end if;
  if p_actor_id is null or (item.agent_user_id is not null and item.agent_user_id<>p_actor_id) then
    raise sqlstate '42501' using message='Only the sequence owner can rewrite this draft.';
  end if;
  if nullif(btrim(p_subject),'') is null or nullif(btrim(p_body),'') is null
    or jsonb_typeof(p_signals) is distinct from 'array' or jsonb_array_length(p_signals)=0 then
    raise exception 'A subject, body and factual citations are required' using errcode='22023';
  end if;
  update outreach_outbox set subject=p_subject,body=p_body,cited_signals=p_signals,
    draft_revision=draft_revision+1,requires_manual_approval=true where id=item.id;
  return item.draft_revision+1;
end;
$$;

drop function public.claim_outreach_send(uuid,text,text);
create function public.claim_outreach_send(
  p_outbox_id uuid,p_subject text,p_body text,p_expected_revision integer default null
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  item public.outreach_outbox%rowtype;
  enrollment public.sequence_enrollments%rowtype;
  cap integer;
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
  if not exists(select 1 from leads l where l.id=item.lead_id
    and lower(btrim(l.email))=lower(btrim(item.to_email)) and coalesce(l.status,'') not in ('won','lost')
    and coalesce(l.form_payload #>> '{metadata,contactConsent,accepted}','true')<>'false') then return false; end if;
  if exists(select 1 from outreach_opt_outs where email=lower(btrim(item.to_email))) then return false; end if;
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

revoke all on function public.rewrite_outreach_draft(uuid,uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.rewrite_outreach_draft(uuid,uuid,integer,text,text,jsonb) to service_role;
revoke all on function public.claim_outreach_send(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_outreach_send(uuid,text,text,integer) to service_role;
commit;
