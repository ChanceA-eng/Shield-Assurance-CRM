begin;
create table public.sales_templates (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{0,79}$'),
  name text not null,
  category text not null,
  subject text not null,
  email_body text not null,
  sms_body text not null,
  archived boolean not null default false,
  revision integer not null check (revision > 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.sales_template_revisions (
  template_id text not null references public.sales_templates(id),
  revision integer not null,
  snapshot jsonb not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(template_id, revision)
);
alter table public.sales_templates enable row level security;
alter table public.sales_template_revisions enable row level security;
revoke all on public.sales_templates, public.sales_template_revisions from public, anon, authenticated;
grant all on public.sales_templates, public.sales_template_revisions to service_role;

create function public.save_sales_template(p_actor uuid, p_id text, p_expected integer, p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.sales_templates;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin')) then
    raise exception 'Only owners and admins can save shared templates' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('sales-template:'||p_id));
  select * into saved from sales_templates where id=p_id for update;
  if coalesce(saved.revision,0) is distinct from p_expected then
    raise exception 'Template changed. Reload the saved version before editing.' using errcode='40001';
  end if;
  if jsonb_typeof(p_values)<>'object'
    or coalesce(length(trim(p_values->>'name')),0) not between 1 and 150
    or coalesce(p_values->>'category','') not in ('First contact','Appointments','Information','Quotes','Closing','Reconnect')
    or coalesce(length(trim(p_values->>'subject')),0) not between 1 and 1000
    or coalesce(length(trim(p_values->>'email_body')),0) not between 1 and 10000
    or coalesce(length(trim(p_values->>'sms_body')),0) not between 1 and 1000
    or jsonb_typeof(p_values->'archived') is distinct from 'boolean' then
    raise exception 'Provide valid template fields' using errcode='22023';
  end if;
  insert into sales_templates(id,name,category,subject,email_body,sms_body,archived,revision,updated_by)
    values(p_id,p_values->>'name',p_values->>'category',p_values->>'subject',p_values->>'email_body',
      p_values->>'sms_body',(p_values->>'archived')::boolean,p_expected+1,p_actor)
    on conflict(id) do update set name=excluded.name,category=excluded.category,subject=excluded.subject,
      email_body=excluded.email_body,sms_body=excluded.sms_body,archived=excluded.archived,
      revision=excluded.revision,updated_by=p_actor,updated_at=clock_timestamp()
    returning * into saved;
  insert into sales_template_revisions(template_id,revision,snapshot,actor_id)
    values(p_id,saved.revision,to_jsonb(saved),p_actor);
  return to_jsonb(saved);
end;
$$;
revoke all on function public.save_sales_template(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_sales_template(uuid,text,integer,jsonb) to service_role;
alter table public.scheduled_messages add column sales_template jsonb;
alter table public.sequence_enrollments add column sales_plan jsonb;
alter table public.outreach_outbox add column sales_template jsonb;
alter table public.agent_email_attempts add column sales_template jsonb;
create function public.enroll_sales_sequence(p_actor uuid,p_lead uuid,p_plan jsonb,p_gap integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare enrollment sequence_enrollments; contact leads;
begin
  if not exists(select 1 from agency_members where user_id=p_actor and active) then
    raise exception 'Active membership required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('sales-enrollment:'||p_lead::text));
  select * into contact from leads where id=p_lead for update;
  if contact.id is null or contact.archived_at is not null or contact.status in ('won','lost')
    or (contact.agent_user_id is not null and contact.agent_user_id<>p_actor
      and exists(select 1 from agency_members where user_id=p_actor and role='agent'))
    then raise exception 'Lead unavailable for this sequence' using errcode='42501'; end if;
  if exists(select 1 from sequence_enrollments where lead_id=p_lead and status in ('active','paused')) then
    raise exception 'A sequence already exists for this lead' using errcode='23505'; end if;
  if exists(select 1 from scheduled_messages where status in ('pending','processing')
    and (lead_id=p_lead or (contact.account_id is not null and client_id=contact.account_id)
      or approved_recipient=lower(trim(contact.email)))) then
    raise exception 'Review the existing scheduled communication before enrolling' using errcode='22023'; end if;
  if p_gap not between 1 and 30 or jsonb_array_length(p_plan->'steps') not between 2 and 3
    or p_plan->>'actor' is distinct from p_actor::text
    or p_plan->>'stage' is distinct from contact.status
    or p_plan->>'recipient' is distinct from lower(trim(contact.email)) then
    raise exception 'Invalid sales sequence plan' using errcode='22023'; end if;
  insert into sequence_enrollments(lead_id,status,current_step,total_steps,step_gap_days,next_send_at,sales_plan,
    agent_user_id,gmail_connection_id,approved_sender,approved_recipient)
    values(p_lead,'active',0,jsonb_array_length(p_plan->'steps'),p_gap,now(),
      jsonb_set(p_plan,'{auto_send}','false'::jsonb),
      case when p_plan->>'mailbox' is not null then p_actor else null end,
      (p_plan->>'mailbox')::uuid,p_plan->'sender',p_plan->>'recipient') returning * into enrollment;
  return to_jsonb(enrollment);
end;
$$;
create function public.set_sales_sequence_state(p_actor uuid,p_id uuid,p_action text)
returns void language plpgsql security definer set search_path=public as $$
declare enrollment sequence_enrollments;
begin
  select * into enrollment from sequence_enrollments where id=p_id for update;
  if enrollment.sales_plan is null or enrollment.sales_plan->>'actor' is distinct from p_actor::text
    or not exists(select 1 from agency_members where user_id=p_actor and active) then
    raise exception 'Only the sequence owner can change this sequence' using errcode='42501'; end if;
  if enrollment.status not in ('active','paused') then
    raise exception 'Sequence is no longer active' using errcode='22023'; end if;
  if p_action not in ('enable_auto','disable_auto','pause','resume','cancel') then
    raise exception 'Choose a supported sequence action' using errcode='22023'; end if;
  update sequence_enrollments set
    sales_plan=jsonb_set(sales_plan,'{auto_send}',to_jsonb(p_action='enable_auto')),
    status=case when p_action='pause' then 'paused' when p_action='resume' then 'active'
      when p_action='cancel' then 'cancelled' else status end,
    ended_at=case when p_action='cancel' then now() else ended_at end,
    ended_reason=case when p_action='cancel' then 'Cancelled by sequence owner.' else ended_reason end
    where id=p_id;
  if p_action='cancel' then update outreach_outbox set status='rejected',error='Sales sequence cancelled.'
    where enrollment_id=p_id and status='pending_approval'; end if;
end;
$$;
create function public.stamp_sales_outreach() returns trigger language plpgsql set search_path=public as $$
declare plan jsonb; step jsonb;
begin
  select sales_plan into plan from sequence_enrollments where id=new.enrollment_id;
  if plan is not null then
    step=plan->'steps'->(new.step_number-1);
    new.sales_template=jsonb_build_object('id',step->'template'->>'id','revision',step->'template'->'revision');
    new.requires_manual_approval=coalesce((step->>'requires_review')::boolean,true);
  end if;
  return new;
end;
$$;
create trigger sales_outreach_identity before insert on public.outreach_outbox
  for each row execute function public.stamp_sales_outreach();
alter function public.claim_outreach_send(uuid,text,text,integer) rename to claim_pre_sales_outreach_send;
create function public.claim_outreach_send(p_outbox_id uuid,p_subject text,p_body text,p_expected_revision integer default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare enrollment sequence_enrollments; contact leads; plan jsonb;
begin
  select e.* into enrollment from sequence_enrollments e join outreach_outbox o on o.enrollment_id=e.id where o.id=p_outbox_id for update of e;
  plan=enrollment.sales_plan;
  if plan is not null then
    select * into contact from leads where id=enrollment.lead_id;
    if contact.status is distinct from plan->>'stage' or contact.agent_user_id::text is distinct from plan->>'assigned_agent'
      or lower(trim(contact.email)) is distinct from plan->>'recipient'
      or not exists(select 1 from agency_members where user_id=(plan->>'actor')::uuid and active)
      or (p_expected_revision is null and not coalesce((plan->>'auto_send')::boolean,false))
      or p_body like '%{{%' or p_subject like '%{{%' then return false; end if;
    if exists(select 1 from canonical_communications where conversation_key in
      ('lead:'||contact.id::text,'client:'||contact.account_id::text)
      and direction='inbound' and sent_at>enrollment.enrolled_at) then return false; end if;
    if exists(select 1 from scheduled_messages where status in ('pending','processing')
      and (lead_id=contact.id or client_id=contact.account_id or approved_recipient=plan->>'recipient')) then return false; end if;
    if exists(select 1 from jsonb_array_elements(plan->'steps') step
      left join sales_templates t on t.id=step->'template'->>'id'
      where coalesce(t.revision,0)<>(step->'template'->>'revision')::integer or coalesce(t.archived,false)) then return false; end if;
    if plan->'evidence'->>'type'='appointment' and not exists(select 1 from events
      where id=(plan->'evidence'->>'id')::uuid and status='completed'
      and updated_at=(plan->'evidence'->>'version')::timestamptz) then return false; end if;
    if plan->'evidence'->>'type'='quote' and not exists(select 1 from quote_options
      where id=(plan->'evidence'->>'id')::uuid and status in ('presented','accepted')
      and updated_at=(plan->'evidence'->>'version')::timestamptz) then return false; end if;
  end if;
  return claim_pre_sales_outreach_send(p_outbox_id,p_subject,p_body,p_expected_revision);
end;
$$;
revoke all on function public.enroll_sales_sequence(uuid,uuid,jsonb,integer),public.set_sales_sequence_state(uuid,uuid,text),
  public.stamp_sales_outreach(),public.claim_outreach_send(uuid,text,text,integer),public.claim_pre_sales_outreach_send(uuid,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.enroll_sales_sequence(uuid,uuid,jsonb,integer),public.set_sales_sequence_state(uuid,uuid,text),
  public.claim_outreach_send(uuid,text,text,integer) to service_role;
create function public.communication_sales_template() returns trigger
language plpgsql security definer set search_path=public as $$
declare provenance jsonb;
begin
  if new.direction='outbound' and new.metadata->>'provider'='gmail' then
    select sales_template into provenance from agent_email_attempts
      where rfc_message_id=new.metadata->>'rfc_message_id' limit 1;
  end if;
  if provenance is null and new.metadata->>'outbox_id' is not null then
    select sales_template into provenance from outreach_outbox where id=(new.metadata->>'outbox_id')::uuid;
  end if;
  if provenance is not null then
    new.metadata=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('sales_template',provenance);
  end if;
  return new;
end;
$$;
create trigger communication_sales_template before insert on public.communication_log
  for each row execute function public.communication_sales_template();
revoke all on function public.communication_sales_template() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
