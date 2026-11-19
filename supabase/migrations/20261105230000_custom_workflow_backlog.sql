begin;

alter table public.workflow_executions
  add column if not exists backlog_pending boolean not null default false;

create or replace function public.workflow_execution_context(p_job workflow_executions)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare event workflow_events; context jsonb;
begin
  select * into event from workflow_events where id=p_job.event_id;
  context:=workflow_source_context(event.source_table,event.source_id);
  if context is null or context->'target_type' is distinct from event.context->'target_type' or context->'target_id' is distinct from event.context->'target_id'
    or not workflow_matches(p_job.definition,context)
    or not exists(select 1 from workflow_rules where id=p_job.rule_id and active)
    or not exists(select 1 from agency_members where user_id=p_job.owner_id and active and role='owner') then return null; end if;
  if event.event_type in ('lead.created','lead.stage_changed') and not exists(
    select 1 from leads l where l.id=event.source_id and l.archived_at is null
      and lower(coalesce(l.status,'')) not in ('won','lost','archived','deleted')
  ) then return null; end if;
  if event.event_type='website.submitted' and not exists(
    select 1 from lead_intake_events i where i.id=event.source_id and i.dismissed_at is null and i.handled_at is null
  ) then return null; end if;
  if p_job.definition#>>'{action,type}'='create_task' and workflow_builtin_owns(event,context) then return null; end if;
  if p_job.definition#>>'{action,type}'='create_note' and context->>'lead_id' is null and context->>'client_id' is null then return null; end if;
  if event.event_type='reminder.due' and (context->'reminder_version' is distinct from event.context->'reminder_version'
    or (context->>'due_date')::timestamptz>clock_timestamp() or context->>'status'<>'open') then return null; end if;
  if event.event_type='renewal.milestone' and context->'renewal_date' is distinct from event.context->'renewal_date' then return null; end if;
  return context;
end;
$$;

create function public.invalidate_stale_workflow_backlog()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update workflow_executions e set status='skipped',backlog_pending=false,finished_at=clock_timestamp(),
    error='The rule changed or was paused after this backlog was queued'
  where e.rule_id=new.id and e.status='queued' and e.backlog_pending
    and (not new.active or e.rule_revision is distinct from new.revision);
  return new;
end;
$$;
create trigger workflow_backlog_rule_invalidation after update of active,revision on public.workflow_rules
  for each row execute function public.invalidate_stale_workflow_backlog();

create or replace function public.execute_workflow_internal(p_limit integer default 50)
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

create or replace function public.claim_workflow_adapter_job()
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

create or replace function public.workflow_backlog_candidates(p_rule uuid)
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

create or replace function public.preview_workflow_backlog(p_rule uuid)
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

create or replace function public.apply_workflow_backlog(p_actor uuid,p_rule uuid,p_expected_revision integer,p_expected_count bigint,p_expected_fingerprint text)
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
      on conflict on constraint workflow_executions_event_id_rule_id_rule_revision_key do nothing returning id into execution_id;
    if execution_id is null then skipped:=skipped+1; else queued:=queued+1; end if;
  end loop;
  return jsonb_build_object('queued_count',queued,'skipped_count',skipped,
    'remaining_count',greatest(amount-queued-skipped,0),'rule_revision',rule.revision,'preview_only',false);
end;
$$;

create or replace function public.release_workflow_backlog(p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare released integer; stale integer;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can run queued backlog work' using errcode='42501'; end if;
  update workflow_executions e set status='skipped',backlog_pending=false,finished_at=clock_timestamp(),
    error='The rule changed, was paused, or the source is no longer eligible'
  where e.status='queued' and e.backlog_pending
    and (not exists(select 1 from workflow_rules r where r.id=e.rule_id and r.active and r.revision=e.rule_revision)
      or workflow_execution_context(e) is null);
  get diagnostics stale=row_count;
  update workflow_executions e set backlog_pending=false
  where e.status='queued' and e.backlog_pending
    and exists(select 1 from workflow_rules r where r.id=e.rule_id and r.active and r.revision=e.rule_revision)
    and workflow_execution_context(e) is not null;
  get diagnostics released=row_count;
  return jsonb_build_object('released',released,'skipped_stale',stale);
end;
$$;

revoke all on function public.workflow_backlog_candidates(uuid),public.preview_workflow_backlog(uuid),
  public.apply_workflow_backlog(uuid,uuid,integer,bigint,text),public.release_workflow_backlog(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.invalidate_stale_workflow_backlog() from public,anon,authenticated,service_role;
grant execute on function public.preview_workflow_backlog(uuid),
  public.apply_workflow_backlog(uuid,uuid,integer,bigint,text),public.release_workflow_backlog(uuid)
  to service_role;

notify pgrst,'reload schema';
commit;
