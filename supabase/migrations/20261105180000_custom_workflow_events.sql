begin;
do $$ begin
  if exists(select 1 from workflow_rules) then
    raise exception 'Existing legacy workflow definitions require explicit review before installing the CRM executor';
  end if;
end $$;
alter table workflow_rules
  drop constraint workflow_rules_trigger_type_check,
  drop constraint workflow_rules_action_type_check,
  drop constraint workflow_rules_action_content_check,
  add column definition jsonb not null,
  add column revision integer not null default 1,
  add column owner_id uuid references auth.users(id),
  add column active_since timestamptz not null default clock_timestamp(),
  add constraint workflow_revision_valid check(revision>0);
alter table workflow_rules alter column created_at set default clock_timestamp();

create table workflow_rule_versions(
  rule_id uuid not null references workflow_rules(id), revision integer not null,
  actor_id uuid not null references auth.users(id), definition jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(), primary key(rule_id,revision)
);
create table workflow_events(
  id uuid primary key default gen_random_uuid(), event_key text not null unique,
  event_type text not null, source_table text not null, source_id uuid not null,
  occurred_at timestamptz not null, context jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create table workflow_executions(
  id uuid primary key default gen_random_uuid(), event_id uuid not null references workflow_events(id),
  rule_id uuid not null references workflow_rules(id), rule_revision integer not null,
  definition jsonb not null, owner_id uuid not null references auth.users(id),
  status text not null default 'queued' check(status in ('queued','running','succeeded','skipped','failed')),
  backlog_pending boolean not null default false,
  claimed_at timestamptz, finished_at timestamptz, result jsonb not null default '{}', error text,
  unique(event_id,rule_id,rule_revision), foreign key(rule_id,rule_revision) references workflow_rule_versions(rule_id,revision)
);
create index workflow_execution_queue on workflow_executions(status,id) where status='queued';
alter table sequence_enrollments
  add column workflow_rule_id uuid references workflow_rules(id),
  add column workflow_execution_id uuid references workflow_executions(id),
  add constraint workflow_enrollment_origin_valid check((workflow_rule_id is null)=(workflow_execution_id is null));

create function validate_workflow_definition(p_definition jsonb)
returns void language plpgsql set search_path=public as $$
declare c jsonb; a jsonb; key text; item jsonb; assigned text;
begin
  if jsonb_typeof(p_definition) is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(p_definition) as keys(k))
      is distinct from array['action','active','conditions','event','name','schema_version']::text[]
    or p_definition->'schema_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_definition->'active') is distinct from 'boolean'
    or jsonb_typeof(p_definition->'name') is distinct from 'string'
    or length(btrim(p_definition->>'name')) not between 1 and 100
    or jsonb_typeof(p_definition->'event') is distinct from 'string'
    or p_definition->>'event' not in ('lead.created','lead.stage_changed','website.submitted','message.received','service.changed',
      'policy.changed','renewal.milestone','reminder.due','outreach.drafted','outreach.accepted','outreach.blocked') then
    raise exception 'Choose a complete supported workflow rule' using errcode='22023';
  end if;
  c:=p_definition->'conditions'; a:=p_definition->'action';
  if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(a) is distinct from 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(c) as keys(k))
      is distinct from array['assignee','lines','sources','stages','statuses']::text[]
    or (select array_agg(k order by k) from jsonb_object_keys(a) as keys(k))
      is distinct from array['assignee','content','delay_minutes','priority','type']::text[] then
    raise exception 'Unsupported workflow condition or action fields' using errcode='22023';
  end if;
  foreach key in array array['sources','stages','statuses','lines'] loop
    if jsonb_typeof(c->key) is distinct from 'array' then raise exception 'Workflow conditions must be lists' using errcode='22023'; end if;
    if jsonb_array_length(c->key)>20
      or (select count(*)<>count(distinct lower(btrim(v#>>'{}'))) from jsonb_array_elements(c->key) as items(v)) then
      raise exception 'Choose at most 20 distinct condition values' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(c->key) loop
      if jsonb_typeof(item) is distinct from 'string' or length(btrim(item#>>'{}')) not between 1 and 100
        or item#>>'{}' is distinct from lower(btrim(item#>>'{}')) then
        raise exception 'Invalid workflow condition value' using errcode='22023'; end if;
      if key='stages' and item#>>'{}' not in ('new','contacted','quoted','negotiation','won','lost') then
        raise exception 'Unsupported pipeline stage' using errcode='22023'; end if;
    end loop;
  end loop;
  if jsonb_typeof(a->'type') is distinct from 'string' or a->>'type' not in ('create_task','notify','create_note','enroll_sequence','draft_sequence')
    or jsonb_typeof(a->'content') is distinct from 'string' or jsonb_typeof(a->'priority') is distinct from 'string'
    or a->>'priority' not in ('low','medium','high') or jsonb_typeof(a->'delay_minutes') is distinct from 'number'
    or a->>'delay_minutes' !~ '^[0-9]+$' then raise exception 'Unsupported workflow action' using errcode='22023'; end if;
  if (a->>'delay_minutes')::numeric not between 0 and 10080
    or length(a->>'content')>(case a->>'type' when 'create_task' then 240 when 'notify' then 500 else 2000 end)
    or (a->>'type' in ('create_task','notify','create_note') and nullif(btrim(a->>'content'),'') is null)
    or (a->>'type' in ('enroll_sequence','draft_sequence') and a->>'content'<>'') then
    raise exception 'Invalid workflow text or task timing' using errcode='22023'; end if;
  if a->>'type'<>'create_task' and ((a->>'delay_minutes')::integer<>0 or a->>'priority'<>'medium' or a->'assignee'<>'null'::jsonb) then
    raise exception 'Assignment, priority and delay apply only to task actions' using errcode='22023'; end if;
  if a->>'type' in ('enroll_sequence','draft_sequence') and p_definition->>'event' not in ('lead.created','lead.stage_changed','website.submitted') then
    raise exception 'Sequence actions require lead or website events' using errcode='22023'; end if;
  foreach assigned in array array[c->>'assignee',a->>'assignee'] loop
    if assigned is not null and (assigned !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists(select 1 from agency_members where user_id::text=assigned and active)) then
      raise exception 'Choose an actual active agency member' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(c->'assignee') not in ('null','string') or jsonb_typeof(a->'assignee') not in ('null','string') then
    raise exception 'Choose an actual agency member' using errcode='22023'; end if;
end;
$$;

create function save_workflow_rule(p_actor uuid,p_rule uuid,p_expected_revision integer,p_definition jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare work workflow_rules; new_id uuid:=coalesce(p_rule,gen_random_uuid());
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can configure workflows' using errcode='42501'; end if;
  perform validate_workflow_definition(p_definition);
  if p_rule is null then
    if p_expected_revision is distinct from 0 then raise exception 'New rules require revision zero' using errcode='22023'; end if;
    insert into workflow_rules(id,trigger_type,action_type,active,definition,owner_id)
      values(new_id,p_definition->>'event',p_definition#>>'{action,type}',(p_definition->>'active')::boolean,p_definition,p_actor) returning * into work;
  else
    select * into work from workflow_rules where workflow_rules.id=p_rule for update;
    if work.id is null then raise exception 'Workflow rule not found' using errcode='P0002'; end if;
    if work.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='This rule changed. Reload before saving.'; end if;
    if work.definition=p_definition then return to_jsonb(work); end if;
    update workflow_rules set definition=p_definition,trigger_type=p_definition->>'event',action_type=p_definition#>>'{action,type}',
      active=(p_definition->>'active')::boolean,revision=revision+1,owner_id=p_actor,
      active_since=case when not active and (p_definition->>'active')::boolean then clock_timestamp() else active_since end
      where workflow_rules.id=p_rule returning * into work;
  end if;
  insert into workflow_rule_versions(rule_id,revision,actor_id,definition) values(work.id,work.revision,p_actor,p_definition);
  if not work.active then
    update workflow_executions set status='skipped',finished_at=clock_timestamp(),error='Rule paused before execution'
      where rule_id=work.id and status='queued';
  end if;
  insert into agency_audit(actor_id,action,details) values(p_actor,'workflow_rule_saved',jsonb_build_object('rule_id',work.id,'revision',work.revision));
  return to_jsonb(work);
end;
$$;

create function workflow_source_context(p_table text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v jsonb; lead_id uuid; client_id uuid; l jsonb; c jsonb; target_type text; target_id uuid; href text;
begin
  case p_table
    when 'leads' then select to_jsonb(t) into v from leads t where id=p_id; lead_id:=p_id;
    when 'clients' then select to_jsonb(t) into v from clients t where id=p_id; client_id:=p_id;
    when 'lead_intake_events' then select to_jsonb(t) into v from lead_intake_events t where id=p_id; lead_id:=(v->>'lead_id')::uuid;
    when 'communication_log' then
      select to_jsonb(t) into v from canonical_communications t where id=p_id;
      lead_id:=(v->>'canonical_lead_id')::uuid; client_id:=(v->>'canonical_account_id')::uuid;
    when 'claims' then select to_jsonb(t) into v from claims t where id=p_id;
    when 'endorsements' then select to_jsonb(t) into v from endorsements t where id=p_id;
    when 'certificates' then select to_jsonb(t) into v from certificates t where id=p_id;
    when 'policies' then select to_jsonb(t) into v from policies t where id=p_id;
    when 'tasks' then
      select to_jsonb(t) into v from tasks t where id=p_id;
      if v->>'related_type'='lead' then lead_id:=(v->>'related_id')::uuid; end if;
      if v->>'related_type'='client' then client_id:=(v->>'related_id')::uuid; end if;
    when 'outreach_outbox' then select to_jsonb(t) into v from outreach_outbox t where id=p_id; lead_id:=(v->>'lead_id')::uuid;
    else raise exception 'Unsupported workflow source' using errcode='22023';
  end case;
  if v is null then return null; end if;
  client_id:=coalesce(client_id,(v->>'client_id')::uuid,(v->>'account_id')::uuid);
  if lead_id is not null then
    select to_jsonb(t) into l from leads t where id=lead_id;
    if l is null or l->>'archived_at' is not null then return null; end if;
    client_id:=coalesce(client_id,(l->>'account_id')::uuid);
  end if;
  if client_id is not null then
    select to_jsonb(t) into c from clients t where id=client_id;
    if c is null then return null; end if;
  end if;
  if v->>'archived_at' is not null then return null; end if;
  target_type:=case when client_id is not null then 'client' when lead_id is not null then 'lead'
    when p_table='communication_log' then 'conversation' else regexp_replace(p_table,'s$','') end;
  target_id:=coalesce(client_id,lead_id,p_id);
  href:=case target_type when 'client' then '/clients/'||target_id when 'lead' then '/leads?lead='||target_id
    when 'conversation' then '/communication?conversation='||(v->>'conversation_key') else '/'||p_table end;
  if p_table in ('claims','endorsements','certificates') and client_id is not null then
    href:='/clients/'||client_id||'?tab=policies&context_type='||regexp_replace(p_table,'s$','')||'&context_id='||p_id;
  end if;
  return jsonb_build_object('target_type',target_type,'target_id',target_id,'lead_id',lead_id,'client_id',client_id,
    'name',coalesce(c->>'full_name',l->>'full_name',v->>'full_name','Request'),'href',href,
    'source',lower(coalesce(l->>'source',v->>'source','')),'stage',lower(coalesce(l->>'pipeline_stage',l->>'status','')),
    'status',lower(coalesce(v->>'status',l->>'status',c->>'status','')),'line',lower(coalesce(l->>'line_of_business',v->>'line_of_business','')),
    'assignee',coalesce(l->>'agent_user_id',c->>'agent_user_id',v->>'agent_user_id'),
    'email',coalesce(c->>'email',l->>'email'),'conversation_key',v->>'conversation_key',
    'due_date',v->>'due_date','reminder_version',v->'reminder_version',
    'renewal_date',coalesce(v->>'renewal_date',v->>'expiration_date'));
end;
$$;

create function workflow_matches(p_definition jsonb,p_context jsonb)
returns boolean language sql immutable set search_path=public as $$
select p_context is not null
  and (jsonb_array_length(p_definition#>'{conditions,sources}')=0 or p_definition#>'{conditions,sources}' @> jsonb_build_array(p_context->>'source'))
  and (jsonb_array_length(p_definition#>'{conditions,stages}')=0 or p_definition#>'{conditions,stages}' @> jsonb_build_array(p_context->>'stage'))
  and (jsonb_array_length(p_definition#>'{conditions,statuses}')=0 or p_definition#>'{conditions,statuses}' @> jsonb_build_array(p_context->>'status'))
  and (jsonb_array_length(p_definition#>'{conditions,lines}')=0 or p_definition#>'{conditions,lines}' @> jsonb_build_array(p_context->>'line'))
  and (p_definition#>>'{conditions,assignee}' is null or p_definition#>>'{conditions,assignee}'=p_context->>'assignee');
$$;

create function queue_workflow_event(p_type text,p_table text,p_id uuid,p_key text,p_occurred timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare context jsonb; event_id uuid;
begin
  if not exists(select 1 from workflow_rules where active and trigger_type=p_type and p_occurred>=active_since) then return null; end if;
  context:=workflow_source_context(p_table,p_id);
  if context is null then return null; end if;
  insert into workflow_events(event_key,event_type,source_table,source_id,occurred_at,context)
    values(p_key,p_type,p_table,p_id,p_occurred,context) on conflict(event_key) do nothing returning id into event_id;
  if event_id is null then return null; end if;
  insert into workflow_executions(event_id,rule_id,rule_revision,definition,owner_id,status,finished_at,error)
    select event_id,id,revision,definition,owner_id,
      case when ranked.position>1 and definition#>>'{action,type}' in ('create_task','enroll_sequence','draft_sequence') then 'skipped' else 'queued' end,
      case when ranked.position>1 and definition#>>'{action,type}' in ('create_task','enroll_sequence','draft_sequence') then clock_timestamp() end,
      case when ranked.position>1 and definition#>>'{action,type}' in ('create_task','enroll_sequence','draft_sequence') then 'The earliest matching rule owns this task or sequence action' end
    from (select r.*,row_number() over(partition by case when action_type in ('enroll_sequence','draft_sequence') then 'sequence' else action_type end
      order by created_at,id) as position from workflow_rules r
      where active and trigger_type=p_type and p_occurred>=active_since and workflow_matches(definition,context)) ranked;
  return event_id;
end;
$$;

create function capture_workflow_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v jsonb:=to_jsonb(new); prior jsonb; event text; source text:=tg_table_name; id uuid:=new.id; key text; at timestamptz:=clock_timestamp();
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old); end if;
  if tg_table_name='leads' then
    if tg_op='INSERT' then event:='lead.created'; key:='lead-created:'||id;
    elsif prior->'status' is distinct from v->'status' or prior->'pipeline_stage' is distinct from v->'pipeline_stage' then event:='lead.stage_changed';
    else return null; end if;
  elsif tg_table_name='lead_intake_events' then event:='website.submitted'; key:='intake:'||id;
  elsif tg_table_name='communication_log' then
    if v->>'direction'<>'inbound' or coalesce(v#>>'{metadata,historical_import}','false')='true' then return null; end if;
    event:='message.received'; key:='message:'||id; at:=(v->>'sent_at')::timestamptz;
  elsif tg_table_name in ('claims','endorsements','certificates') then
    if tg_op='UPDATE' and prior->'status' is not distinct from v->'status' then return null; end if;
    event:='service.changed';
  elsif tg_table_name='policies' then
    if tg_op='UPDATE' and prior->'status' is not distinct from v->'status' and prior->'renewal_date' is not distinct from v->'renewal_date'
      and prior->'expiration_date' is not distinct from v->'expiration_date' then return null; end if;
    event:='policy.changed';
  elsif tg_table_name='notifications' then
    if v->>'type'='reminder' and v->>'task_id' is not null then
      event:='reminder.due'; source:='tasks'; id:=(v->>'task_id')::uuid;
      select due_date,'reminder:'||tasks.id||':'||coalesce(v->>'reminder_version',tasks.reminder_version::text)
        into at,key from tasks where tasks.id=(v->>'task_id')::uuid;
    elsif v->>'renewal_key' is not null then
      event:='renewal.milestone'; source:='policies'; id:=split_part(v->>'renewal_key',':',1)::uuid; key:='renewal:'||(v->>'renewal_key');
      at:=((split_part(v->>'renewal_key',':',2)::date-split_part(v->>'renewal_key',':',3)::integer)::timestamp at time zone 'America/Phoenix');
    else return null; end if;
  elsif tg_table_name='outreach_outbox' then
    if tg_op='INSERT' and v->>'status'='pending_approval' then event:='outreach.drafted'; key:='draft:'||id;
    elsif tg_op='UPDATE' and v->>'status' in ('accepted_by_provider','sent') and prior->>'status' not in ('accepted_by_provider','sent') then
      event:='outreach.accepted'; key:='accepted:'||id;
    elsif tg_op='UPDATE' and v->>'status' in ('failed','acceptance_unknown') and prior->'status' is distinct from v->'status' then event:='outreach.blocked';
    else return null; end if;
  end if;
  perform queue_workflow_event(event,source,id,coalesce(key,event||':'||id||':'||gen_random_uuid()),at);
  return null;
end;
$$;
create trigger workflow_capture after insert or update on leads for each row execute function capture_workflow_event();
create trigger workflow_capture after insert on lead_intake_events for each row execute function capture_workflow_event();
create trigger workflow_capture after insert on communication_log for each row execute function capture_workflow_event();
create trigger workflow_capture after insert or update on claims for each row execute function capture_workflow_event();
create trigger workflow_capture after insert or update on endorsements for each row execute function capture_workflow_event();
create trigger workflow_capture after insert or update on certificates for each row execute function capture_workflow_event();
create trigger workflow_capture after insert or update on policies for each row execute function capture_workflow_event();
create trigger workflow_capture after insert on notifications for each row execute function capture_workflow_event();
create trigger workflow_capture after insert or update on outreach_outbox for each row execute function capture_workflow_event();

create function scrub_deleted_workflow_source()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update workflow_events set context=context-'name'-'email'
    where (source_table=tg_table_name and source_id=old.id)
      or context->>case when tg_table_name='leads' then 'lead_id' else 'client_id' end=old.id::text;
  update workflow_executions j set status='skipped',finished_at=clock_timestamp(),error='Source record deleted before execution'
    from workflow_events e where j.event_id=e.id and j.status='queued'
      and ((e.source_table=tg_table_name and e.source_id=old.id)
        or e.context->>case when tg_table_name='leads' then 'lead_id' else 'client_id' end=old.id::text);
  return null;
end;
$$;
create trigger workflow_source_delete after delete on leads for each row execute function scrub_deleted_workflow_source();
create trigger workflow_source_delete after delete on clients for each row execute function scrub_deleted_workflow_source();

create function workflow_builtin_owns(p_event workflow_events,p_context jsonb)
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
  if p_event.event_type in ('lead.created','website.submitted') and automation_rule_allows('intake',p_event.occurred_at) then return true; end if;
  if p_event.event_type in ('lead.created','lead.stage_changed') and automation_rule_allows('follow_up',p_event.occurred_at)
    and automation_rule_policy('follow_up')->'statuses' @> jsonb_build_array(p_context->>'stage') then return true; end if;
  if p_event.event_type='message.received' and automation_rule_allows('reply',p_event.occurred_at) then return true; end if;
  if p_event.event_type='service.changed' and automation_rule_allows('service',p_event.occurred_at) then return true; end if;
  if p_event.event_type='renewal.milestone' and automation_rule_allows('renewal',p_event.occurred_at) then return true; end if;
  return p_event.event_type in ('reminder.due','outreach.drafted','outreach.blocked');
end;
$$;

create function workflow_execution_context(p_job workflow_executions)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare event workflow_events; context jsonb;
begin
  select * into event from workflow_events where id=p_job.event_id;
  context:=workflow_source_context(event.source_table,event.source_id);
  if context is null or context->'target_type' is distinct from event.context->'target_type' or context->'target_id' is distinct from event.context->'target_id'
    or not workflow_matches(p_job.definition,context)
    or not exists(select 1 from workflow_rules where id=p_job.rule_id and active)
    or not exists(select 1 from agency_members where user_id=p_job.owner_id and active and role='owner') then return null; end if;
  if p_job.definition#>>'{action,type}'='create_task' and workflow_builtin_owns(event,context) then return null; end if;
  if p_job.definition#>>'{action,type}'='create_note' and context->>'lead_id' is null and context->>'client_id' is null then return null; end if;
  if event.event_type='reminder.due' and (context->'reminder_version' is distinct from event.context->'reminder_version'
    or (context->>'due_date')::timestamptz>clock_timestamp() or context->>'status'<>'open') then return null; end if;
  if event.event_type='renewal.milestone' and context->'renewal_date' is distinct from event.context->'renewal_date' then return null; end if;
  return context;
end;
$$;

create function execute_workflow_internal(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job workflow_executions; context jsonb; action jsonb; task uuid; key text; event workflow_events; work_group text; family text;
  succeeded integer:=0; skipped integer:=0; failed integer:=0;
begin
  if p_limit not between 1 and 100 then raise exception 'Choose a workflow batch of 1-100' using errcode='22023'; end if;
  for job in select * from workflow_executions where status='queued' and not backlog_pending
    and definition#>>'{action,type}' in ('create_task','notify','create_note')
    order by id for update skip locked limit p_limit loop
    begin
      task:=null;
      context:=workflow_execution_context(job);
      if context is null then
        update workflow_executions set status='skipped',finished_at=clock_timestamp(),error='Built-in precedence, paused rule, changed eligibility or unavailable target' where id=job.id;
        skipped:=skipped+1; continue;
      end if;
      action:=job.definition->'action';
      select * into event from workflow_events where id=job.event_id;
      update workflow_executions set status='running',claimed_at=clock_timestamp() where id=job.id;
      if action->>'type'='create_task' then
        if event.event_type='service.changed' and context->>'status' not in ('open','pending','requested','in_progress','in progress','submitted') then
          update workflow_executions set status='skipped',finished_at=clock_timestamp(),error='Resolved service work is not reopened' where id=job.id;
          skipped:=skipped+1; continue;
        end if;
        if action->>'assignee' is not null and not exists(select 1 from agency_members where user_id::text=action->>'assignee' and active) then
          raise exception 'Task assignee is no longer active'; end if;
        family:=case when event.event_type in ('lead.created','lead.stage_changed','website.submitted') then 'lead'
          when event.event_type='message.received' then 'reply' else event.source_table end;
        work_group:=case when family='lead' then 'lead:'||(context->>'target_type')||':'||(context->>'target_id')
          when family='reply' then 'reply:'||coalesce(context->>'conversation_key',context->>'target_id')
          else event.source_table||':'||event.source_id end;
        key:='workflow:'||job.rule_id||':'||work_group||':'||event.id;
        perform pg_advisory_xact_lock(hashtextextended('workflow-group:'||work_group,0));
        if exists(select 1 from tasks t where status='open' and automation_key is distinct from key and (
          (((family='lead' and (t.action_category in ('intake','follow_up','workflow') or t.related_type='lead'))
            or (family='reply' and t.action_category in ('reply','workflow')))
            and ((context->>'client_id' is not null and (t.account_id::text=context->>'client_id'
              or (t.related_type='client' and t.related_id::text=context->>'client_id')
              or (t.related_type='lead' and exists(select 1 from leads l where l.id=t.related_id and l.account_id::text=context->>'client_id'))))
              or (t.related_type='lead' and t.related_id::text=context->>'lead_id')))
          or t.automation_provenance->>'workflow_group'=work_group
          or (family='reply' and t.automation_key='message:'||(context->>'conversation_key'))
          or (event.source_table in ('claims','endorsements','certificates') and t.related_type=regexp_replace(event.source_table,'s$','') and t.related_id=event.source_id))) then
          update workflow_executions set status='skipped',finished_at=clock_timestamp(),error='Existing open work already owns this follow-up' where id=job.id;
          skipped:=skipped+1; continue;
        end if;
        perform pg_advisory_xact_lock(hashtextextended('internal-action:'||key,0));
        select id into task from tasks where automation_key=key;
        if task is null then
          task:=sync_internal_action(key,event.event_key,true,'workflow',context->>'target_type',(context->>'target_id')::uuid,
            (context->>'client_id')::uuid,replace(action->>'content','{{name}}',context->>'name'),context->>'href',
            event.occurred_at+make_interval(mins=>(action->>'delay_minutes')::integer),null,false);
          update tasks set priority=action->>'priority',assignee=action->>'assignee',
            automation_provenance=jsonb_build_object('workflow_rule',job.rule_id,'workflow_revision',job.rule_revision,'workflow_execution',job.id,'workflow_group',work_group)
            where id=task;
        end if;
      elsif action->>'type'='create_note' then
        if context->>'lead_id' is null and context->>'client_id' is null then raise exception 'A note requires a linked lead or account'; end if;
        insert into interactions(lead_id,client_id,content,note_type,author_id,author_name)
          values((context->>'lead_id')::uuid,(context->>'client_id')::uuid,replace(action->>'content','{{name}}',context->>'name'),
            'general',job.owner_id,'Automation: '||(job.definition->>'name'));
      else
        insert into notifications(client_id,type,message,href,read,automation_key)
          values((context->>'client_id')::uuid,'workflow',replace(action->>'content','{{name}}',context->>'name'),context->>'href',false,'workflow:'||job.id);
      end if;
      update workflow_executions set status='succeeded',finished_at=clock_timestamp(),result=jsonb_build_object('task_id',task) where id=job.id;
      succeeded:=succeeded+1;
    exception when others then
      raise log 'Workflow execution % failed: %',job.id,sqlerrm;
      update workflow_executions set status='failed',finished_at=clock_timestamp(),error=sqlerrm where id=job.id;
      failed:=failed+1;
    end;
  end loop;
  return jsonb_build_object('succeeded',succeeded,'skipped',skipped,'failed',failed);
end;
$$;

create function claim_workflow_adapter_job()
returns jsonb language plpgsql security definer set search_path=public as $$
declare job workflow_executions; context jsonb;
begin
  select * into job from workflow_executions where status='queued' and not backlog_pending
    and definition#>>'{action,type}' in ('enroll_sequence','draft_sequence')
    order by id for update skip locked limit 1;
  if job.id is null then return null; end if;
  context:=workflow_execution_context(job);
  if context is null then
    update workflow_executions set status='skipped',finished_at=clock_timestamp(),error='Rule paused, target changed or eligibility no longer matches' where id=job.id;
    return jsonb_build_object('skipped',true,'id',job.id);
  end if;
  update workflow_executions set status='running',claimed_at=clock_timestamp() where id=job.id;
  return jsonb_build_object('id',job.id,'rule_id',job.rule_id,'owner_id',job.owner_id,'definition',job.definition,'context',context);
end;
$$;

create function protect_workflow_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from sequence_enrollments where id=new.enrollment_id and workflow_rule_id is not null) then new.requires_manual_approval:=true; end if;
  return new;
end;
$$;
create trigger workflow_draft_approval before insert or update on outreach_outbox for each row execute function protect_workflow_approval();

create function protect_workflow_origin()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.workflow_rule_id is not null and (new.workflow_rule_id is distinct from old.workflow_rule_id
    or new.workflow_execution_id is distinct from old.workflow_execution_id) then
    raise exception 'Workflow approval provenance cannot be removed' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger workflow_origin_guard before update on sequence_enrollments for each row execute function protect_workflow_origin();

create function enroll_workflow_sequence(p_job uuid,p_agent uuid,p_mailbox uuid,p_sender jsonb,p_recipient text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job workflow_executions; context jsonb; lead leads; enrollment sequence_enrollments; actual_agent uuid;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  select * into job from workflow_executions where id=p_job for update;
  if job.id is null or job.status<>'running' or job.definition#>>'{action,type}' not in ('enroll_sequence','draft_sequence') then
    raise exception 'A claimed sequence workflow is required' using errcode='42501'; end if;
  context:=workflow_execution_context(job);
  if context is null or context->>'lead_id' is null then raise sqlstate 'PT409' using message='Workflow eligibility changed. Review the source record.'; end if;
  select * into lead from leads where id=(context->>'lead_id')::uuid for update;
  if lead.id is null or lead.archived_at is not null or lower(coalesce(lead.status,'')) in ('won','lost') then
    raise sqlstate 'PT409' using message='This lead is no longer eligible for outreach.'; end if;
  if lower(btrim(coalesce(lead.email,'')))='' or lower(btrim(lead.email)) is distinct from p_recipient then
    raise sqlstate 'PT409' using message='The recipient changed. Review the source record.'; end if;
  if not exists(select 1 from marketing_email_consents where email=p_recipient and revoked_at is null)
    or exists(select 1 from email_suppressions where email=p_recipient)
    or exists(select 1 from outreach_opt_outs where lower(email)=p_recipient) then
    raise sqlstate 'PT409' using message='Recorded marketing permission is required; suppressed addresses cannot enroll.'; end if;
  actual_agent:=coalesce((context->>'assignee')::uuid,job.owner_id);
  if p_agent is distinct from actual_agent or not exists(select 1 from agency_members where user_id=p_agent and active) then
    raise exception 'Workflow actor is no longer authorized' using errcode='42501'; end if;
  if p_mailbox is not null and (not exists(select 1 from gmail_connections where id=p_mailbox and user_id=p_agent and status='connected')
    or jsonb_typeof(p_sender) is distinct from 'object') then
    raise sqlstate 'PT409' using message='The approved mailbox is no longer available.'; end if;
  select * into enrollment from sequence_enrollments where lead_id=lead.id and status in ('active','paused') for update;
  if enrollment.id is not null then
    if enrollment.workflow_rule_id is distinct from job.rule_id or enrollment.workflow_execution_id is distinct from job.id or enrollment.status<>'active' then
      raise sqlstate 'PT409' using message='An existing sequence already owns this lead. It was not changed.'; end if;
    return to_jsonb(enrollment);
  end if;
  insert into sequence_enrollments(lead_id,status,next_send_at,workflow_rule_id,workflow_execution_id,agent_user_id,gmail_connection_id,approved_sender,approved_recipient,auto_send_enabled)
    values(lead.id,'active',clock_timestamp(),job.rule_id,job.id,case when p_mailbox is not null then p_agent end,p_mailbox,p_sender,
      case when p_mailbox is not null then p_recipient end,false) returning * into enrollment;
  return to_jsonb(enrollment);
end;
$$;

create function workflow_rule_revision()
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce(sum(revision),0)::bigint from workflow_rules;
$$;

create function workflow_backlog_candidates(p_rule uuid)
returns table(event_type text,source_table text,source_id uuid,context jsonb)
language sql stable security definer set search_path=public as $$
  with selected as (
    select id,trigger_type,definition from workflow_rules
    where id=p_rule and active and trigger_type in ('lead.created','lead.stage_changed','website.submitted')
  ), targets as (
    select r.trigger_type as event_type,'leads'::text as source_table,l.id as source_id,r.definition
    from selected r join leads l on r.trigger_type in ('lead.created','lead.stage_changed')
      and l.archived_at is null and lower(coalesce(l.status,'')) not in ('won','lost','archived','deleted')
    where r.trigger_type in ('lead.created','lead.stage_changed')
    union all
    select r.trigger_type,'lead_intake_events',i.id,r.definition
    from selected r join lead_intake_events i on r.trigger_type='website.submitted'
    where r.trigger_type='website.submitted' and i.lead_id is not null and i.dismissed_at is null and i.handled_at is null
  ), enriched as (
    select t.event_type,t.source_table,t.source_id,t.definition,
      workflow_source_context(t.source_table,t.source_id) as source_context
    from targets t
    where not exists(select 1 from workflow_events e where e.event_type=t.event_type
      and e.source_table=t.source_table and e.source_id=t.source_id)
  )
  select e.event_type,e.source_table,e.source_id,e.source_context
  from enriched e
  where e.source_context is not null and workflow_matches(e.definition,e.source_context);
$$;

create function preview_workflow_backlog(p_rule uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rule workflow_rules; amount bigint; fingerprint text;
begin
  select * into rule from workflow_rules where id=p_rule;
  if rule.id is null then raise exception 'Workflow rule not found' using errcode='P0002'; end if;
  if not rule.active then raise exception 'Enable this rule before previewing existing records' using errcode='P0001'; end if;
  if rule.trigger_type not in ('lead.created','lead.stage_changed','website.submitted') then
    raise exception 'Backlog preview supports lead and website-submission rules only' using errcode='22023';
  end if;
  select count(*)::bigint,
    md5(coalesce(string_agg(c.event_type||':'||c.source_table||':'||c.source_id::text,'|' order by c.source_table,c.source_id,c.event_type),''))
    into amount,fingerprint from workflow_backlog_candidates(p_rule) c;
  return jsonb_build_object('rule_id',rule.id,'rule_revision',rule.revision,'event',rule.trigger_type,
    'action_type',rule.definition#>>'{action,type}','eligible_count',amount,'fingerprint',fingerprint,
    'batch_limit',100,'may_use_ai',rule.definition#>>'{action,type}'='draft_sequence');
end;
$$;

create function apply_workflow_backlog(p_actor uuid,p_rule uuid,p_expected_revision integer,p_expected_count bigint,p_expected_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rule workflow_rules; amount bigint; fingerprint text; candidate record; event_id uuid; execution_id uuid;
  queued integer:=0; skipped integer:=0;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can apply a workflow backlog' using errcode='42501'; end if;
  select * into rule from workflow_rules where id=p_rule for update;
  if rule.id is null then raise exception 'Workflow rule not found' using errcode='P0002'; end if;
  if not rule.active then raise exception 'Enable this rule before applying existing records' using errcode='P0001'; end if;
  if rule.trigger_type not in ('lead.created','lead.stage_changed','website.submitted') then
    raise exception 'Backlog application supports lead and website-submission rules only' using errcode='22023';
  end if;
  if rule.revision is distinct from p_expected_revision then
    raise sqlstate 'PT409' using message='This rule changed after the preview. Preview the backlog again.';
  end if;
  if p_expected_count is null or p_expected_count<0 or p_expected_fingerprint !~ '^[0-9a-f]{32}$' then
    raise exception 'Preview and confirm a valid backlog count before applying' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('workflow-backlog:'||p_rule::text,0));
  perform l.id from leads l where l.id in (
    select c.source_id from workflow_backlog_candidates(p_rule) c where c.source_table='leads'
  ) order by l.id for update;
  perform i.id from lead_intake_events i where i.id in (
    select c.source_id from workflow_backlog_candidates(p_rule) c where c.source_table='lead_intake_events'
  ) order by i.id for update;
  select count(*)::bigint,
    md5(coalesce(string_agg(c.event_type||':'||c.source_table||':'||c.source_id::text,'|' order by c.source_table,c.source_id,c.event_type),''))
    into amount,fingerprint from workflow_backlog_candidates(p_rule) c;
  if amount is distinct from p_expected_count or fingerprint is distinct from p_expected_fingerprint then
    raise sqlstate 'PT409' using message='Eligible records changed after the preview. Preview the backlog again.';
  end if;
  for candidate in select * from workflow_backlog_candidates(p_rule)
    order by source_table,source_id,event_type limit 100 loop
    event_id:=null;
    insert into workflow_events(event_key,event_type,source_table,source_id,occurred_at,context)
      values('backlog:'||p_rule::text||':'||candidate.event_type||':'||candidate.source_id::text,
        candidate.event_type,candidate.source_table,candidate.source_id,clock_timestamp(),candidate.context)
      on conflict(event_key) do nothing returning id into event_id;
    if event_id is null then skipped:=skipped+1; continue; end if;
    execution_id:=null;
    insert into workflow_executions(event_id,rule_id,rule_revision,definition,owner_id,status,backlog_pending)
      values(event_id,rule.id,rule.revision,rule.definition,rule.owner_id,'queued',true)
      on conflict(event_id,rule_id,rule_revision) do nothing returning id into execution_id;
    if execution_id is null then skipped:=skipped+1; else queued:=queued+1; end if;
  end loop;
  return jsonb_build_object('queued_count',queued,'skipped_count',skipped,
    'remaining_count',greatest(amount-queued-skipped,0),'rule_revision',rule.revision,'preview_only',false);
end;
$$;

create function release_workflow_backlog(p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare released integer; stale integer;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can run queued backlog work' using errcode='42501'; end if;
  update workflow_executions e set status='skipped',backlog_pending=false,finished_at=clock_timestamp(),
    error='The rule changed or was paused after this backlog was queued'
  where e.status='queued' and e.backlog_pending
    and not exists(select 1 from workflow_rules r where r.id=e.rule_id and r.active and r.revision=e.rule_revision);
  get diagnostics stale=row_count;
  update workflow_executions e set backlog_pending=false
  where e.status='queued' and e.backlog_pending
    and exists(select 1 from workflow_rules r where r.id=e.rule_id and r.active and r.revision=e.rule_revision);
  get diagnostics released=row_count;
  return jsonb_build_object('released',released,'skipped_stale',stale);
end;
$$;

create function due_workflow_sources(p_limit integer default 100)
returns table(event_type text,source_table text,source_id uuid,event_key text,occurred_at timestamptz)
language sql stable security definer set search_path=public as $$
  with candidates as (
    select 'reminder.due'::text as event_type,'tasks'::text as source_table,t.id as source_id,
      'reminder:'||t.id||':'||t.reminder_version as event_key,t.due_date as occurred_at
    from tasks t where t.kind='reminder' and t.status='open' and t.due_date<=clock_timestamp()
      and t.due_date>=(select min(active_since) from workflow_rules where active and trigger_type='reminder.due')
    union all
    select 'renewal.milestone','policies',p.id,'renewal:'||p.id||':'||term.value||':'||milestone.value,
      (term.value-milestone.value)::timestamp at time zone 'America/Phoenix'
    from policies p
      cross join lateral (select coalesce(p.renewal_date,p.expiration_date) as value) term
      cross join lateral (select term.value-(clock_timestamp() at time zone 'America/Phoenix')::date as value) days
      cross join lateral (select case when days.value<=0 then 0 else min(value::integer) end as value
        from jsonb_array_elements_text(automation_rule_policy('renewal')->'milestones') where value::integer>=days.value) milestone
    where lower(p.status) in ('active','issued','bound','in_force','inforce')
      and days.value between -(automation_rule_policy('renewal')->>'grace_days')::integer and (automation_rule_policy('renewal')->>'window_days')::integer
      and milestone.value is not null
      and (term.value-milestone.value)::timestamp at time zone 'America/Phoenix'
        >=(select min(active_since) from workflow_rules where active and trigger_type='renewal.milestone')
  )
  select c.* from candidates c
  where not exists(select 1 from workflow_events e where e.event_key=c.event_key)
    and exists(select 1 from workflow_rules r where r.active and r.trigger_type=c.event_type and c.occurred_at>=r.active_since
      and workflow_matches(r.definition,workflow_source_context(c.source_table,c.source_id)))
  order by occurred_at,source_id limit least(greatest(p_limit,1),100);
$$;

create function emit_workflow_due_events()
returns integer language plpgsql security definer set search_path=public as $$
declare source record; amount integer:=0;
begin
  for source in select * from due_workflow_sources() loop
    if queue_workflow_event(source.event_type,source.source_table,source.source_id,source.event_key,source.occurred_at) is not null then amount:=amount+1; end if;
  end loop;
  return amount;
end;
$$;

do $patch$
declare definition text:=pg_get_functiondef('public.preview_automation_job(text)'::regprocedure);
  validation text:=pg_get_functiondef('public.validate_automation_configuration(jsonb)'::regprocedure);
begin
  if strpos(definition,'elsif p_job=''internal-actions'' then')=0
    or strpos(definition,'''preview_only'',true)')=0 then raise exception 'Automation preview contract changed; review before patching'; end if;
  definition:=replace(definition,'elsif p_job=''internal-actions'' then',
    'elsif p_job=''custom-workflows'' then
      records:=least(50,(select count(*) from workflow_executions where status=''queued'' and definition#>>''{action,type}'' in (''create_task'',''notify'',''create_note'')))
        +least(1,(select count(*) from workflow_executions where status=''queued'' and definition#>>''{action,type}'' in (''enroll_sequence'',''draft_sequence'')))
        +(select count(*) from due_workflow_sources());
    elsif p_job=''internal-actions'' then');
  definition:=replace(definition,'''may_use_ai'',p_job=''outreach''',
    '''may_use_ai'',p_job=''outreach'' or (p_job=''custom-workflows'' and exists(select 1 from workflow_executions where status=''queued'' and definition#>>''{action,type}''=''draft_sequence''))');
  definition:=replace(definition,'''preview_only'',true)',
    '''preview_only'',true,''workflow_revision'',case when p_job=''custom-workflows'' then workflow_rule_revision() end)');
  execute definition;
  if strpos(validation,'Automatic enrollment requires its event executor')=0 then
    raise exception 'Built-in source flag validation changed; review before patching'; end if;
  execute replace(validation,'Automatic enrollment requires its event executor',
    'Configure automatic enrollment with a Custom lead or website rule instead of built-in source flags');
end;
$patch$;

create or replace function public.queue_crm_heartbeat()
returns bigint language plpgsql security definer set search_path=public as $$
declare endpoint text; bearer_secret text; request_id bigint; job text;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='crm_heartbeat_endpoint';
  select decrypted_secret into bearer_secret from vault.decrypted_secrets where name='crm_heartbeat_authorization';
  if endpoint is distinct from 'https://shield-assurance-crm.vercel.app/api/cron/heartbeat' or nullif(bearer_secret,'') is null then
    raise exception 'CRM heartbeat credentials are not configured' using errcode='P0002';
  end if;
  foreach job in array array['scheduled-messages','follow-up-routine','outreach','renewal-radar','website-intake','internal-actions','custom-workflows'] loop
    select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer_secret),
      body:=jsonb_build_object('job',job),timeout_milliseconds:=65000) into request_id;
  end loop;
  return request_id;
end;
$$;

alter table workflow_rules enable row level security;
alter table workflow_rule_versions enable row level security;
alter table workflow_events enable row level security;
alter table workflow_executions enable row level security;
revoke all on workflow_rules,workflow_rule_versions,workflow_events,workflow_executions from public,anon,authenticated;
grant select on workflow_rules,workflow_rule_versions,workflow_events to service_role;
grant select,update on workflow_executions to service_role;
revoke all on function validate_workflow_definition(jsonb),save_workflow_rule(uuid,uuid,integer,jsonb),workflow_source_context(text,uuid),
  workflow_matches(jsonb,jsonb),queue_workflow_event(text,text,uuid,text,timestamptz),capture_workflow_event(),
  workflow_builtin_owns(workflow_events,jsonb),workflow_execution_context(workflow_executions),execute_workflow_internal(integer),
  claim_workflow_adapter_job(),protect_workflow_approval(),protect_workflow_origin() from public,anon,authenticated,service_role;
revoke all on function workflow_rule_revision() from public,anon,authenticated,service_role;
revoke all on function workflow_backlog_candidates(uuid),preview_workflow_backlog(uuid),apply_workflow_backlog(uuid,uuid,integer,bigint,text),
  release_workflow_backlog(uuid) from public,anon,authenticated,service_role;
revoke all on function enroll_workflow_sequence(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function emit_workflow_due_events() from public,anon,authenticated,service_role;
revoke all on function due_workflow_sources(integer) from public,anon,authenticated,service_role;
revoke all on function scrub_deleted_workflow_source() from public,anon,authenticated,service_role;
grant execute on function save_workflow_rule(uuid,uuid,integer,jsonb),execute_workflow_internal(integer),claim_workflow_adapter_job(),workflow_rule_revision(),
  enroll_workflow_sequence(uuid,uuid,uuid,jsonb,text),emit_workflow_due_events(),preview_workflow_backlog(uuid),
  apply_workflow_backlog(uuid,uuid,integer,bigint,text),release_workflow_backlog(uuid) to service_role;
notify pgrst,'reload schema';
commit;
