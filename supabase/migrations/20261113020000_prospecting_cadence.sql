begin;

create table public.prospecting_cadences (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_user_id uuid not null references public.agency_members(user_id),
  gmail_connection_id uuid references public.gmail_connections(id),
  status text not null default 'active'
    check (status in ('active','replied','cancelled','do_not_contact','pipeline_exit','completed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text,
  voicemail_count integer not null default 0 check (voicemail_count between 0 and 2),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index prospecting_cadences_one_active_lead
  on public.prospecting_cadences(lead_id) where status = 'active';

create function public.block_duplicate_prospecting_sequence()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform 1 from leads where id=new.lead_id for update;
  if new.status in ('active','paused') and exists(select 1 from prospecting_cadences where lead_id=new.lead_id and status='active') then
    raise exception 'Cancel the active prospecting plan before starting a separate email sequence' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger block_duplicate_prospecting_sequence before insert or update of status on public.sequence_enrollments
  for each row execute function public.block_duplicate_prospecting_sequence();

create function public.prospecting_contact_block(p_lead uuid,p_since timestamptz default null)
returns text language sql stable security definer set search_path=public as $$
  select case
    when l.id is null or l.archived_at is not null or l.status not in ('new','contacted') then 'pipeline_exit'
    when exists(select 1 from record_contact_preferences pref
      where pref.do_not_contact and (pref.lead_id=l.id or pref.client_id=l.account_id
        or pref.lead_id in (select id from leads where account_id=l.account_id)))
      or coalesce(l.form_payload #>> '{metadata,contactConsent,accepted}','true')='false'
      or exists(select 1 from outreach_opt_outs where email=lower(trim(l.email)))
      or exists(select 1 from email_suppressions where email=lower(trim(l.email)))
      or exists(select 1 from marketing_email_consents where email=lower(trim(l.email)) and revoked_at is not null)
      then 'do_not_contact'
    when p_since is not null and exists(select 1 from canonical_communications
      where conversation_key in ('lead:'||l.id::text,'client:'||l.account_id::text)
        and direction='inbound' and sent_at>=p_since) then 'replied'
    else null end
  from (select 1) seed left join leads l on l.id=p_lead
$$;

create table public.prospecting_cadence_touches (
  id uuid primary key default gen_random_uuid(),
  cadence_id uuid not null references public.prospecting_cadences(id) on delete cascade,
  touch_number smallint not null check (touch_number between 1 and 8),
  channel text not null check (channel in ('call','email')),
  due_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned','draft_ready','completed','cancelled')),
  task_id uuid references public.tasks(id) on delete set null,
  outcome text,
  voicemail boolean not null default false,
  outbox_id uuid,
  completed_at timestamptz,
  unique (cadence_id, touch_number)
);
create index prospecting_cadence_touches_due on public.prospecting_cadence_touches(status, due_at);
alter table public.outreach_outbox
  add column prospecting_touch_id uuid unique references public.prospecting_cadence_touches(id) on delete set null;

alter table public.prospecting_cadences enable row level security;
alter table public.prospecting_cadence_touches enable row level security;
revoke all on public.prospecting_cadences, public.prospecting_cadence_touches from public, anon, authenticated;
grant all on public.prospecting_cadences, public.prospecting_cadence_touches to service_role;

create or replace function public.stamp_agent_outreach()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.enrollment_id is not null then
    select agent_user_id,gmail_connection_id into new.agent_user_id,new.gmail_connection_id
      from sequence_enrollments where id=new.enrollment_id;
  end if;
  return new;
end;
$$;

create function public.create_prospecting_cadence(p_actor uuid, p_lead uuid, p_mailbox uuid, p_touches jsonb,p_context jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_member agency_members;
  lead_row leads;
  cadence_id uuid;
  touch jsonb;
  touch_number integer;
  expected_channel text;
  due_at timestamptz;
  touch_id uuid;
  created_task_id uuid;
  previous_due timestamptz;
  expected_number integer:=0;
begin
  select * into v_member from agency_members where user_id=p_actor and active;
  if v_member.user_id is null then raise exception 'Active agency membership is required' using errcode='42501'; end if;
  select * into lead_row from leads where id=p_lead and archived_at is null for update;
  if lead_row.id is null or lead_row.status not in ('new','contacted') then
    raise exception 'Only an open, unarchived prospect can start this plan' using errcode='22023';
  end if;
  if v_member.role='agent' and lead_row.agent_user_id is not null and lead_row.agent_user_id<>p_actor then
    raise exception 'Lead is assigned to another agent' using errcode='42501';
  end if;
  if p_mailbox is not null and not exists(select 1 from gmail_connections where id=p_mailbox and user_id=p_actor and status='connected') then
    raise exception 'Connect your own Gmail mailbox before starting this plan' using errcode='42501';
  end if;
  if exists(select 1 from record_contact_preferences where do_not_contact and
    (lead_id=p_lead or client_id=lead_row.account_id)) then
    raise exception 'This record is marked Do Not Contact' using errcode='42501';
  end if;
  if lead_row.email is null or length(trim(lead_row.email))=0 then
    raise exception 'Add an email address before starting the prospecting plan' using errcode='22023';
  end if;
  if prospecting_contact_block(p_lead) is not null then
    raise exception 'Contact restrictions or the current lead stage prevent starting this plan' using errcode='42501';
  end if;
  if exists(select 1 from sequence_enrollments where lead_id=p_lead and status in ('active','paused')) then
    raise exception 'Cancel the existing email sequence before starting this plan' using errcode='22023';
  end if;
  if jsonb_typeof(p_touches) is distinct from 'array' or jsonb_array_length(p_touches)<>8 then
    raise exception 'The prospecting plan must contain all eight scheduled touches' using errcode='22023';
  end if;
  if exists(select 1 from prospecting_cadences where lead_id=p_lead and status='active') then
    raise exception 'An active prospecting plan already exists for this lead' using errcode='23505';
  end if;
  if exists(select 1 from prospecting_cadences where lead_id=p_lead and status='replied') then
    raise exception 'A prospect replied to an earlier plan; follow up personally instead of restarting it' using errcode='22023';
  end if;
  if jsonb_typeof(p_context) is distinct from 'object' then
    raise exception 'Choose valid prospecting details' using errcode='22023';
  end if;
  insert into prospecting_cadences(lead_id,agent_user_id,gmail_connection_id,context)
    values(p_lead,p_actor,p_mailbox,p_context) returning id into cadence_id;
  for touch in select value from jsonb_array_elements(p_touches) loop
    expected_number:=expected_number+1;
    touch_number:=(touch->>'touch_number')::integer;
    expected_channel:=case when touch_number in (1,3,5,8) then 'call' else 'email' end;
    if touch_number is distinct from expected_number or touch->>'channel' is distinct from expected_channel then
      raise exception 'The prospecting touch order is invalid' using errcode='22023';
    end if;
    due_at:=(touch->>'due_at')::timestamptz;
    if due_at is null or (previous_due is not null and due_at<=previous_due) then
      raise exception 'Prospecting touch dates must be valid and increasing' using errcode='22023';
    end if;
    previous_due:=due_at;
    insert into prospecting_cadence_touches(cadence_id,touch_number,channel,due_at)
      values(cadence_id,touch_number,expected_channel,due_at) returning id into touch_id;
    if expected_channel='call' then
      insert into tasks(subject,description,due_date,status,priority,related_type,related_id,account_id,assignee,created_by,action_href)
        values(lead_row.full_name||': prospecting touch '||touch_number||' of 8 - call',
          'Manual call task from the optional prospecting plan. Record the outcome in the lead workspace; no call is placed automatically.',
          due_at,'open','medium','lead',p_lead,lead_row.account_id,
          v_member.email,p_actor::text,'/leads?lead='||p_lead::text) returning id into created_task_id;
      update prospecting_cadence_touches set task_id=created_task_id where id=touch_id;
    end if;
  end loop;
  return cadence_id;
end;
$$;

create function public.complete_prospecting_call_touch(p_actor uuid, p_touch uuid, p_outcome text)
returns void language plpgsql security definer set search_path=public as $$
declare cadence prospecting_cadences; touch prospecting_cadence_touches;
begin
  select c.* into cadence from prospecting_cadences c
    join prospecting_cadence_touches t on t.cadence_id=c.id where t.id=p_touch for update of c;
  select * into touch from prospecting_cadence_touches where id=p_touch for update;
  if cadence.id is null or cadence.status<>'active' or cadence.agent_user_id is distinct from p_actor
    or not exists(select 1 from agency_members where user_id=p_actor and active) then
    raise exception 'This prospecting plan is no longer active or is assigned to another agent' using errcode='42501';
  end if;
  if touch.channel<>'call' or touch.status<>'planned'
    or p_outcome is null or p_outcome not in ('connected','no_answer','voicemail','not_interested') then
    raise exception 'Choose a valid call outcome for a pending call touch' using errcode='22023';
  end if;
  if touch.due_at>now() then raise exception 'This call task is not due yet' using errcode='22023'; end if;
  if p_outcome='voicemail' and cadence.voicemail_count>=2 then
    raise exception 'The plan allows no more than two voicemails' using errcode='22023';
  end if;
  if prospecting_contact_block(cadence.lead_id,cadence.started_at) is not null then
    raise exception 'A reply, contact restriction or lead stage change prevents further prospecting' using errcode='42501';
  end if;
  update prospecting_cadence_touches set status='completed',outcome=p_outcome,voicemail=(p_outcome='voicemail'),
    completed_at=now() where id=p_touch;
  update tasks set status='completed' where id=touch.task_id and status='open';
  if p_outcome='voicemail' then
    update prospecting_cadences set voicemail_count=voicemail_count+1 where id=cadence.id;
  elsif p_outcome='not_interested' then
    update prospecting_cadences set status='cancelled',ended_at=now(),ended_reason='Prospect declined further contact.'
      where id=cadence.id;
  end if;
  if p_outcome='not_interested' then
    update prospecting_cadence_touches set status='cancelled' where cadence_id=cadence.id and status in ('planned','draft_ready');
    delete from tasks where id in (select task_id from prospecting_cadence_touches where cadence_id=cadence.id and status='cancelled' and task_id is not null) and status='open';
    update outreach_outbox set status='rejected',error='Prospect declined further contact.'
      where prospecting_touch_id in (select id from prospecting_cadence_touches where cadence_id=cadence.id)
        and status='pending_approval';
  elsif p_outcome='connected' then
    perform stop_prospecting_cadence(cadence.id,'replied','Connected by phone; follow up personally.');
    insert into tasks(subject,description,due_date,status,priority,related_type,related_id,account_id,assignee,action_href)
      select l.full_name||': follow up after your call','Continue the conversation personally. The prospecting plan has stopped.',
        now()+interval '1 day','open','high','lead',l.id,l.account_id,m.email,'/leads?lead='||l.id::text
      from leads l join agency_members m on m.user_id=p_actor where l.id=cadence.lead_id;
  elsif not exists(select 1 from prospecting_cadence_touches where cadence_id=cadence.id and status in ('planned','draft_ready')) then
    update prospecting_cadences set status='completed',ended_at=now(),ended_reason='All planned touches are complete.'
      where id=cadence.id and status='active';
  end if;
end;
$$;

create function public.stop_prospecting_cadence(p_cadence uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_status not in ('replied','cancelled','do_not_contact','pipeline_exit') then
    raise exception 'Invalid prospecting stop reason' using errcode='22023';
  end if;
  update prospecting_cadences set status=p_status,ended_at=now(),ended_reason=left(p_reason,500)
    where id=p_cadence and status='active';
  update prospecting_cadence_touches set status='cancelled'
    where cadence_id=p_cadence and status in ('planned','draft_ready');
  delete from tasks where id in (select task_id from prospecting_cadence_touches
    where cadence_id=p_cadence and status='cancelled' and task_id is not null) and status='open';
  update outreach_outbox set status='rejected',error=left(p_reason,500)
    where prospecting_touch_id in (select id from prospecting_cadence_touches where cadence_id=p_cadence)
      and status='pending_approval';
end;
$$;

create function public.stop_prospecting_on_contact_preference()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.do_not_contact then
    delete from tasks t using leads l where t.related_type='lead' and t.related_id=l.id
      and t.status='open' and t.action_category='prospecting_nurture'
      and (l.id=new.lead_id or l.account_id=new.client_id
        or l.account_id in (select account_id from leads where id=new.lead_id));
    perform stop_prospecting_cadence(c.id,'do_not_contact','Do Not Contact was enabled for this prospect or linked account.')
      from prospecting_cadences c join leads l on l.id=c.lead_id
      where c.status='active' and (c.lead_id=new.lead_id or l.account_id=new.client_id
        or l.account_id in (select account_id from leads where id=new.lead_id));
  end if;
  return new;
end;
$$;
create trigger stop_prospecting_for_dnc after insert or update of do_not_contact
  on public.record_contact_preferences for each row execute function public.stop_prospecting_on_contact_preference();

create function public.create_prospecting_nurture(p_actor uuid,p_lead uuid,p_due date)
returns uuid language plpgsql security definer set search_path=public as $$
declare member_row agency_members; lead_row leads; task uuid; timezone text;
begin
  select * into member_row from agency_members where user_id=p_actor and active;
  select * into lead_row from leads where id=p_lead and archived_at is null for update;
  if member_row.user_id is null or lead_row.id is null
    or (member_row.role='agent' and lead_row.agent_user_id is not null and lead_row.agent_user_id<>p_actor) then
    raise exception 'Lead not found or unavailable' using errcode='42501';
  end if;
  if prospecting_contact_block(p_lead) is not null then
    raise exception 'Contact restrictions or the current lead stage prevent creating a reminder' using errcode='42501';
  end if;
  if p_due is null or p_due<=current_date then
    raise exception 'Choose a future renewal-preparation date' using errcode='22023';
  end if;
  select coalesce(s.timezone,'America/Phoenix') into timezone from outreach_settings s where s.id=1;
  insert into tasks(subject,description,due_date,status,priority,related_type,related_id,account_id,
    assignee,created_by,automation_key,action_category,action_href)
    values(lead_row.full_name||': prepare for confirmed renewal',
      'Agent-requested reminder approximately 130 days before the confirmed renewal. Reconfirm timing before contacting.',
      (p_due::timestamp+interval '9 hours') at time zone coalesce(timezone,'America/Phoenix'),
      'open','medium','lead',p_lead,lead_row.account_id,member_row.email,p_actor::text,
      'prospecting-nurture:'||p_lead::text||':'||p_due::text,'prospecting_nurture','/leads?lead='||p_lead::text)
    on conflict(automation_key) where automation_key is not null do update set automation_key=excluded.automation_key
    returning id into task;
  return task;
end;
$$;

create function public.stop_prospecting_on_pipeline_exit()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status not in ('new','contacted') or new.archived_at is not null
    or new.email is distinct from old.email or new.agent_user_id is distinct from old.agent_user_id
    or new.account_id is distinct from old.account_id then
    perform stop_prospecting_cadence(c.id,'pipeline_exit','Lead details or prospecting stage changed; review before resuming outreach.')
      from prospecting_cadences c where c.lead_id=new.id and c.status='active';
    delete from tasks where related_type='lead' and related_id=new.id and status='open'
      and action_category='prospecting_nurture';
  end if;
  return new;
end;
$$;
create trigger stop_prospecting_on_lead_stage after update of status,archived_at,email,agent_user_id,account_id on public.leads
  for each row execute function public.stop_prospecting_on_pipeline_exit();

create function public.create_prospecting_email_draft(
  p_touch uuid,p_to text,p_subject text,p_body text,p_signals jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare cadence prospecting_cadences; touch prospecting_cadence_touches; outbox uuid; block text;
begin
  select c.* into cadence from prospecting_cadences c
    join prospecting_cadence_touches t on t.cadence_id=c.id where t.id=p_touch for update of c;
  select * into touch from prospecting_cadence_touches where id=p_touch for update;
  if cadence.id is null or cadence.status<>'active' or touch.channel<>'email'
    or touch.status<>'planned' or touch.due_at>now() then return false; end if;
  if exists(select 1 from prospecting_cadence_touches where cadence_id=cadence.id and channel='email'
    and touch_number<touch.touch_number and status in ('planned','draft_ready')) then return false; end if;
  block:=prospecting_contact_block(cadence.lead_id,cadence.started_at);
  if block is not null then
    perform stop_prospecting_cadence(cadence.id,block,'Prospecting stopped: '||replace(block,'_',' ')||'.');
    return false;
  end if;
  if not exists(select 1 from agency_members where user_id=cadence.agent_user_id and active) then
    raise exception 'The plan owner is no longer an active agency member' using errcode='42501';
  end if;
  if not exists(select 1 from leads l where l.id=cadence.lead_id and archived_at is null
    and l.status in ('new','contacted') and lower(trim(l.email))=p_to
    and coalesce(l.form_payload #>> '{metadata,contactConsent,accepted}','true')<>'false') then return false; end if;
  if nullif(trim(p_subject),'') is null or nullif(trim(p_body),'') is null
    or jsonb_typeof(p_signals) is distinct from 'array' then
    raise exception 'A subject, body and evidence list are required' using errcode='22023';
  end if;
  if exists(select 1 from outreach_outbox where prospecting_touch_id=p_touch) then return false; end if;
  insert into outreach_outbox(lead_id,step_number,to_email,subject,body,cited_signals,
    status,agent_user_id,gmail_connection_id,prospecting_touch_id,requires_manual_approval)
    values(cadence.lead_id,touch.touch_number,p_to,p_subject,p_body,p_signals,
      'pending_approval',cadence.agent_user_id,cadence.gmail_connection_id,p_touch,true) returning id into outbox;
  update prospecting_cadence_touches set status='draft_ready',outbox_id=outbox where id=p_touch;
  return true;
end;
$$;

create function public.sync_prospecting_outbox_touch()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.prospecting_touch_id is not null and new.status in ('sent','rejected') and old.status is distinct from new.status then
    update prospecting_cadence_touches t set
      status=case when c.status='active' then 'completed' else 'cancelled' end,
      outcome=case when new.status='sent' then 'email_sent' else 'email_rejected' end,
      completed_at=now()
    from prospecting_cadences c
    where t.id=new.prospecting_touch_id and c.id=t.cadence_id and t.status='draft_ready';
    update prospecting_cadences c set status='completed',ended_at=now(),ended_reason='All planned touches are complete.'
    where c.id=(select cadence_id from prospecting_cadence_touches where id=new.prospecting_touch_id)
      and c.status='active' and not exists(select 1 from prospecting_cadence_touches
        where cadence_id=c.id and status in ('planned','draft_ready'));
  end if;
  return new;
end;
$$;
create trigger sync_prospecting_outbox_touch after update of status on public.outreach_outbox
  for each row execute function public.sync_prospecting_outbox_touch();

alter function public.claim_outreach_send(uuid,text,text,integer) rename to claim_outreach_send_without_prospecting;
create function public.claim_outreach_send(
  p_outbox_id uuid,p_subject text,p_body text,p_expected_revision integer default null
) returns boolean language plpgsql security definer set search_path=public as $$
declare item outreach_outbox; cadence prospecting_cadences; touch prospecting_cadence_touches;
begin
  select * into item from outreach_outbox where id=p_outbox_id;
  if item.prospecting_touch_id is not null then
    select c.* into cadence from prospecting_cadences c
      join prospecting_cadence_touches t on t.cadence_id=c.id
      where t.id=item.prospecting_touch_id for update of c;
    select * into touch from prospecting_cadence_touches where id=item.prospecting_touch_id for update;
    if cadence.id is null or cadence.status<>'active' or touch.status<>'draft_ready'
      or touch.channel<>'email' or touch.outbox_id is distinct from item.id
      or p_expected_revision is null then return false; end if;
    if not exists(select 1 from agency_members where user_id=cadence.agent_user_id and active) then return false; end if;
    if not exists(select 1 from leads where id=cadence.lead_id and archived_at is null
      and status in ('new','contacted')) then return false; end if;
    if prospecting_contact_block(cadence.lead_id,cadence.started_at) is not null then return false; end if;
  end if;
  return claim_outreach_send_without_prospecting(p_outbox_id,p_subject,p_body,p_expected_revision);
end;
$$;

alter function public.finalize_outreach_send(uuid,timestamptz) rename to finalize_outreach_send_without_prospecting;
create function public.finalize_outreach_send(p_outbox_id uuid,p_followup_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from outreach_outbox where id=p_outbox_id
    and prospecting_touch_id is not null and gmail_connection_id is null) then
    return finalize_legacy_outreach_send(p_outbox_id,p_followup_at);
  end if;
  return finalize_outreach_send_without_prospecting(p_outbox_id,p_followup_at);
end;
$$;

create or replace function public.process_outreach_reply(
  p_client_id uuid, p_email text, p_phone text, p_body text, p_log_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sender_email text:=lower(nullif(btrim(p_email),''));
  digits text:=regexp_replace(regexp_replace(coalesce(p_phone,''),'\D','','g'),'^1(?=\d{10}$)','');
  opted_out boolean:=coalesce(p_body,'') ~* '(\munsubscribe\M|\mopt[ -]?out\M|^[[:space:]]*stop[[:space:]]*$|\mstop[[:space:]]+(sending|emailing|texting)\M|remove me)';
  message public.communication_log%rowtype;
  enrollment record;
  cadence record;
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
       or (p_client_id is not null and l.account_id=p_client_id)
       or (message.metadata->>'lead_id'=l.id::text)
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
    insert into record_contact_preferences(lead_id,do_not_contact,reason,updated_at)
      select id,true,'Recipient opted out of outreach.',now() from leads where id=any(lead_ids)
      on conflict(lead_id) do update set do_not_contact=true,reason=excluded.reason,updated_at=now(),updated_by=null;
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
  for cadence in
    select c.id,c.lead_id,l.full_name,c.agent_user_id,m.email,m.sender_profile
      from prospecting_cadences c join leads l on l.id=c.lead_id
      join agency_members m on m.user_id=c.agent_user_id
      where c.lead_id=any(lead_ids) and c.status='active' order by c.id for update of c
  loop
    perform stop_prospecting_cadence(cadence.id,
      case when opted_out then 'do_not_contact' else 'replied' end,
      case when opted_out then 'Recipient asked to stop.' else 'Prospect replied; follow up personally.' end);
    if p_log_id is null and not opted_out then
      insert into tasks(subject,description,due_date,status,priority,related_type,related_id,account_id,created_by,assignee,inbound_reply_key)
        select 'Reply from '||cadence.full_name||' — follow up personally',
          'The prospect replied during the prospecting plan. Follow up personally; remaining planned touches were cancelled.',
          now()+interval '2 hours','open','high','lead',l.id,l.account_id,cadence.email,
          cadence.email,
          'prospecting-reply:'||cadence.id::text
        from leads l where l.id=cadence.lead_id
        on conflict(inbound_reply_key) where inbound_reply_key is not null and status='open' do nothing;
      insert into notifications(type,message,href,read)
        values('outreach',cadence.full_name||' replied — prospecting plan stopped; follow up personally.',
          '/leads?lead='||cadence.lead_id::text,false);
    end if;
  end loop;
  result:=jsonb_build_object('sequenceLeadIds',to_jsonb(result_ids));
  if p_log_id is not null then update communication_log set outreach_reply_result=result where id=p_log_id; end if;
  return result;
end;
$$;

revoke all on function public.create_prospecting_cadence(uuid,uuid,uuid,jsonb,jsonb),
  public.complete_prospecting_call_touch(uuid,uuid,text),public.stop_prospecting_cadence(uuid,text,text),
  public.stop_prospecting_on_contact_preference(),public.stop_prospecting_on_pipeline_exit(),
  public.sync_prospecting_outbox_touch(),public.process_outreach_reply(uuid,text,text,text,uuid),
  public.block_duplicate_prospecting_sequence(),
  public.create_prospecting_email_draft(uuid,text,text,text,jsonb),
  public.create_prospecting_nurture(uuid,uuid,date),
  public.prospecting_contact_block(uuid,timestamptz),
  public.finalize_outreach_send(uuid,timestamptz),public.finalize_outreach_send_without_prospecting(uuid,timestamptz),
  public.claim_outreach_send(uuid,text,text,integer),public.claim_outreach_send_without_prospecting(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.create_prospecting_cadence(uuid,uuid,uuid,jsonb,jsonb),
  public.complete_prospecting_call_touch(uuid,uuid,text),public.stop_prospecting_cadence(uuid,text,text) to service_role;
grant execute on function public.process_outreach_reply(uuid,text,text,text,uuid),
  public.create_prospecting_email_draft(uuid,text,text,text,jsonb),
  public.create_prospecting_nurture(uuid,uuid,date),
  public.prospecting_contact_block(uuid,timestamptz),public.finalize_outreach_send(uuid,timestamptz),
  public.claim_outreach_send(uuid,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
