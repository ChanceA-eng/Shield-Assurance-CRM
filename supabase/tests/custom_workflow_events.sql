begin;
do $test$
declare actor uuid:=gen_random_uuid(); agent uuid:=gen_random_uuid(); definition jsonb; saved jsonb; rule uuid; lead uuid;
  result jsonb; baseline jsonb; original_task uuid;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'workflow-owner-'||actor||'@example.invalid',now()),
    (agent,'workflow-agent-'||agent||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=actor then 'owner' else 'agent' end from auth.users where id in(actor,agent);
  definition:=jsonb_build_object('schema_version',1,'name','QA workflow','event','lead.created','active',true,
    'conditions',jsonb_build_object('sources',jsonb_build_array('workflow-qa-'||actor),'stages','[]'::jsonb,'statuses','[]'::jsonb,'lines','[]'::jsonb,'assignee',null),
    'action',jsonb_build_object('type','create_task','content','Review {{name}}','delay_minutes',30,'priority','high','assignee',agent));
  begin perform save_workflow_rule(agent,null,0,definition); raise exception 'Agent saved workflow'; exception when insufficient_privilege then null; end;
  saved:=save_workflow_rule(actor,null,0,definition); rule:=(saved->>'id')::uuid;
  if saved->>'revision'<>'1' or exists(select 1 from workflow_executions where rule_id=rule) then raise exception 'Rule save executed work'; end if;
  begin perform save_workflow_rule(actor,rule,0,definition); raise exception 'Stale revision accepted'; exception when sqlstate 'PT409' then null; end;
  insert into leads(full_name,source,status,form_payload) values('Workflow built-in precedence','workflow-qa-'||actor,'new','{}') returning id into lead;
  result:=execute_workflow_internal();
  if result->>'skipped'<>'1' or exists(select 1 from tasks where automation_provenance->>'workflow_rule'=rule::text) then
    raise exception 'Custom task duplicated enabled built-in work'; end if;
  baseline:=(select automation_configuration from outreach_settings where id=1);
  perform save_agency_automation_settings(actor,jsonb_set(jsonb_set(baseline,'{intake,enabled}','false'),'{follow_up,enabled}','false'),
    (select configuration_revision from outreach_settings where id=1));
  insert into leads(full_name,source,status,form_payload) values('Workflow task target','workflow-qa-'||actor,'new','{}') returning id into lead;
  result:=execute_workflow_internal();
  if result->>'succeeded'<>'1' or result->>'failed'<>'0' then raise exception 'Internal workflow execution failed: %',result; end if;
  select id into original_task from tasks where automation_provenance->>'workflow_rule'=rule::text
    and automation_provenance->>'workflow_group'='lead:lead:'||lead;
  if original_task is null or not exists(select 1 from tasks where id=original_task and priority='high' and assignee=agent::text and subject='Review Workflow task target') then
    raise exception 'Task action did not retain configured text/priority/actual assignment'; end if;
  result:=execute_workflow_internal();
  if result->>'succeeded'<>'0' or (select count(*) from tasks where id=original_task)<>1 then raise exception 'Workflow replay duplicated task'; end if;
  insert into leads(full_name,source,status,form_payload) values('Workflow pause target','workflow-qa-'||actor,'new','{}') returning id into lead;
  saved:=save_workflow_rule(actor,rule,1,jsonb_set(definition,'{active}','false'));
  if exists(select 1 from workflow_executions where rule_id=rule and status='queued') then raise exception 'Paused rule retained runnable queued actions'; end if;
  if not exists(select 1 from tasks where id=original_task and status='open') then raise exception 'Pausing completed prior work'; end if;
  saved:=save_workflow_rule(actor,rule,2,definition);
  perform queue_workflow_event('lead.created','leads',lead,'old-event-'||lead,now()-interval '1 day');
  if exists(select 1 from workflow_events where event_key='old-event-'||lead) then raise exception 'Re-enable replayed historical source'; end if;
  if has_table_privilege('authenticated','workflow_rules','insert') or has_function_privilege('authenticated','execute_workflow_internal(integer)','execute') then
    raise exception 'Browser role can mutate rules or execute workflows directly'; end if;
  if (select count(*) from workflow_rule_versions where rule_id=rule)<>3 then raise exception 'Rule revisions were not retained'; end if;
end;
$test$;
do $test$
declare actor uuid:=gen_random_uuid(); definition jsonb; task_rule uuid; other_rule uuid; note_rule uuid; stage_rule uuid;
  target uuid; account uuid:=gen_random_uuid(); alias_lead uuid; original_task uuid; old_due timestamptz; result jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'workflow-overlap-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role) values(actor,'workflow-overlap-'||actor||'@example.invalid','owner');
  definition:=jsonb_build_object('schema_version',1,'name','First contact rule','event','lead.created','active',true,
    'conditions',jsonb_build_object('sources',jsonb_build_array('workflow-overlap-'||actor),'stages','[]'::jsonb,'statuses','[]'::jsonb,'lines','[]'::jsonb,'assignee',null),
    'action',jsonb_build_object('type','create_task','content','Review {{name}}','delay_minutes',30,'priority','high','assignee',null));
  task_rule:=(save_workflow_rule(actor,null,0,definition)->>'id')::uuid;
  other_rule:=(save_workflow_rule(actor,null,0,jsonb_set(definition,'{name}','"Competing rule"'))->>'id')::uuid;
  note_rule:=(save_workflow_rule(actor,null,0,jsonb_set(jsonb_set(jsonb_set(definition,'{action,type}','"create_note"'),'{action,delay_minutes}','0'),'{action,priority}','"medium"'))->>'id')::uuid;
  insert into leads(full_name,source,status) values('Overlap target','workflow-overlap-'||actor,'new') returning id into target;
  result:=execute_workflow_internal();
  if not exists(select 1 from workflow_executions where rule_id=other_rule and status='skipped')
    or (select count(*) from tasks where related_id=target and action_category='workflow')<>1
    or not exists(select 1 from interactions where lead_id=target and content='Review Overlap target') then
    raise exception 'Competing task rules duplicated work or suppressed a deliberate note'; end if;
  select id,due_date into original_task,old_due from tasks where related_id=target and action_category='workflow';
  stage_rule:=(save_workflow_rule(actor,null,0,jsonb_set(definition,'{event}','"lead.stage_changed"'))->>'id')::uuid;
  update leads set status='contacted' where id=target;
  perform execute_workflow_internal();
  if (select count(*) from tasks where related_id=target and action_category='workflow')<>1 then raise exception 'Repeated source event duplicated open contact work'; end if;
  update tasks set status='completed',subject='Manually adjusted title' where id=original_task;
  update leads set status='quoted' where id=target;
  perform execute_workflow_internal();
  if not exists(select 1 from tasks where id=original_task and status='completed' and subject='Manually adjusted title' and due_date=old_due)
    or (select count(*) from tasks where related_id=target and action_category='workflow')<>2 then
    raise exception 'New event reopened or rewrote a completed manual task instead of creating fresh work'; end if;
  insert into clients(id,full_name) values(account,'Canonical contact account');
  insert into leads(full_name,source,status,account_id) values('Alias one','workflow-overlap-'||actor,'new',account) returning id into alias_lead;
  insert into tasks(subject,related_type,related_id,account_id) values('Existing manual contact task','lead',alias_lead,account);
  insert into leads(full_name,source,status,account_id) values('Alias two','workflow-overlap-'||actor,'new',account);
  perform execute_workflow_internal();
  if exists(select 1 from tasks where account_id=account and action_category='workflow') then raise exception 'Canonical account aliases duplicated existing manual work'; end if;
end;
$test$;
do $test$
declare actor uuid:=gen_random_uuid(); target uuid; account uuid:=gen_random_uuid(); definition jsonb; reminder_rule uuid; renewal_rule uuid;
  reminder uuid; policy uuid; old_term date; result jsonb; before_count integer; emitted integer; i integer;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'workflow-due-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role) values(actor,'workflow-due-'||actor||'@example.invalid','owner');
  insert into clients(id,full_name) values(account,'Renewal workflow account');
  insert into leads(full_name,source,status) values('Reminder workflow lead','workflow-due-'||actor,'new') returning id into target;
  definition:=jsonb_build_object('schema_version',1,'name','Due work note','event','reminder.due','active',true,
    'conditions',jsonb_build_object('sources',jsonb_build_array('workflow-due-'||actor),'stages','[]'::jsonb,'statuses','[]'::jsonb,'lines','[]'::jsonb,'assignee',null),
    'action',jsonb_build_object('type','create_note','content','Due review: {{name}}','delay_minutes',0,'priority','medium','assignee',null));
  reminder_rule:=(save_workflow_rule(actor,null,0,definition)->>'id')::uuid;
  perform save_agency_automation_settings(actor,jsonb_set(jsonb_set((select automation_configuration from outreach_settings where id=1),
    '{reminders,enabled}','false'),'{renewal,enabled}','false'),(select configuration_revision from outreach_settings where id=1));
  -- Simulate a rule enabled in an earlier scheduler transaction, without weakening the runtime's future cutoff.
  update workflow_rules set active_since=clock_timestamp()-interval '1 minute' where id=reminder_rule;
  insert into tasks(subject,kind,status,due_date,related_type,related_id)
    values('Workflow due reminder','reminder','open',clock_timestamp()-interval '5 seconds','lead',target) returning id into reminder;
  before_count:=(select count(*) from interactions where lead_id=target);
  result:=preview_automation_job('custom-workflows');
  if (result->>'records')::integer<1 or result->>'may_send_email'<>'false'
    or (result->>'workflow_revision')::bigint<>workflow_rule_revision()
    or exists(select 1 from workflow_events where source_id=reminder) then raise exception 'Preview missed due events or executed work'; end if;
  emitted:=emit_workflow_due_events();
  if emitted<>1 then raise exception 'Custom reminders depended on paused built-ins: %',emitted; end if;
  update tasks set due_date=clock_timestamp()+interval '1 day' where id=reminder;
  result:=execute_workflow_internal();
  if result->>'skipped'<>'1' or (select count(*) from interactions where lead_id=target)<>before_count then raise exception 'Rescheduled reminder executed stale queued work'; end if;
  for i in 1..105 loop
    insert into tasks(subject,kind,status,due_date,related_type,related_id) values('Bounded workflow reminder','reminder','open',
      clock_timestamp()-interval '5 seconds','lead',target);
  end loop;
  if (select count(*) from due_workflow_sources())<>100 or (preview_automation_job('custom-workflows')->>'records')::integer<>100 then
    raise exception 'Due-event enumeration or preview exceeded its exact 100-record batch'; end if;
  if emit_workflow_due_events()<>100 or emit_workflow_due_events()<>5 or emit_workflow_due_events()<>0 then raise exception 'Bounded due events failed continuation or replay'; end if;
  perform execute_workflow_internal(100); perform execute_workflow_internal(100);
  old_term:=(clock_timestamp() at time zone 'America/Phoenix')::date+15;
  renewal_rule:=(save_workflow_rule(actor,null,0,jsonb_set(definition,'{event}','"renewal.milestone"'))->>'id')::uuid;
  update workflow_rules set active_since=((old_term-15)::timestamp at time zone 'America/Phoenix')-interval '1 second' where id=renewal_rule;
  insert into policies(client_id,account_id,insured_name,carrier,line_of_business,policy_number,effective_date,expiration_date,renewal_date,premium,status,source)
    values(account,account,'Workflow account','Test carrier','Auto','WF-'||actor,old_term-30,old_term,old_term,1000,'issued','workflow-due-'||actor)
    returning id into policy;
  if emit_workflow_due_events()<>1 or emit_workflow_due_events()<>0 then raise exception 'Independent renewal milestone missed or duplicated'; end if;
  insert into notifications(client_id,type,message,renewal_key) values(account,'renewal','Existing built-in milestone',policy||':'||old_term||':15');
  if (select count(*) from workflow_events where source_id=policy and event_type='renewal.milestone')<>1 then raise exception 'Renewal notification and independent emitter disagreed on event identity'; end if;
  update policies set renewal_date=old_term+10 where id=policy;
  result:=execute_workflow_internal();
  if result->>'skipped'<>'1' or exists(select 1 from interactions where client_id=account) then raise exception 'Changed renewal term executed old milestone'; end if;
end;
$test$;
do $test$
declare actor uuid:=gen_random_uuid(); definition jsonb; rule uuid; target uuid; claim jsonb; enrollment jsonb; outbox uuid; email text;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'workflow-sequence-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role) values(actor,'workflow-sequence-'||actor||'@example.invalid','owner');
  definition:=jsonb_build_object('schema_version',1,'name','Consent-only enrollment','event','lead.created','active',true,
    'conditions',jsonb_build_object('sources',jsonb_build_array('workflow-sequence-'||actor),'stages','[]'::jsonb,'statuses','[]'::jsonb,'lines','[]'::jsonb,'assignee',null),
    'action',jsonb_build_object('type','enroll_sequence','content','','delay_minutes',0,'priority','medium','assignee',null));
  rule:=(save_workflow_rule(actor,null,0,definition)->>'id')::uuid;
  email:='workflow-recipient-'||actor||'@example.invalid';
  insert into leads(full_name,email,source,status) values('Consent-only target',email,'workflow-sequence-'||actor,'new') returning id into target;
  claim:=claim_workflow_adapter_job();
  begin perform enroll_workflow_sequence((claim->>'id')::uuid,actor,null,null,email); raise exception 'Missing marketing consent enrolled'; exception when sqlstate 'PT409' then null; end;
  insert into marketing_email_consents(email,source,consented_at,recorded_by_auth) values(email,'Synthetic workflow fixture',clock_timestamp(),actor);
  enrollment:=enroll_workflow_sequence((claim->>'id')::uuid,actor,null,null,email);
  if enrollment->>'workflow_rule_id'<>rule::text or enrollment->>'auto_send_enabled'<>'false'
    or exists(select 1 from outreach_outbox where lead_id=target) then raise exception 'Enroll-only action drafted/sent or lost approval provenance'; end if;
  if enroll_workflow_sequence((claim->>'id')::uuid,actor,null,null,email)->>'id'<>enrollment->>'id' then raise exception 'Claim replay duplicated enrollment'; end if;
  insert into outreach_outbox(enrollment_id,lead_id,to_email,subject,body,requires_manual_approval)
    values((enrollment->>'id')::uuid,target,email,'Fixture draft','No delivery in tests',false) returning id into outbox;
  update outreach_outbox set requires_manual_approval=false where id=outbox;
  if not (select requires_manual_approval from outreach_outbox where id=outbox) then raise exception 'Workflow draft bypassed manual approval'; end if;
  begin update sequence_enrollments set workflow_rule_id=null where id=(enrollment->>'id')::uuid;
    raise exception 'Workflow provenance removed'; exception when insufficient_privilege then null; end;
  update sequence_enrollments set status='paused' where id=(enrollment->>'id')::uuid;
  begin perform enroll_workflow_sequence((claim->>'id')::uuid,actor,null,null,email); raise exception 'Paused sequence resumed'; exception when sqlstate 'PT409' then null; end;
  if (select status from sequence_enrollments where id=(enrollment->>'id')::uuid)<>'paused' then raise exception 'Existing paused sequence was changed'; end if;
  insert into email_suppressions(email,reason) values(email,'Fixture suppression');
  begin perform enroll_workflow_sequence((claim->>'id')::uuid,actor,null,null,email); raise exception 'Suppression bypassed'; exception when sqlstate 'PT409' then null; end;
end;
$test$;
create function workflow_test_notification_failure()
returns trigger language plpgsql as $$
begin
  if new.message='Rollback workflow notification' then
    insert into notifications(type,message,href,automation_key) values('workflow','Rollback workflow side effect',new.href,new.automation_key||':probe');
    raise exception 'Synthetic workflow notification failure';
  end if;
  return new;
end;
$$;
create trigger workflow_test_notification_failure before insert on notifications for each row execute function workflow_test_notification_failure();
do $test$
declare actor uuid:=gen_random_uuid(); definition jsonb; rule uuid; target uuid; result jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'workflow-rollback-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role) values(actor,'workflow-rollback-'||actor||'@example.invalid','owner');
  definition:=jsonb_build_object('schema_version',1,'name','Rollback notification','event','lead.created','active',true,
    'conditions',jsonb_build_object('sources',jsonb_build_array('workflow-rollback-'||actor),'stages','[]'::jsonb,'statuses','[]'::jsonb,'lines','[]'::jsonb,'assignee',null),
    'action',jsonb_build_object('type','notify','content','Rollback workflow notification','delay_minutes',0,'priority','medium','assignee',null));
  rule:=(save_workflow_rule(actor,null,0,definition)->>'id')::uuid;
  insert into leads(full_name,source,status) values('Rollback target','workflow-rollback-'||actor,'new') returning id into target;
  result:=execute_workflow_internal();
  if result->>'failed'<>'1' or not exists(select 1 from workflow_executions where rule_id=rule and status='failed'
    and error='Synthetic workflow notification failure')
    or exists(select 1 from notifications where message in ('Rollback workflow notification','Rollback workflow side effect')) then
    raise exception 'Failed custom action hid its error or retained partial side effects'; end if;
  if execute_workflow_internal()->>'failed'<>'0' then raise exception 'Failed workflow action was blindly retried'; end if;
  insert into leads(full_name,email,source,status) values('Deleted workflow contact','deleted-workflow@example.invalid','workflow-rollback-'||actor,'new') returning id into target;
  delete from leads where id=target;
  if exists(select 1 from workflow_events where source_id=target and (context?'name' or context?'email'))
    or exists(select 1 from workflow_executions j join workflow_events e on e.id=j.event_id where e.source_id=target and j.status<>'skipped') then
    raise exception 'Deleted source retained contact snapshots or runnable custom work'; end if;
end;
$test$;
do $test$
declare actor uuid:=gen_random_uuid(); definition jsonb; rule uuid; original_scope timestamptz; new_scope timestamptz;
  target uuid; reminder uuid; result jsonb; queued_event uuid; saved jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'workflow-scope-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role) values(actor,'workflow-scope-'||actor||'@example.invalid','owner');
  insert into leads(full_name,source,status) values('Scope target','workflow-scope-'||actor,'new') returning id into target;
  definition:=jsonb_build_object('schema_version',1,'name','Future scope rule','event','reminder.due','active',true,
    'conditions',jsonb_build_object('sources',jsonb_build_array('workflow-scope-'||actor),'stages','[]'::jsonb,'statuses','[]'::jsonb,'lines','[]'::jsonb,'assignee',null),
    'action',jsonb_build_object('type','notify','content','Previously queued reminder','delay_minutes',0,'priority','medium','assignee',null));
  rule:=(save_workflow_rule(actor,null,0,definition)->>'id')::uuid;
  update workflow_rules set active_since=clock_timestamp()-interval '1 day' where id=rule returning active_since into original_scope;
  saved:=save_workflow_rule(actor,rule,1,definition);
  if saved->>'revision'<>'1' or (select active_since from workflow_rules where id=rule)<>original_scope then raise exception 'No-op save changed the activation cutoff'; end if;
  insert into tasks(subject,kind,status,due_date,related_type,related_id)
    values('Previously due scope reminder','reminder','open',clock_timestamp()-interval '5 minutes','lead',target) returning id into reminder;
  queued_event:=queue_workflow_event('reminder.due','tasks',reminder,'scope-before:'||reminder,(select due_date from tasks where id=reminder));
  if queued_event is null then raise exception 'Earlier active rule did not capture its eligible event'; end if;
  saved:=save_workflow_rule(actor,rule,1,jsonb_set(definition,'{action,content}','"Future reminder only"'));
  select active_since into new_scope from workflow_rules where id=rule;
  if new_scope<=original_scope or saved->>'revision'<>'2' then raise exception 'Active definition edit retained the historical activation cutoff'; end if;
  if queue_workflow_event('reminder.due','tasks',reminder,'scope-after:'||reminder,(select due_date from tasks where id=reminder)) is not null then
    raise exception 'Active definition edit captured an old due event without explicit backlog apply'; end if;
  result:=execute_workflow_internal();
  if not exists(select 1 from workflow_executions where event_id=queued_event and rule_revision=1 and status='succeeded')
    or not exists(select 1 from notifications where message='Previously queued reminder' and href='/leads?lead='||target)
    or exists(select 1 from notifications where message='Future reminder only' and href='/leads?lead='||target) then
    raise exception 'Definition edit rewrote previously captured work'; end if;
  saved:=save_workflow_rule(actor,rule,2,jsonb_set(jsonb_set(definition,'{event}','"renewal.milestone"'),'{name}','"New renewal trigger"'));
  if (select active_since from workflow_rules where id=rule)<=new_scope then raise exception 'Changing the event reused a past activation cutoff'; end if;
  update workflow_rules set active_since=clock_timestamp()-interval '1 day' where id=rule;
  perform save_agency_automation_settings(actor,jsonb_set((select automation_configuration from outreach_settings where id=1),
    '{renewal,grace_days}',to_jsonb(case when (select automation_configuration#>>'{renewal,grace_days}' from outreach_settings where id=1)='90'
      then 89 else (select (automation_configuration#>>'{renewal,grace_days}')::integer+1 from outreach_settings where id=1) end)),
    (select configuration_revision from outreach_settings where id=1));
  if (select active_since from workflow_rules where id=rule)<=new_scope then raise exception 'Renewal policy edit backfilled custom date events'; end if;
end;
$test$;
do $test$
declare actor uuid:=gen_random_uuid(); definition jsonb; rule uuid; source_name text:='backlog-'||gen_random_uuid()::text;
  target uuid:=gen_random_uuid(); unrelated uuid:=gen_random_uuid(); archived uuid:=gen_random_uuid();
  linked_lead uuid:=gen_random_uuid(); intake_event uuid:=gen_random_uuid(); website_rule uuid;
  batch_source text:='backlog-batch-'||gen_random_uuid()::text; batch_rule uuid; batch_preview jsonb; batch_result jsonb;
  snapshot jsonb; result jsonb; queued_event uuid; preview jsonb; apply_result jsonb; saved jsonb;
begin
  update workflow_rules set active=false where active;
  insert into auth.users(id,email,email_confirmed_at) values(actor,'workflow-backlog-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role) values(actor,'workflow-backlog-'||actor||'@example.invalid','owner');
  insert into leads(id,full_name,source,status) values
    (target,'Existing backlog target',source_name,'new'),
    (unrelated,'Unrelated backlog target','unrelated-source','new'),
    (archived,'Archived backlog target',source_name,'new');
  update leads set archived_at=clock_timestamp() where id=archived;
  definition:=jsonb_build_object('schema_version',1,'name','Explicit lead backlog','event','lead.created','active',true,
    'conditions',jsonb_build_object('sources',jsonb_build_array(source_name),'stages','[]'::jsonb,'statuses','[]'::jsonb,'lines','[]'::jsonb,'assignee',null),
    'action',jsonb_build_object('type','create_task','content','Review {{name}}','delay_minutes',0,'priority','medium','assignee',null));
  rule:=(save_workflow_rule(actor,null,0,definition)->>'id')::uuid;
  preview:=preview_workflow_backlog(rule);
  if preview->>'eligible_count'<>'1' or preview->>'rule_revision'<>'1' or length(preview->>'fingerprint')<>32 then
    raise exception 'Lead backlog preview did not count only current matching active records: %',preview; end if;
  update leads set source='temporarily-changed' where id=target;
  begin
    perform apply_workflow_backlog(actor,rule,1,(preview->>'eligible_count')::bigint,preview->>'fingerprint');
    raise exception 'Changed backlog eligibility was applied without a fresh preview';
  exception when sqlstate 'PT409' then null;
  end;
  update leads set source=source_name where id=target;
  preview:=preview_workflow_backlog(rule);
  apply_result:=apply_workflow_backlog(actor,rule,1,(preview->>'eligible_count')::bigint,preview->>'fingerprint');
  select id into queued_event from workflow_events where event_key='backlog:'||rule::text||':lead.created:'||target::text;
  if apply_result->>'queued_count'<>'1' or queued_event is null
    or not exists(select 1 from workflow_executions where event_id=queued_event and backlog_pending and status='queued') then
    raise exception 'Explicit backlog apply did not queue the reviewed existing lead'; end if;
  perform execute_workflow_internal();
  if not exists(select 1 from workflow_executions where event_id=queued_event and backlog_pending and status='queued')
    or exists(select 1 from tasks where related_type='lead' and related_id=target and action_category='workflow') then
    raise exception 'Background processing executed held backlog work before an owner run'; end if;
  result:=release_workflow_backlog(actor);
  if result->>'released'<>'1' then raise exception 'Explicit owner run did not release the matching backlog: %',result; end if;
  perform execute_workflow_internal();
  if not exists(select 1 from workflow_executions where event_id=queued_event and status='succeeded' and not backlog_pending)
    or not exists(select 1 from tasks where related_type='lead' and related_id=target and action_category='workflow') then
    raise exception 'Explicitly released lead backlog did not execute once'; end if;
  if (preview_workflow_backlog(rule)->>'eligible_count')<>'0' then raise exception 'Applied backlog source was offered a second time'; end if;

  insert into leads(id,full_name,source,status) values(linked_lead,'Existing website target',source_name,'new');
  insert into lead_intake_events(id,lead_id,submission_key,submitted_at,time_basis,snapshot)
    values(intake_event,linked_lead,'workflow-backlog:'||intake_event::text,clock_timestamp()-interval '2 days','submitted','{"source":"website"}');
  definition:=jsonb_set(jsonb_set(definition,'{name}','"Explicit website backlog"'),'{event}','"website.submitted"');
  website_rule:=(save_workflow_rule(actor,null,0,definition)->>'id')::uuid;
  snapshot:=preview_workflow_backlog(website_rule);
  if snapshot->>'eligible_count'<>'1' then raise exception 'Linked unhandled website submission was not counted: %',snapshot; end if;
  apply_result:=apply_workflow_backlog(actor,website_rule,1,(snapshot->>'eligible_count')::bigint,snapshot->>'fingerprint');
  if apply_result->>'queued_count'<>'1' or not exists(select 1 from workflow_executions e join workflow_events w on w.id=e.event_id
      where e.rule_id=website_rule and e.status='queued' and e.backlog_pending and w.source_id=intake_event) then
    raise exception 'Website backlog did not queue only its linked submission'; end if;
  update lead_intake_events set handled_at=clock_timestamp() where id=intake_event;
  result:=release_workflow_backlog(actor);
  if result->>'skipped_stale'<>'1' or exists(select 1 from workflow_executions e join workflow_events w on w.id=e.event_id
      where e.rule_id=website_rule and e.status='queued' and w.source_id=intake_event) then
    raise exception 'Resolved website backlog was released after its source changed'; end if;

  select r.definition into definition from workflow_rules r where r.id=rule;
  saved:=save_workflow_rule(actor,rule,1,jsonb_set(definition,'{active}','false'));
  insert into leads(full_name,source,status)
    select 'Bounded backlog target '||n,batch_source,'new' from generate_series(1,102) n;
  definition:=jsonb_set(jsonb_set(jsonb_set(definition,'{name}','"Bounded lead backlog"'),'{event}','"lead.created"'),
    '{conditions,sources}',jsonb_build_array(batch_source));
  batch_rule:=(save_workflow_rule(actor,null,0,definition)->>'id')::uuid;
  batch_preview:=preview_workflow_backlog(batch_rule);
  if batch_preview->>'eligible_count'<>'102' then raise exception 'Backlog preview omitted matching existing leads: %',batch_preview; end if;
  saved:=save_workflow_rule(actor,batch_rule,1,jsonb_set(definition,'{action,content}','"Updated backlog action"'));
  begin
    perform apply_workflow_backlog(actor,batch_rule,1,102,batch_preview->>'fingerprint');
    raise exception 'A stale rule revision was applied from an old preview';
  exception when sqlstate 'PT409' then null;
  end;
  batch_preview:=preview_workflow_backlog(batch_rule);
  batch_result:=apply_workflow_backlog(actor,batch_rule,2,102,batch_preview->>'fingerprint');
  if batch_result->>'queued_count'<>'100' or batch_result->>'remaining_count'<>'2' then
    raise exception 'Backlog batch was not bounded to 100 records: %',batch_result; end if;
  saved:=save_workflow_rule(actor,batch_rule,2,jsonb_set(definition,'{active}','false'));
  if (select count(*) from workflow_executions where rule_id=batch_rule and status='skipped' and not backlog_pending)<>100
    or exists(select 1 from workflow_executions where rule_id=batch_rule and backlog_pending) then
    raise exception 'Pausing a rule did not invalidate its held backlog immediately'; end if;
  if has_function_privilege('authenticated','apply_workflow_backlog(uuid,uuid,integer,bigint,text)','execute')
    or has_function_privilege('authenticated','release_workflow_backlog(uuid)','execute') then
    raise exception 'Browser role can directly apply or release workflow backlogs'; end if;
end;
$test$;
rollback;
