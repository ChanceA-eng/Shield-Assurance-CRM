begin;
create table public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.agency_members(user_id),
  email text not null unique check(email=lower(trim(email))),
  status text not null default 'connected' check(status in ('connected','reconnect','disconnected')),
  history_id text,
  watch_expires_at timestamptz,
  watch_renewed_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  sync_requested_at timestamptz default now(),
  sync_lease_until timestamptz,
  sync_lease_token uuid,
  sync_started_at timestamptz,
  bootstrap_complete boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.gmail_tokens (
  connection_id uuid primary key references public.gmail_connections(id) on delete cascade,
  refresh_secret text not null,
  access_secret text,
  access_expires_at timestamptz,
  token_lock uuid,
  token_lease_until timestamptz
);
create table public.gmail_oauth_states (
  state_hash text primary key,
  user_id uuid not null references public.agency_members(user_id),
  verifier_secret text not null,
  browser_hash text not null,
  expires_at timestamptz not null
);
create table public.gmail_sync_pages (
  connection_id uuid references public.gmail_connections(id) on delete cascade,
  kind text not null,
  query text not null,
  page_token text,
  processed_thread_ids text[] not null default '{}',
  completed boolean not null default false,
  primary key(connection_id,kind,query)
);
create table public.gmail_thread_links (
  connection_id uuid references public.gmail_connections(id) on delete cascade,
  gmail_thread_id text,
  client_id uuid references public.clients(id),
  lead_id uuid references public.leads(id),
  status text not null check(status in ('linked','needs_review')),
  reason text,
  primary key(connection_id,gmail_thread_id)
);
create table public.gmail_message_links (
  connection_id uuid references public.gmail_connections(id) on delete cascade,
  gmail_message_id text,
  gmail_thread_id text not null,
  communication_id uuid not null references public.communication_log(id),
  primary key(connection_id,gmail_message_id)
);
create table public.agent_email_attempts (
  id uuid primary key,
  user_id uuid not null references public.agency_members(user_id),
  connection_id uuid not null references public.gmail_connections(id),
  client_id uuid references public.clients(id),
  lead_id uuid references public.leads(id),
  to_email text not null,
  subject text not null,
  body text not null,
  content_hash text not null,
  attachments jsonb not null default '[]',
  status text not null default 'sending' check(status in ('sending','acceptance_unknown','accepted_by_provider','recorded')),
  provider_message_id text,
  provider_thread_id text,
  rfc_message_id text not null unique,
  communication_id uuid references public.communication_log(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index agent_one_unresolved_recipient on public.agent_email_attempts(user_id,to_email) where status in ('sending','acceptance_unknown','accepted_by_provider');
alter table public.sequence_enrollments
  add column agent_user_id uuid references public.agency_members(user_id),
  add column gmail_connection_id uuid references public.gmail_connections(id),
  add column template text not null default 'auto',
  add column auto_send_enabled boolean not null default false,
  add column approved_sender jsonb,
  add column approved_recipient text;
alter table public.outreach_outbox
  add column agent_user_id uuid references public.agency_members(user_id),
  add column gmail_connection_id uuid references public.gmail_connections(id),
  add column provider_message_id text,
  add column provider_thread_id text;
alter table public.scheduled_messages
  add column agent_user_id uuid references public.agency_members(user_id),
  add column gmail_connection_id uuid references public.gmail_connections(id),
  add column approved_sender jsonb,
  add column approved_recipient text,
  add column last_error text;
create table public.marketing_email_consents (
  email text primary key check(email=lower(trim(email))),
  purpose text not null default 'outreach',
  source text not null check(length(trim(source))>0),
  consented_at timestamptz not null,
  recorded_by uuid not null references public.agency_members(user_id),
  revoked_at timestamptz
);
create function public.connect_agent_gmail(p_user uuid,p_email text,p_refresh text,p_access text,p_expires timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; old_email text;
begin
  perform pg_advisory_xact_lock(hashtext('gmail-connect'));
  if not exists(select 1 from agency_members where user_id=p_user and active) then raise exception 'Active membership required' using errcode='42501'; end if;
  select email into old_email from gmail_connections where user_id=p_user;
  if old_email is not null and old_email<>p_email then raise exception 'A different mailbox cannot replace an existing mailbox; contact the owner for a reviewed migration' using errcode='22023'; end if;
  insert into gmail_connections(user_id,email) values(p_user,p_email)
    on conflict(user_id) do update set status='connected',last_error=null,sync_requested_at=now()
    returning id into result;
  insert into gmail_tokens(connection_id,refresh_secret,access_secret,access_expires_at)
    values(result,p_refresh,p_access,p_expires) on conflict(connection_id) do update
      set refresh_secret=p_refresh,access_secret=p_access,access_expires_at=p_expires,token_lock=null,token_lease_until=null;
  insert into agency_audit(actor_id,target_id,action) values(p_user,result,'gmail_connected');
  return result;
end;
$$;
create function public.disconnect_agent_gmail(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
declare connection uuid;
begin
  update gmail_connections set status='disconnected',sync_requested_at=null,sync_lease_until=null,sync_lease_token=null where user_id=p_user returning id into connection;
  delete from gmail_tokens where connection_id=connection;
  delete from gmail_oauth_states where user_id=p_user;
  update sequence_enrollments set status='paused',auto_send_enabled=false where agent_user_id=p_user and status='active';
  insert into agency_audit(actor_id,target_id,action) values(p_user,connection,'gmail_disconnected');
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['gmail_connections','gmail_tokens','gmail_oauth_states','gmail_sync_pages','gmail_thread_links','gmail_message_links','agent_email_attempts','marketing_email_consents'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end;
$$;

create function public.claim_gmail_token(p_connection_id uuid,p_lock uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update gmail_tokens set token_lock=p_lock,token_lease_until=now()+interval '60 seconds'
    where connection_id=p_connection_id and (token_lease_until is null or token_lease_until<now())
      and exists(select 1 from gmail_connections c join agency_members m on m.user_id=c.user_id
        where c.id=p_connection_id and c.status='connected' and m.active);
  return found;
end;
$$;
create function public.claim_gmail_sync(p_connection_id uuid)
returns setof public.gmail_connections language plpgsql security definer set search_path=public as $$
begin
  return query update gmail_connections c set sync_lease_token=gen_random_uuid(),
    sync_lease_until=now()+interval '5 minutes',sync_started_at=now()
    where c.id=p_connection_id and c.status='connected'
      and (c.sync_lease_until is null or c.sync_lease_until<now())
      and exists(select 1 from agency_members m where m.user_id=c.user_id and m.active)
    returning c.*;
end;
$$;
create function public.finish_gmail_sync(p_connection_id uuid,p_lease_token uuid,p_history_id text,p_bootstrap_complete boolean,p_error text,p_more_work boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update gmail_connections set history_id=p_history_id,bootstrap_complete=p_bootstrap_complete,
    last_error=p_error,last_sync_at=case when p_error is null then now() else last_sync_at end,
    sync_requested_at=case when p_error is null and not p_more_work and sync_requested_at<=sync_started_at then null
      when p_more_work then coalesce(sync_requested_at,now()) else sync_requested_at end,
    sync_lease_token=null,sync_lease_until=null
    where id=p_connection_id and sync_lease_token=p_lease_token and sync_lease_until>now();
  return found;
end;
$$;
create function public.renew_gmail_sync(p_connection_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update gmail_connections c set sync_lease_until=now()+interval '5 minutes'
    where c.id=p_connection_id and c.sync_lease_token=p_lease_token and c.sync_lease_until>now() and c.status='connected'
      and exists(select 1 from agency_members where user_id=c.user_id and active);
  return found;
end;
$$;

create function public.gmail_ingest_message(p_connection_id uuid,p_message jsonb,p_historical boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare c gmail_connections; link gmail_thread_links; result uuid; rfc text; existing agent_email_attempts; participant_email text; identities text[];
begin
  perform pg_advisory_xact_lock(hashtext('gmail-ingest'));
  select * into c from gmail_connections where id=p_connection_id and status='connected' for update;
  if c.id is null or not exists(select 1 from agency_members where user_id=c.user_id and active) then
    raise exception 'Mailbox is inactive' using errcode='42501'; end if;
  if c.sync_lease_token is distinct from (p_message->>'lease_token')::uuid or c.sync_lease_until<=now() then
    raise exception 'Sync lease expired' using errcode='40001'; end if;
  select * into link from gmail_thread_links where connection_id=c.id and gmail_thread_id=p_message->>'thread_id' and status='linked';
  if not found then return null; end if;
  if jsonb_typeof(p_message->'participants') is distinct from 'array' or jsonb_array_length(p_message->'participants')=0 then
    raise exception 'Thread participant validation required' using errcode='22023'; end if;
  for participant_email in select jsonb_array_elements_text(p_message->'participants') loop
    select array_agg(distinct identity) into identities from (
      select 'client:'||id::text as identity from clients where lower(trim(email))=participant_email
      union all select case when account_id is null then 'lead:'||id::text else 'client:'||account_id::text end
        from leads where lower(trim(email))=participant_email
    ) matched;
    if cardinality(identities) is distinct from 1 or identities[1]<>(case when link.client_id is null then 'lead:'||link.lead_id::text else 'client:'||link.client_id::text end) then
      raise exception 'Thread participants changed; rematch before importing' using errcode='22023';
    end if;
  end loop;
  if not exists(
    select 1 from clients where id=link.client_id and lower(trim(email))=p_message->>'counterpart'
    union all select 1 from leads where (id=link.lead_id or account_id=link.client_id) and lower(trim(email))=p_message->>'counterpart'
  ) then raise exception 'Contact address changed; rematch before importing' using errcode='22023'; end if;
  select communication_id into result from gmail_message_links where connection_id=c.id and gmail_message_id=p_message->>'id';
  if found then
    if not p_historical and p_message->>'direction'='inbound' then
      update communication_log set metadata=metadata||'{"historical_import":false}'::jsonb,read_at=null
        where id=result and metadata->>'historical_import'='true';
      if found then
        perform public.process_outreach_reply(link.client_id,p_message->>'from',null,p_message->>'body',result);
        perform public.alert_inbound_message(result,false);
      end if;
    end if;
    return result;
  end if;
  rfc:=nullif(p_message->>'rfc_message_id','');
  if rfc is not null then
    select * into existing from agent_email_attempts where rfc_message_id=rfc and connection_id=c.id
      and p_message->>'direction'='outbound' and p_message->>'from'=c.email and p_message->>'counterpart'=to_email
      and p_message->>'body'=body and p_message->>'subject'=subject;
    result:=existing.communication_id;
    if result is null then
      select id into result from communication_log where metadata->>'rfc_message_id'=rfc
        and client_id is not distinct from link.client_id
        and (link.client_id is not null or metadata->>'lead_id'=link.lead_id::text)
        and direction=p_message->>'direction' and metadata->>'from'=p_message->>'from' and metadata->>'to'=p_message->>'to' and body=p_message->>'body'
        and subject is not distinct from p_message->>'subject' limit 1;
    end if;
  end if;
  if result is null then
    insert into communication_log(client_id,channel,direction,subject,body,automation_type,sent_at,read_at,metadata)
      values(link.client_id,'email',p_message->>'direction',p_message->>'subject',p_message->>'body','gmail_sync',
        (p_message->>'sent_at')::timestamptz,
        case when p_historical then now() else null end,
        jsonb_build_object('provider','gmail','gmail_origin',true,'gmail_connection_id',c.id,'agent_user_id',c.user_id,
          'from',p_message->>'from','to',p_message->>'to','lead_id',link.lead_id,
          'gmail_message_id',p_message->>'id','gmail_thread_id',p_message->>'thread_id',
          'rfc_message_id',rfc,'in_reply_to',p_message->>'in_reply_to','references',p_message->>'references',
          'historical_import',p_historical,'attachments',p_message->'attachments'))
      returning id into result;
    if not p_historical and p_message->>'direction'='inbound' then
      perform public.process_outreach_reply(link.client_id,p_message->>'from',null,p_message->>'body',result);
      perform public.alert_inbound_message(result,false);
    end if;
  elsif not p_historical and p_message->>'direction'='inbound' then
    update communication_log set metadata=metadata||'{"historical_import":false}'::jsonb,read_at=null
      where id=result and metadata->>'historical_import'='true';
    if found then
      perform public.process_outreach_reply(link.client_id,p_message->>'from',null,p_message->>'body',result);
      perform public.alert_inbound_message(result,false);
    end if;
  end if;
  insert into gmail_message_links values(c.id,p_message->>'id',p_message->>'thread_id',result);
  if existing.id is not null then
    update agent_email_attempts set status='recorded',provider_message_id=p_message->>'id',
      provider_thread_id=p_message->>'thread_id',communication_id=result,accepted_at=coalesce(accepted_at,now()) where id=existing.id;
  end if;
  return result;
end;
$$;
create function public.invalidate_agent_approvals() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_table_name='agency_members' then
    update sequence_enrollments set auto_send_enabled=false where agent_user_id=new.user_id;
    if not new.active then
      update sequence_enrollments set status='paused',auto_send_enabled=false where agent_user_id=new.user_id and status='active';
    end if;
  else
    update sequence_enrollments set auto_send_enabled=false where
      (tg_table_name='leads' and lead_id=new.id) or
      (tg_table_name='clients' and lead_id in(select id from leads where account_id=new.id));
  end if;
  return new;
end;
$$;
create trigger agent_approval_profile after update of sender_profile,active on public.agency_members for each row
  when(old.sender_profile is distinct from new.sender_profile or old.active is distinct from new.active) execute function public.invalidate_agent_approvals();
create trigger agent_approval_lead after update of email,agent_user_id on public.leads for each row
  when(old.email is distinct from new.email or old.agent_user_id is distinct from new.agent_user_id) execute function public.invalidate_agent_approvals();
create trigger agent_approval_client after update of email,agent_user_id on public.clients for each row
  when(old.email is distinct from new.email or old.agent_user_id is distinct from new.agent_user_id) execute function public.invalidate_agent_approvals();

create function public.record_marketing_consent(p_actor uuid,p_email text,p_source text,p_granted boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from agency_members where user_id=p_actor and active) then raise exception 'Active agent required' using errcode='42501'; end if;
  insert into marketing_email_consents(email,source,consented_at,recorded_by,revoked_at) values(p_email,p_source,now(),p_actor,case when p_granted then null else now() end)
    on conflict(email) do update set source=excluded.source,consented_at=excluded.consented_at,recorded_by=p_actor,revoked_at=excluded.revoked_at;
  insert into agency_audit(actor_id,action,details) values(p_actor,'marketing_consent_recorded',jsonb_build_object('email',p_email,'source',p_source,'granted',p_granted));
end;
$$;
create function public.authorize_agent_sequence(p_actor uuid,p_enrollment uuid,p_template text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare enrollment sequence_enrollments; sender jsonb; recipient text;
begin
  select * into enrollment from sequence_enrollments where id=p_enrollment and agent_user_id=p_actor for update;
  if enrollment.id is null then raise exception 'Owned enrollment required' using errcode='42501'; end if;
  select sender_profile into sender from agency_members where user_id=p_actor and active;
  if sender is null then raise exception 'Complete agent profile required' using errcode='22023'; end if;
  if p_template not in ('auto','quote_response','missing_information','renewal_review','cross_sell','reactivation') then raise exception 'Invalid template' using errcode='22023'; end if;
  if enrollment.template<>p_template and exists(select 1 from outreach_outbox where enrollment_id=enrollment.id and status in ('pending_approval','sending','acceptance_unknown','accepted_by_provider')) then
    raise exception 'Review existing drafts before changing the sequence purpose' using errcode='22023'; end if;
  select lower(trim(email)) into recipient from leads where id=enrollment.lead_id;
  if p_enabled and (not exists(select 1 from marketing_email_consents where email=recipient and revoked_at is null) or
    not exists(select 1 from gmail_connections where id=enrollment.gmail_connection_id and user_id=p_actor and status='connected')) then
    raise exception 'Recorded marketing consent and connected owned mailbox required' using errcode='22023'; end if;
  update sequence_enrollments set auto_send_enabled=p_enabled,template=p_template,approved_sender=sender,approved_recipient=recipient where id=enrollment.id;
  insert into agency_audit(actor_id,target_id,action,details) values(p_actor,p_enrollment,'sequence_auto_send_authorized',jsonb_build_object('template',p_template,'enabled',p_enabled));
end;
$$;

create function public.gmail_history_only() returns trigger language plpgsql set search_path=public as $$
begin
  if new.metadata->>'historical_import'='true' then
    new.read_at:=coalesce(new.read_at,now());
  end if;
  return new;
end;
$$;
create function public.finalize_agent_email(p_attempt_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare attempt agent_email_attempts; result uuid;
begin
  perform pg_advisory_xact_lock(hashtext('gmail-ingest'));
  select * into attempt from agent_email_attempts where id=p_attempt_id for update;
  if attempt.id is null or attempt.status not in ('accepted_by_provider','recorded') then
    raise exception 'Provider acceptance is not established; do not resend' using errcode='22023'; end if;
  if attempt.communication_id is not null then return attempt.communication_id; end if;
  insert into communication_log(client_id,channel,direction,subject,body,automation_type,sent_at,metadata)
    values(attempt.client_id,'email','outbound',attempt.subject,attempt.body,
      coalesce((select automation_type from scheduled_messages where id=attempt.id),
        case when exists(select 1 from outreach_outbox where id=attempt.id) then 'outreach_sequence' else 'manual' end),attempt.accepted_at,
      jsonb_build_object('provider','gmail','delivery_status','accepted_by_provider','gmail_origin',true,
        'from',(select email from gmail_connections where id=attempt.connection_id),'attachments',attempt.attachments,
        'outbox_id',case when exists(select 1 from outreach_outbox where id=attempt.id) then attempt.id else null end,
        'agent_user_id',attempt.user_id,'gmail_connection_id',attempt.connection_id,
        'lead_id',attempt.lead_id,'to',attempt.to_email,'rfc_message_id',attempt.rfc_message_id,
        'gmail_message_id',attempt.provider_message_id,'gmail_thread_id',attempt.provider_thread_id))
    returning id into result;
  insert into gmail_thread_links(connection_id,gmail_thread_id,client_id,lead_id,status)
    values(attempt.connection_id,attempt.provider_thread_id,attempt.client_id,attempt.lead_id,'linked')
    on conflict(connection_id,gmail_thread_id) do nothing;
  insert into gmail_message_links values(attempt.connection_id,attempt.provider_message_id,attempt.provider_thread_id,result)
    on conflict(connection_id,gmail_message_id) do nothing;
  update agent_email_attempts set status='recorded',communication_id=result where id=attempt.id;
  return result;
end;
$$;
create function public.stamp_agent_outreach() returns trigger language plpgsql set search_path=public as $$
begin
  select agent_user_id,gmail_connection_id into new.agent_user_id,new.gmail_connection_id
    from sequence_enrollments where id=new.enrollment_id;
  return new;
end;
$$;
create trigger agent_outreach_identity before insert on public.outreach_outbox for each row execute function public.stamp_agent_outreach();

alter function public.finalize_outreach_send(uuid,timestamptz) rename to finalize_legacy_outreach_send;
create function public.finalize_outreach_send(p_outbox_id uuid,p_followup_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare item outreach_outbox; enrollment sequence_enrollments;
begin
  select * into item from outreach_outbox where id=p_outbox_id;
  if item.agent_user_id is null then return finalize_legacy_outreach_send(p_outbox_id,p_followup_at); end if;
  select * into enrollment from sequence_enrollments where id=item.enrollment_id for update;
  select * into item from outreach_outbox where id=p_outbox_id for update;
  if item.status='sent' then return true; end if;
  if item.status<>'accepted_by_provider' or not exists(select 1 from agent_email_attempts where id=item.id and status='recorded') then
    raise exception 'Provider acceptance recording is incomplete; do not resend' using errcode='22023'; end if;
  if enrollment.status='active' and enrollment.current_step<item.step_number then
    update sequence_enrollments set current_step=item.step_number,last_sent_at=item.sent_at,
      status=case when item.step_number>=total_steps then 'completed' else status end,
      next_send_at=case when item.step_number>=total_steps then null else
        (date_trunc('day',item.sent_at at time zone 'America/Phoenix')+make_interval(days=>step_gap_days,hours=>9)) at time zone 'America/Phoenix' end,
      ended_at=case when item.step_number>=total_steps then now() else ended_at end,
      ended_reason=case when item.step_number>=total_steps then 'All emails accepted by provider; delivery is not confirmed.' else ended_reason end
      where id=enrollment.id;
    if item.step_number>=enrollment.total_steps then
      insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
        select 'Call '||full_name||' - email sequence finished',
          'Sequence emails were accepted by the provider, not confirmed delivered. Follow up by phone.',
          p_followup_at,'open','high','lead',id from leads where id=item.lead_id;
    end if;
  end if;
  update outreach_outbox set status='sent',error=null where id=item.id;
  return true;
end;
$$;
create trigger gmail_history_marker before insert on public.communication_log for each row execute function public.gmail_history_only();
drop trigger internal_reply_resolution on public.communication_log;
create trigger internal_reply_resolution after insert or update of direction,metadata on public.communication_log
  for each row when (coalesce(new.metadata->>'historical_import','false')<>'true') execute function public.internal_action_source_changed();

revoke all on function public.claim_gmail_token(uuid,uuid),public.claim_gmail_sync(uuid),public.finish_gmail_sync(uuid,uuid,text,boolean,text,boolean),public.gmail_ingest_message(uuid,jsonb,boolean),public.gmail_history_only(),public.connect_agent_gmail(uuid,text,text,text,timestamptz),public.disconnect_agent_gmail(uuid),public.finalize_agent_email(uuid) from public,anon,authenticated;
revoke all on function public.finalize_outreach_send(uuid,timestamptz),public.finalize_legacy_outreach_send(uuid,timestamptz),public.stamp_agent_outreach() from public,anon,authenticated;
revoke all on function public.renew_gmail_sync(uuid,uuid) from public,anon,authenticated;
revoke all on function public.invalidate_agent_approvals(),public.record_marketing_consent(uuid,text,text,boolean),public.authorize_agent_sequence(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.record_marketing_consent(uuid,text,text,boolean),public.authorize_agent_sequence(uuid,uuid,text,boolean) to service_role;
grant execute on function public.renew_gmail_sync(uuid,uuid) to service_role;
grant execute on function public.finalize_outreach_send(uuid,timestamptz) to service_role;
grant execute on function public.claim_gmail_token(uuid,uuid),public.claim_gmail_sync(uuid),public.finish_gmail_sync(uuid,uuid,text,boolean,text,boolean),public.gmail_ingest_message(uuid,jsonb,boolean),public.connect_agent_gmail(uuid,text,text,text,timestamptz),public.disconnect_agent_gmail(uuid),public.finalize_agent_email(uuid) to service_role;
notify pgrst,'reload schema';
commit;
