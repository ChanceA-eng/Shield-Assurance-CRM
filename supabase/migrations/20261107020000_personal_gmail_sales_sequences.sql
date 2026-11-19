begin;

create function public.enroll_personal_gmail_sales_sequence(p_actor uuid,p_lead uuid,p_plan jsonb,p_gap integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; approved boolean:=coalesce((p_plan->>'auto_send')::boolean,false);
begin
  if not exists(select 1 from gmail_connections where id=(p_plan->>'mailbox')::uuid
    and user_id=p_actor and status='connected') then
    raise exception 'Connect your Gmail mailbox before enrolling.' using errcode='42501';
  end if;
  if approved and exists(select 1 from jsonb_array_elements(p_plan->'steps') step
    where coalesce((step->>'requires_review')::boolean,true)) then
    raise exception 'Review every step before approving the whole sequence.' using errcode='22023';
  end if;
  if exists(select 1 from marketing_email_consents where email=p_plan->>'recipient' and revoked_at is not null) then
    raise exception 'This recipient declined marketing email.' using errcode='42501';
  end if;
  result:=enroll_sales_sequence(p_actor,p_lead,p_plan,p_gap);
  if approved then
    perform set_sales_sequence_state(p_actor,(result->>'id')::uuid,'enable_auto');
    select to_jsonb(e) into result from sequence_enrollments e where id=(result->>'id')::uuid;
  end if;
  return result;
end;
$$;

create or replace function public.claim_pre_sales_outreach_send(
  p_outbox_id uuid,p_subject text,p_body text,p_expected_revision integer default null
) returns boolean language plpgsql security definer set search_path=public as $$
declare item outreach_outbox; enrollment sequence_enrollments; cap integer; reviewed_gmail boolean;
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
  reviewed_gmail:=enrollment.sales_plan is not null and item.sales_template is not null
    and item.gmail_connection_id=enrollment.gmail_connection_id
    and item.agent_user_id=enrollment.agent_user_id
    and enrollment.sales_plan->>'actor'=item.agent_user_id::text
    and exists(select 1 from gmail_connections where id=item.gmail_connection_id
      and user_id=item.agent_user_id and status='connected');
  if exists(select 1 from outreach_opt_outs where email=lower(btrim(item.to_email)))
    or exists(select 1 from email_suppressions where email=lower(btrim(item.to_email)))
    or exists(select 1 from marketing_email_consents where email=lower(btrim(item.to_email)) and revoked_at is not null)
    or (not coalesce(reviewed_gmail,false) and not exists(select 1 from marketing_email_consents
      where email=lower(btrim(item.to_email)) and revoked_at is null)) then return false; end if;
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

revoke all on function public.enroll_personal_gmail_sales_sequence(uuid,uuid,jsonb,integer),
  public.claim_pre_sales_outreach_send(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.enroll_personal_gmail_sales_sequence(uuid,uuid,jsonb,integer) to service_role;
notify pgrst,'reload schema';
create function public.queue_personal_gmail()
returns bigint language plpgsql security definer set search_path=public as $$
declare endpoint text; bearer_secret text; request_id bigint;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='crm_heartbeat_endpoint';
  select decrypted_secret into bearer_secret from vault.decrypted_secrets where name='crm_heartbeat_authorization';
  if endpoint is distinct from 'https://shield-assurance-crm.vercel.app/api/cron/heartbeat' or nullif(bearer_secret,'') is null then
    raise exception 'Gmail scheduling credentials are not configured' using errcode='P0002';
  end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer_secret),
    body:=jsonb_build_object('job','personal-gmail'),timeout_milliseconds:=65000) into request_id;
  return request_id;
end;
$$;
do $$
declare job bigint;
begin
  job:=cron.schedule('crm-personal-gmail','*/5 * * * *','select public.queue_personal_gmail()');
  perform cron.alter_job(job,active:=false);
end;
$$;
create function public.configure_personal_gmail_scheduler(p_actor uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare job bigint;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if p_enabled is null or not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can change Gmail scheduling' using errcode='42501';
  end if;
  if p_enabled and not (crm_scheduler_status()->>'configured')::boolean then
    raise exception 'Gmail scheduling credentials are not configured' using errcode='P0002';
  end if;
  select jobid into job from cron.job where jobname='crm-personal-gmail';
  if job is null then raise exception 'The Gmail scheduler is not installed' using errcode='P0002'; end if;
  perform cron.alter_job(job,active:=p_enabled);
  insert into agency_audit(actor_id,action,details) values(p_actor,'personal_gmail_scheduler_changed',jsonb_build_object('enabled',p_enabled));
  return p_enabled;
end;
$$;
revoke all on function public.queue_personal_gmail(),public.configure_personal_gmail_scheduler(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.configure_personal_gmail_scheduler(uuid,boolean) to service_role;
commit;
