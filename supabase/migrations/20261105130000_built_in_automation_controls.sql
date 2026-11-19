begin;

create function public.validate_automation_configuration(p_value jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare baseline jsonb:=default_automation_configuration(); k text; f text; v jsonb; n integer; previous integer:=366;
begin
  if jsonb_typeof(p_value) is distinct from 'object' or p_value->'schema_version' is distinct from '1'::jsonb
    or (select array_agg(key order by key) from jsonb_object_keys(p_value) key)
      is distinct from (select array_agg(key order by key) from jsonb_object_keys(baseline) key) then
    raise exception 'Unsupported automation configuration' using errcode='22023';
  end if;
  for k in select key from jsonb_object_keys(baseline) key where key<>'schema_version' loop
    if jsonb_typeof(p_value->k) is distinct from 'object'
      or (select array_agg(key order by key) from jsonb_object_keys(p_value->k) key)
        is distinct from (select array_agg(key order by key) from jsonb_object_keys(baseline->k) key) then
      raise exception 'Incomplete automation group: %',k using errcode='22023';
    end if;
    for f in select jsonb_object_keys(baseline->k) loop
      if jsonb_typeof(baseline->k->f)='boolean' and jsonb_typeof(p_value->k->f) is distinct from 'boolean' then
        raise exception 'Invalid automation switch: %.%',k,f using errcode='22023';
      end if;
      if jsonb_typeof(baseline->k->f)='string' and jsonb_typeof(p_value->k->f) is distinct from 'string' then
        raise exception 'Invalid automation text' using errcode='22023';
      end if;
      if jsonb_typeof(baseline->k->f)='number' and (jsonb_typeof(p_value->k->f) is distinct from 'number'
        or (p_value->k->>f) !~ '^[0-9]+$') then raise exception 'Invalid automation number' using errcode='22023'; end if;
    end loop;
  end loop;
  if (p_value#>>'{intake,due_hour}')::numeric not between 0 and 23
    or (p_value#>>'{follow_up,due_hour}')::numeric not between 0 and 23
    or p_value#>>'{intake,warm_priority}' not in ('low','medium','high')
    or p_value#>>'{intake,cold_priority}' not in ('low','medium','high')
    or p_value#>>'{follow_up,priority}' not in ('low','medium','high')
    or (p_value#>>'{reply,due_minutes}')::numeric not between 5 and 10080
    or (p_value#>>'{renewal,window_days}')::numeric not between 1 and 365
    or (p_value#>>'{renewal,grace_days}')::numeric not between 0 and 90
    or (p_value#>>'{renewal,task_days_before}')::numeric not between 0 and (p_value#>>'{renewal,window_days}')::numeric
    or (p_value#>>'{renewal,urgent_days_before}')::numeric not between 0 and (p_value#>>'{renewal,window_days}')::numeric
    or (p_value#>>'{sequence,total_steps}')::numeric not between 1 and 10
    or (p_value#>>'{sequence,step_gap_days}')::numeric not between 1 and 60 then
    raise exception 'Automation timing or priority is invalid' using errcode='22023';
  end if;
  v:=p_value#>'{follow_up,statuses}';
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)=0
    or exists(select 1 from jsonb_array_elements_text(v) status where status not in ('new','contacted','quoted','negotiation'))
    or (select count(distinct status) from jsonb_array_elements_text(v) status)<>jsonb_array_length(v) then
    raise exception 'Choose supported follow-up stages without duplicates' using errcode='22023';
  end if;
  v:=p_value#>'{renewal,milestones}';
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) not between 1 and 12 then
    raise exception 'Choose between one and twelve renewal milestones' using errcode='22023';
  end if;
  for f in select jsonb_array_elements_text(v) loop
    if f !~ '^[0-9]+$' or f::numeric not between 0 and (p_value#>>'{renewal,window_days}')::numeric or f::numeric>=previous then
      raise exception 'Renewal milestones must decrease within the window' using errcode='22023';
    end if;
    previous:=f::integer;
  end loop;
  if previous<>0 then raise exception 'Renewal milestones must end at zero' using errcode='22023'; end if;
  if (p_value#>>'{sequence,auto_enroll_imports}')::boolean or (p_value#>>'{sequence,auto_enroll_website}')::boolean then
    raise exception 'Automatic enrollment requires its event executor' using errcode='22023';
  end if;
  return true;
end;
$$;
alter table public.outreach_settings drop constraint automation_configuration_runtime_guard;
alter table public.outreach_settings add constraint automation_configuration_valid
  check(public.validate_automation_configuration(automation_configuration));

create table public.automation_rule_activation (
  rule text primary key check(rule in ('intake','follow_up','reply','renewal','reminders','service')),
  active_since timestamptz not null default '-infinity'
);
insert into public.automation_rule_activation(rule) values('intake'),('follow_up'),('reply'),('renewal'),('reminders'),('service');
alter table public.automation_rule_activation enable row level security;
revoke all on public.automation_rule_activation from public,anon,authenticated,service_role;
grant select on public.automation_rule_activation to service_role;

create function public.automation_rule_policy(p_rule text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare configuration jsonb;
begin
  select automation_configuration into configuration from outreach_settings where id=1;
  if configuration is null or configuration->p_rule is null then
    raise exception 'Automation configuration is not initialized' using errcode='P0002';
  end if;
  return configuration->p_rule;
end;
$$;
create function public.automation_rule_allows(p_rule text,p_event_at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path=public as $$
declare policy jsonb; started timestamptz;
begin
  policy:=automation_rule_policy(p_rule);
  select active_since into started from automation_rule_activation where rule=p_rule;
  if started is null then raise exception 'Automation activation is not initialized' using errcode='P0002'; end if;
  return coalesce((policy->>case when p_rule='service' then 'tasks_enabled' else 'enabled' end)::boolean,false)
    and p_event_at>=started;
end;
$$;
create function public.capture_automation_activation()
returns trigger language plpgsql security definer set search_path=public as $$
declare k text; field text;
begin
  for k in select rule from automation_rule_activation loop
    field:=case when k='service' then 'tasks_enabled' else 'enabled' end;
    if (new.automation_configuration->k->>field)::boolean and not (old.automation_configuration->k->>field)::boolean then
      update automation_rule_activation set active_since=clock_timestamp() where rule=k;
    end if;
  end loop;
  return null;
end;
$$;
create trigger capture_automation_activation after update of automation_configuration on outreach_settings
  for each row execute function capture_automation_activation();

create function public.save_agency_automation_settings(p_actor uuid,p_configuration jsonb,p_expected_revision integer)
returns integer language plpgsql security definer set search_path=public as $$
declare revision integer;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can change agency settings' using errcode='42501';
  end if;
  select configuration_revision into revision from outreach_settings where id=1 for update;
  if not found then raise exception 'Agency settings are not initialized' using errcode='P0002'; end if;
  if p_expected_revision is null or p_expected_revision<>revision then
    raise sqlstate 'PT409' using message='Settings changed since you opened them. Reload before saving.';
  end if;
  perform validate_automation_configuration(p_configuration);
  perform set_config('crm.settings_actor',p_actor::text,true);
  update outreach_settings set automation_configuration=p_configuration where id=1;
  perform set_config('crm.settings_actor','',true);
  insert into agency_audit(actor_id,action,details) values(p_actor,'automation_settings_saved',jsonb_build_object('previous_revision',revision));
  select configuration_revision into revision from outreach_settings where id=1;
  return revision;
end;
$$;

create function public.intake_due_at(p_warm boolean,p_now timestamptz default now())
returns timestamptz language plpgsql stable security definer set search_path=public as $$
declare policy jsonb:=automation_rule_policy('intake'); local_due timestamp;
begin
  local_due:=date_trunc('day',p_now at time zone 'America/Phoenix')+make_interval(hours=>(policy->>'due_hour')::integer);
  if (not p_warm and (policy->>'cold_next_business_day')::boolean)
    or (p_warm and local_due<(p_now at time zone 'America/Phoenix')+interval '15 minutes')
    or (not p_warm and local_due<=(p_now at time zone 'America/Phoenix')) then local_due:=local_due+interval '1 day'; end if;
  while extract(isodow from local_due) in (6,7) loop local_due:=local_due+interval '1 day'; end loop;
  return local_due at time zone 'America/Phoenix';
end;
$$;
create function public.schedule_lead_intake(p_lead uuid,p_warm boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare lead leads; policy jsonb:=automation_rule_policy('intake');
begin
  select * into lead from leads where id=p_lead for update;
  if lead.id is null then raise exception 'Lead not found' using errcode='P0002'; end if;
  if lead.archived_at is not null or not automation_rule_allows('intake',lead.created_at) then return false; end if;
  if exists(select 1 from tasks where related_type='lead' and related_id=lead.id and status='open' and due_date<=now()+interval '7 days') then return false; end if;
  insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
  values(case when p_warm then 'Contact warm lead: ' else 'Contact new lead: ' end||lead.full_name,
    case when p_warm then 'Warm inbound lead - reach out while interest is fresh.' else 'New prospect added to your pipeline - make the first touch.' end,
    intake_due_at(p_warm),'open',policy->>case when p_warm then 'warm_priority' else 'cold_priority' end,'lead',lead.id);
  if p_warm then
    insert into notifications(type,message,href,read) values('new_lead','Warm lead in: '||lead.full_name||' - first-contact task queued.','/leads?lead='||lead.id,false);
  end if;
  return true;
end;
$$;
create or replace function public.create_intake_work(p_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare event lead_intake_events; lead leads; policy jsonb:=automation_rule_policy('intake');
begin
  select * into event from lead_intake_events where id=p_event_id;
  select * into lead from leads where id=event.lead_id;
  if not found then raise exception 'Lead not found.' using errcode='P0002'; end if;
  if automation_rule_allows('intake',event.received_at) then
    insert into tasks(subject,description,due_date,priority,related_type,related_id,account_id,intake_event_id)
    values(lead.full_name||': respond to website request','Review the submitted answers, confirm what they need, and contact them using their requested method.',
      intake_due_at(true),policy->>'warm_priority','lead',lead.id,lead.account_id,event.id)
      on conflict(intake_event_id) where intake_event_id is not null do nothing;
  end if;
  -- Request visibility is independent of whether task automation is enabled.
  insert into notifications(client_id,intake_event_id,type,message,href,read)
  values(lead.account_id,event.id,'new_lead',lead.full_name||' submitted a website request. Review their answers.',
    '/leads?lead='||lead.id||'&intake='||event.id,false)
    on conflict(intake_event_id) where intake_event_id is not null do nothing;
end;
$$;

create or replace function public.ensure_default_followups()
returns integer language plpgsql security definer set search_path=public as $$
declare created integer; due timestamptz; policy jsonb:=automation_rule_policy('follow_up');
begin
  perform pg_advisory_xact_lock(hashtextextended('default-followups',0));
  if not (policy->>'enabled')::boolean or extract(isodow from now() at time zone 'America/Phoenix') in (6,7) then return 0; end if;
  due:=(date_trunc('day',now() at time zone 'America/Phoenix')+interval '1 day'+make_interval(hours=>(policy->>'due_hour')::integer)) at time zone 'America/Phoenix';
  while extract(isodow from due at time zone 'America/Phoenix') in (6,7) loop due:=due+interval '1 day'; end loop;
  insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
  select case when l.status='quoted' then 'Follow up on '||l.full_name||'''s quote'
    when l.status='contacted' then 'Follow up with '||l.full_name else 'Make first contact with '||l.full_name end,
    'Review the profile and contact the prospect about their next step.',due,'open',policy->>'priority','lead',l.id
    from leads l where l.status in (select jsonb_array_elements_text(policy->'statuses')) and l.archived_at is null
      and automation_rule_allows('follow_up',l.created_at)
      and not exists(select 1 from tasks t where t.status='open' and t.related_type='lead' and t.related_id=l.id);
  get diagnostics created=row_count; return created;
end;
$$;

alter function public.sync_service_action(text,uuid) rename to sync_service_action_core;
create function public.sync_service_action(p_kind text,p_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare occurred timestamptz;
begin
  if p_kind not in ('claim','endorsement','certificate') then raise exception 'Unsupported service source' using errcode='22023'; end if;
  select created_at into occurred from (
    select created_at from claims where p_kind='claim' and id=p_id
    union all select created_at from endorsements where p_kind='endorsement' and id=p_id
    union all select created_at from certificates where p_kind='certificate' and id=p_id
  ) source;
  if occurred is null or not automation_rule_allows('service',occurred) then return null; end if;
  return sync_service_action_core(p_kind,p_id);
end;
$$;

create or replace function public.sync_reply_action(p_log_id uuid,p_notify boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare message record; label text; related_kind text; related_id uuid; href text; action_id uuid; active boolean;
  policy jsonb:=automation_rule_policy('reply');
begin
  select c.* into message from canonical_communications c where c.id=p_log_id;
  if message.id is null or message.channel not in ('email','sms') then return null; end if;
  if not automation_rule_allows('reply',message.sent_at) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('internal-action:message:'||message.conversation_key,0));
  select c.* into message from canonical_communications c where c.conversation_key=message.conversation_key
    and c.channel in ('email','sms') and c.direction in ('inbound','outbound')
    and coalesce(c.metadata->>'historical_import','false')<>'true'
    and (c.direction='inbound' or (
      coalesce(c.metadata->>'delivery_status',c.metadata->>'status','') in ('accepted_by_provider','sent','delivered','opened')
      and coalesce(c.metadata->>'status','') not in ('failed','pending','scheduled','sending','acceptance_unknown','cancelled')))
    order by c.sent_at desc,c.id desc limit 1;
  if message.id is null or not automation_rule_allows('reply',message.sent_at) then return null; end if;
  if message.direction='outbound' and not (policy->>'complete_on_successful_send')::boolean then return null; end if;
  if message.canonical_account_id is not null then
    select full_name into label from clients where id=message.canonical_account_id;
    related_kind:='client'; related_id:=message.canonical_account_id; href:='/clients/'||related_id||'?tab=communication';
  elsif message.canonical_lead_id is not null then
    select full_name into label from leads where id=message.canonical_lead_id;
    related_kind:='lead'; related_id:=message.canonical_lead_id; href:='/leads?lead='||related_id||'&tab=conversation';
  else
    label:=coalesce(message.metadata->>'from','Unknown sender'); related_kind:='conversation'; related_id:=message.id;
    href:='/communication?conversation='||message.conversation_key;
  end if;
  active:=message.direction='inbound' and not (coalesce(message.body,'') ~* '(\munsubscribe\M|\mopt[ -]?out\M|^[[:space:]]*stop[[:space:]]*$|\mstop[[:space:]]+(sending|emailing|texting)\M|remove me)');
  action_id:=sync_internal_action('message:'||message.conversation_key,message.id::text,active,'reply',
    related_kind,related_id,message.canonical_account_id,'Reply to '||label,href,
    message.sent_at+make_interval(mins=>(policy->>'due_minutes')::integer),message.conversation_key,false);
  if action_id is not null then
    update tasks t set status='completed',description=coalesce(t.description,'')||E'\nConsolidated into the canonical conversation follow-up.'
      where t.id<>action_id and t.status='open' and t.action_category='reply' and (
        (message.canonical_account_id is not null and (t.account_id=message.canonical_account_id
          or (t.related_type='client' and t.related_id=message.canonical_account_id)
          or (t.related_type='lead' and exists(select 1 from leads l where l.id=t.related_id and l.account_id=message.canonical_account_id))))
        or (message.canonical_account_id is null and t.related_type='lead' and t.related_id=message.canonical_lead_id));
  end if;
  if p_notify and active and exists(select 1 from tasks where id=action_id and status='open') then
    insert into notifications(client_id,type,message,href,read,message_log_id,task_id)
    values(message.canonical_account_id,'message','Reply to '||label,href,false,message.id,action_id)
      on conflict(message_log_id) where message_log_id is not null do update set task_id=excluded.task_id;
  end if;
  return action_id;
end;
$$;

alter function public.dispatch_due_reminders() rename to dispatch_due_reminders_core;
create function public.dispatch_due_reminders()
returns integer language plpgsql security definer set search_path=public as $$
declare amount integer;
begin
  if not (automation_rule_policy('reminders')->>'enabled')::boolean then return 0; end if;
  insert into notifications(client_id,task_id,reminder_version,type,message,href,read)
  select t.account_id,t.id,t.reminder_version,'reminder','Reminder due: '||t.subject,
    case when t.related_type='lead' then '/leads?lead='||t.related_id
      when t.related_type='client' then '/clients/'||t.related_id||'?tab=tasks' else '/tasks' end,false
  from tasks t where t.kind='reminder' and t.status='open' and t.due_date<=now()
    and automation_rule_allows('reminders',t.due_date)
  on conflict(task_id,reminder_version) where task_id is not null do nothing;
  get diagnostics amount=row_count; return amount;
end;
$$;

alter function public.persist_renewal_radar(uuid,date,integer,jsonb,text) rename to persist_renewal_radar_core;
create function public.persist_renewal_radar(p_policy_id uuid,p_renewal_date date,p_milestone integer,p_task jsonb,p_message text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare policy jsonb:=automation_rule_policy('renewal'); term_start timestamptz;
begin
  term_start:=((p_renewal_date-(policy->>'window_days')::integer)::timestamp at time zone 'America/Phoenix');
  if not automation_rule_allows('renewal',term_start) then return jsonb_build_object('tasksCreated',0,'tasksEscalated',0,'notifications',0); end if;
  if p_milestone is null or not (policy->'milestones') @> jsonb_build_array(p_milestone) then
    raise exception 'Invalid configured renewal milestone' using errcode='22023';
  end if;
  -- The original implementation retains policy locking, canonical task identity and successful bookkeeping.
  return persist_renewal_radar_core(p_policy_id,p_renewal_date,p_milestone,p_task,p_message);
end;
$$;
-- Keep the canonical persistence checks, expanding only its fixed milestone membership.
do $$
declare definition text; old text:='p_milestone not in (45,30,15,7,0)';
begin
  select pg_get_functiondef('public.persist_renewal_radar_core(uuid,date,integer,jsonb,text)'::regprocedure) into definition;
  if position(old in definition)=0 then raise exception 'Renewal persistence baseline changed; inspect before migrating'; end if;
  execute replace(definition,old,'not (automation_rule_policy(''renewal'')->''milestones'') @> jsonb_build_array(p_milestone)');
end;
$$;
alter function public.reconcile_legacy_renewal_tasks(uuid) rename to reconcile_legacy_renewal_tasks_core;
create function public.reconcile_legacy_renewal_tasks(p_policy_id uuid default null)
returns integer language plpgsql security definer set search_path=public as $$
begin
  if not (automation_rule_policy('renewal')->>'enabled')::boolean then return 0; end if;
  return reconcile_legacy_renewal_tasks_core(p_policy_id);
end;
$$;

-- Only replace the first-contact block in the approved-file transactional import.
do $$
declare definition text; old text:=$block$  if not exists(select 1 from tasks where related_type='lead' and related_id=lead and status='open' and due_date<=now()+interval '7 days') then
    tomorrow:=(now() at time zone 'America/Phoenix')::date+1;
    while extract(isodow from tomorrow) in (6,7) loop tomorrow:=tomorrow+1; end loop;
    contact_due:=(tomorrow+time '16:00') at time zone 'America/Phoenix';
    insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
      values('Contact new lead: '||item.full_name,'New prospect added to your pipeline - make the first touch.',
        contact_due,'open','medium','lead',lead);
    contact_count:=1;
  end if;$block$;
begin
  select pg_get_functiondef('public.promote_import_prospect_core(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  if position(old in definition)=0 then raise exception 'Import promotion baseline changed; inspect before migrating'; end if;
  execute replace(definition,old,'  if schedule_lead_intake(lead,false) then contact_count:=1; end if;');
end;
$$;

alter table public.sequence_enrollments
  add column configuration_revision integer,
  add column configuration_snapshot jsonb;
create function public.snapshot_sequence_configuration()
returns trigger language plpgsql security definer set search_path=public as $$
declare policy jsonb;
begin
  select configuration_revision,automation_configuration->'sequence' into new.configuration_revision,policy from outreach_settings where id=1;
  if policy is null then raise exception 'Sequence configuration is not initialized' using errcode='P0002'; end if;
  new.configuration_snapshot:=policy;
  new.total_steps:=(policy->>'total_steps')::integer;
  new.step_gap_days:=(policy->>'step_gap_days')::integer;
  return new;
end;
$$;
create trigger snapshot_sequence_configuration before insert on sequence_enrollments
  for each row execute function snapshot_sequence_configuration();

-- Preserve existing tasks in the workday; gate only synthetic fallback work.
do $$
declare definition text;
begin
  select pg_get_viewdef('public.agent_workday'::regclass,true) into definition;
  if position('WHERE i.handled_at IS NULL AND NOT' in definition)=0
    or position('LEFT JOIN reply_tasks reply_task ON reply_task.conversation = u.conversation' in definition)=0
    or position('WHERE (lower(s.status)' in definition)=0 then
    raise exception 'Workday projection baseline changed; inspect before migrating';
  end if;
  definition:=replace(definition,'WHERE i.handled_at IS NULL AND NOT',
    'WHERE automation_rule_allows(''intake'',i.received_at) AND i.handled_at IS NULL AND NOT');
  definition:=replace(definition,'LEFT JOIN reply_tasks reply_task ON reply_task.conversation = u.conversation',
    'LEFT JOIN reply_tasks reply_task ON reply_task.conversation = u.conversation WHERE reply_task.id IS NOT NULL OR automation_rule_allows(''reply'',u.sent_at)');
  definition:=replace(definition,'WHERE (lower(s.status)',
    'WHERE automation_rule_allows(''service'',s.created_at) AND (lower(s.status)');
  definition:=replace(definition,'u.sent_at + ''02:00:00''::interval',
    'u.sent_at + make_interval(mins=>(automation_rule_policy(''reply'')->>''due_minutes'')::integer)');
  execute 'create or replace view public.agent_workday as '||definition;
end;
$$;

create function public.preview_automation_job(p_job text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare records bigint:=0; revision integer; policy jsonb; today date:=(now() at time zone 'America/Phoenix')::date;
begin
  select configuration_revision into revision from outreach_settings where id=1;
  if p_job='follow-up-routine' then
    policy:=automation_rule_policy('follow_up');
    select count(*) into records from leads l where l.archived_at is null
      and l.status in (select jsonb_array_elements_text(policy->'statuses')) and automation_rule_allows('follow_up',l.created_at)
      and extract(isodow from now() at time zone 'America/Phoenix') not in (6,7)
      and not exists(select 1 from tasks where status='open' and related_type='lead' and related_id=l.id);
  elsif p_job='due-reminders' then
    select count(*) into records from tasks t where t.kind='reminder' and t.status='open' and t.due_date<=now()
      and automation_rule_allows('reminders',t.due_date)
      and not exists(select 1 from notifications n where n.task_id=t.id and n.reminder_version=t.reminder_version);
  elsif p_job='renewal-radar' then
    policy:=automation_rule_policy('renewal');
    select count(*) into records from policies p where coalesce(p.client_id,p.account_id) is not null
      and lower(p.status) in ('active','issued','bound','in_force','inforce')
      and coalesce(p.renewal_date,p.expiration_date) between today-(policy->>'grace_days')::integer and today+(policy->>'window_days')::integer
      and automation_rule_allows('renewal',(coalesce(p.renewal_date,p.expiration_date)-(policy->>'window_days')::integer)::timestamp at time zone 'America/Phoenix');
  elsif p_job='outreach' then
    records:=least(50,(select count(*) from sequence_enrollments where status='active' and next_send_at<=now()))
      +least(50,(select count(*) from outreach_outbox where status='accepted_by_provider'));
  elsif p_job='internal-actions' then
    records:=(select count(*) from claims)+(select count(*) from endorsements)+(select count(*) from certificates)
      +(select count(*) from outreach_outbox o where o.status in ('pending_approval','failed','acceptance_unknown','accepted_by_provider','sending')
        or exists(select 1 from tasks where automation_key='outreach:'||o.id and status='open'))
      +(select count(distinct c.conversation_key) from canonical_communications c where c.channel in ('email','sms')
        and (c.inbound_event_key is not null or exists(select 1 from tasks where automation_key='message:'||c.conversation_key)));
  else raise exception 'Choose a supported automation job' using errcode='22023'; end if;
  return jsonb_build_object('job',p_job,'revision',revision,'records',records,
    'may_use_ai',p_job='outreach','may_send_email',p_job='outreach','preview_only',true);
end;
$$;

revoke all on function public.preview_automation_job(text) from public,anon,authenticated;
grant execute on function public.preview_automation_job(text) to service_role;
revoke all on function public.sync_service_action_core(text,uuid),public.dispatch_due_reminders_core(),
  public.persist_renewal_radar_core(uuid,date,integer,jsonb,text),public.reconcile_legacy_renewal_tasks_core(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.validate_automation_configuration(jsonb),public.automation_rule_policy(text),
  public.automation_rule_allows(text,timestamptz),public.capture_automation_activation(),
  public.save_agency_automation_settings(uuid,jsonb,integer),public.intake_due_at(boolean,timestamptz),
  public.schedule_lead_intake(uuid,boolean),public.sync_service_action(text,uuid),public.dispatch_due_reminders(),
  public.persist_renewal_radar(uuid,date,integer,jsonb,text),public.reconcile_legacy_renewal_tasks(uuid),
  public.snapshot_sequence_configuration() from public,anon,authenticated;
grant execute on function public.automation_rule_policy(text),public.automation_rule_allows(text,timestamptz),
  public.save_agency_automation_settings(uuid,jsonb,integer),public.schedule_lead_intake(uuid,boolean),
  public.sync_service_action(text,uuid),public.dispatch_due_reminders(),public.persist_renewal_radar(uuid,date,integer,jsonb,text),
  public.reconcile_legacy_renewal_tasks(uuid) to service_role;
notify pgrst,'reload schema';
commit;
