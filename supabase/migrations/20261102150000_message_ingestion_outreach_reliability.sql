begin;

-- New receipts only: do not infer identities for historical logs or mutate customer records.
alter table public.communication_log add column if not exists inbound_event_key text;
alter table public.communication_log add column if not exists outreach_reply_result jsonb;
create unique index if not exists communication_log_inbound_event_unique
  on public.communication_log(inbound_event_key) where inbound_event_key is not null;
alter table public.outreach_outbox add column if not exists provider text;
alter table public.outreach_outbox drop constraint if exists outreach_outbox_status_check;
alter table public.outreach_outbox add constraint outreach_outbox_status_check
  check(status in ('pending_approval','sent','rejected','failed','sending','acceptance_unknown','accepted_by_provider'));

create or replace function public.ingest_inbound_message(
  p_event_key text, p_client_id uuid, p_lead_id uuid, p_channel text,
  p_from text, p_to text, p_subject text, p_body text, p_sent_at timestamptz, p_provider_id text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare message public.communication_log%rowtype;
begin
  if nullif(btrim(p_event_key),'') is null or p_channel not in ('email','sms') then
    raise exception 'An inbound identity and supported channel are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('inbound:'||p_event_key,0));
  select * into message from communication_log where inbound_event_key=p_event_key;
  if message.id is null then
    insert into communication_log(client_id,channel,direction,subject,body,automation_type,sent_at,metadata,inbound_event_key)
    values(p_client_id,p_channel,'inbound',p_subject,p_body,
      case when p_channel='sms' then 'inbound_sms' else 'inbound_webhook' end,coalesce(p_sent_at,now()),
      jsonb_build_object('from',p_from,'to',p_to,'lead_id',p_lead_id,'provider_message_id',p_provider_id,
        'message_sid',case when p_channel='sms' then p_provider_id end),p_event_key)
    returning * into message;
    if p_client_id is not null then
      update clients set last_activity_at=greatest(coalesce(last_activity_at,message.sent_at),message.sent_at)
        where id=p_client_id;
    end if;
  end if;
  return jsonb_build_object('id',message.id,'client_id',message.client_id,'channel',message.channel,
    'direction',message.direction,'subject',message.subject,'sent_at',message.sent_at);
end;
$$;

-- Reply changes and any legacy/manual-call follow-up work are one transaction.
-- Webhooks use their receipt as a checkpoint and leave alerts to alert_inbound_message.
create or replace function public.process_outreach_reply(
  p_client_id uuid, p_email text, p_phone text, p_body text, p_log_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sender_email text:=lower(nullif(btrim(p_email),''));
  digits text:=regexp_replace(regexp_replace(coalesce(p_phone,''),'\D','','g'),'^1(?=\d{10}$)','');
  opted_out boolean:=coalesce(p_body,'') ~* '(\munsubscribe\M|\mopt[ -]?out\M|^[[:space:]]*stop[[:space:]]*$|\mstop[[:space:]]+(sending|emailing|texting)\M|remove me)';
  message public.communication_log%rowtype;
  enrollment record;
  lead_ids uuid[];
  result_ids uuid[]:='{}';
  result jsonb;
begin
  if p_log_id is not null then
    select * into message from communication_log where id=p_log_id and direction='inbound' for update;
    if message.id is null then raise exception 'Inbound message not found'; end if;
    if message.outreach_reply_result is not null then return message.outreach_reply_result; end if;
  end if;
  if sender_email is null and p_client_id is not null then
    select lower(btrim(c.email)) into sender_email from clients c where c.id=p_client_id;
  end if;
  select array_agg(l.id) into lead_ids from leads l
    where (sender_email is not null and lower(btrim(l.email))=sender_email)
       or (length(digits)>=7 and (regexp_replace(regexp_replace(coalesce(l.phone,''),'\D','','g'),'^1(?=\d{10}$)','')=digits
         or (p_client_id is not null and l.account_id=p_client_id)));
  if opted_out then
    insert into outreach_opt_outs(email,reason)
      select address,'Requested in reply.' from (
        select sender_email as address
        union select lower(nullif(btrim(l.email),'')) from leads l where l.id=any(lead_ids)
        union select lower(nullif(btrim(c.email),'')) from clients c
          where length(digits)>=7 and regexp_replace(regexp_replace(coalesce(c.phone,''),'\D','','g'),'^1(?=\d{10}$)','')=digits
      ) addresses where address is not null
      on conflict on constraint outreach_opt_outs_pkey do nothing;
  end if;
  for enrollment in
    select e.id,e.lead_id,l.full_name from sequence_enrollments e join leads l on l.id=e.lead_id
      where e.lead_id=any(lead_ids) and e.status in ('active','paused') order by e.id for update of e
  loop
    update sequence_enrollments set status=case when opted_out then 'opted_out' else 'replied' end,
      ended_at=now(),ended_reason=case when opted_out then 'Recipient asked to stop.' else 'Prospect replied.' end,
      next_send_at=null where id=enrollment.id;
    update outreach_outbox set status='rejected',
      error=case when opted_out then 'Recipient opted out.' else 'Prospect replied — sequence stopped.' end
      where enrollment_id=enrollment.id and status='pending_approval';
    if not opted_out then result_ids:=array_append(result_ids,enrollment.lead_id); end if;
    if p_log_id is null then
      if not opted_out then
        insert into tasks(subject,description,due_date,status,priority,related_type,related_id,inbound_reply_key)
          values('Reply from '||enrollment.full_name||' — call while it''s warm',
            'They replied to a sequence email. Follow up personally today.',now()+interval '2 hours',
            'open','high','lead',enrollment.lead_id,'lead:'||enrollment.lead_id::text)
          on conflict(inbound_reply_key) where inbound_reply_key is not null and status='open' do nothing;
      end if;
      insert into notifications(type,message,href,read)
        values('outreach',enrollment.full_name||case when opted_out then ' asked to stop emails — opted out and sequence ended.'
          else ' replied — sequence stopped; follow up personally.' end,'/leads?lead='||enrollment.lead_id::text,false);
    end if;
  end loop;
  result:=jsonb_build_object('sequenceLeadIds',to_jsonb(result_ids));
  if p_log_id is not null then update communication_log set outreach_reply_result=result where id=p_log_id; end if;
  return result;
end;
$$;

create or replace function public.create_outreach_draft(
  p_enrollment_id uuid,p_step integer,p_to text,p_subject text,p_body text,p_signals jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare enrollment public.sequence_enrollments%rowtype;
begin
  select * into enrollment from sequence_enrollments where id=p_enrollment_id for update;
  if enrollment.id is null or enrollment.status<>'active' or p_step<>enrollment.current_step+1 then return false; end if;
  -- Even failed/uncertain historical attempts require review, never a fresh automatic draft.
  if exists(select 1 from outreach_outbox where enrollment_id=p_enrollment_id and step_number=p_step) then return false; end if;
  insert into outreach_outbox(enrollment_id,lead_id,step_number,to_email,subject,body,cited_signals)
    values(p_enrollment_id,enrollment.lead_id,p_step,p_to,p_subject,p_body,p_signals);
  return true;
end;
$$;

create or replace function public.claim_outreach_send(p_outbox_id uuid,p_subject text,p_body text)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  item public.outreach_outbox%rowtype;
  enrollment public.sequence_enrollments%rowtype;
  cap integer;
begin
  -- Serialize the cap and duplicate-step checks across concurrent approvals/workers.
  perform pg_advisory_xact_lock(hashtextextended('outreach-send-cap',0));
  select * into item from outreach_outbox where id=p_outbox_id;
  if item.enrollment_id is not null then
    select * into enrollment from sequence_enrollments where id=item.enrollment_id for update;
    if enrollment.id is null or enrollment.status<>'active' or item.step_number<>enrollment.current_step+1 then return false; end if;
  end if;
  select * into item from outreach_outbox where id=p_outbox_id for update;
  if item.id is null or item.status<>'pending_approval' then return false; end if;
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

-- Acceptance is committed before this call. Failure rolls back all bookkeeping;
-- retrying this function cannot send another email or duplicate logs/tasks.
create or replace function public.finalize_outreach_send(p_outbox_id uuid,p_followup_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  item public.outreach_outbox%rowtype;
  enrollment public.sequence_enrollments%rowtype;
  lead public.leads%rowtype;
begin
  select * into item from outreach_outbox where id=p_outbox_id;
  if item.enrollment_id is not null then
    select * into enrollment from sequence_enrollments where id=item.enrollment_id for update;
  end if;
  select * into item from outreach_outbox where id=p_outbox_id for update;
  if item.status='sent' then return true; end if;
  if item.id is null or item.status<>'accepted_by_provider' then raise exception 'Provider acceptance is not recorded; do not resend'; end if;
  select * into lead from leads where id=item.lead_id;
  if lead.id is null then raise exception 'Outreach lead not found'; end if;
  insert into communication_log(client_id,channel,direction,subject,body,automation_type,sent_at,metadata)
    values(lead.account_id,'email','outbound',item.subject,item.body,'outreach_sequence',item.sent_at,
      jsonb_build_object('lead_id',item.lead_id,'to',item.to_email,'outbox_id',item.id,
        'delivery_status','accepted_by_provider','provider',item.provider));
  -- A reply/cancellation during the provider call must not resurrect the sequence.
  if enrollment.id is not null and enrollment.status='active' and enrollment.current_step<item.step_number then
    if item.step_number>=enrollment.total_steps then
      update sequence_enrollments set current_step=item.step_number,last_sent_at=item.sent_at,next_send_at=null,
        status='completed',ended_at=now(),ended_reason='All emails accepted by provider; delivery is not confirmed.' where id=enrollment.id;
      insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
        values('Call '||lead.full_name||' — email sequence finished',
          'Sequence emails were accepted by the provider, not confirmed delivered. Follow up by phone.',
          p_followup_at,'open','high','lead',lead.id);
    else
      update sequence_enrollments set current_step=item.step_number,last_sent_at=item.sent_at,
        next_send_at=(date_trunc('day',item.sent_at at time zone 'America/Phoenix')+
          make_interval(days=>enrollment.step_gap_days,hours=>9)) at time zone 'America/Phoenix'
        where id=enrollment.id;
    end if;
  end if;
  update outreach_outbox set status='sent',error=null where id=item.id;
  return true;
end;
$$;

comment on column public.outreach_outbox.sent_at is 'Attempt/acceptance time, not evidence of recipient delivery. sending/acceptance_unknown require manual provider reconciliation.';
comment on function public.ingest_inbound_message(text,uuid,uuid,text,text,text,text,text,timestamptz,text)
  is 'Provider-key deduplication for new receipts. Identity-less email uses a content fingerprint and can collapse identical legitimate messages.';
revoke all on function public.ingest_inbound_message(text,uuid,uuid,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.process_outreach_reply(uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.create_outreach_draft(uuid,integer,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.claim_outreach_send(uuid,text,text) from public,anon,authenticated;
revoke all on function public.finalize_outreach_send(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.ingest_inbound_message(text,uuid,uuid,text,text,text,text,text,timestamptz,text) to service_role;
grant execute on function public.process_outreach_reply(uuid,text,text,text,uuid) to service_role;
grant execute on function public.create_outreach_draft(uuid,integer,text,text,text,jsonb) to service_role;
grant execute on function public.claim_outreach_send(uuid,text,text) to service_role;
grant execute on function public.finalize_outreach_send(uuid,timestamptz) to service_role;
commit;
