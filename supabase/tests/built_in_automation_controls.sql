begin;
do $test$
<<fixture>>
declare owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid(); account uuid:=gen_random_uuid();
  first_lead uuid:=gen_random_uuid(); old_lead uuid:=gen_random_uuid(); fresh_lead uuid:=gen_random_uuid();
  event_id uuid:=gen_random_uuid(); incoming uuid:=gen_random_uuid(); outgoing uuid:=gen_random_uuid();
  policy_id uuid:=gen_random_uuid(); claim_id uuid:=gen_random_uuid(); reply_task uuid; reminder uuid:=gen_random_uuid();
  enrollment uuid:=gen_random_uuid(); reminder2 uuid:=gen_random_uuid();
  original jsonb; settings jsonb; revision integer; changed integer; count_before bigint; counters jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'controls-owner-'||owner_id||'@example.invalid',now()),(agent_id,'controls-agent-'||agent_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
    from auth.users where id in (owner_id,agent_id);
  select automation_configuration,configuration_revision into original,revision from outreach_settings where id=1;
  counters:=jsonb_build_object('leads',(select count(*) from leads),'tasks',(select count(*) from tasks),
    'messages',(select count(*) from communication_log),'enrollments',(select count(*) from sequence_enrollments),
    'outbox',(select count(*) from outreach_outbox),'notifications',(select count(*) from notifications));
  settings:=jsonb_set(original,'{intake,due_hour}','14');
  settings:=jsonb_set(settings,'{intake,cold_priority}','"low"');
  settings:=jsonb_set(settings,'{reply,due_minutes}','45');
  settings:=jsonb_set(settings,'{sequence,total_steps}','5');
  settings:=jsonb_set(settings,'{sequence,step_gap_days}','8');
  changed:=save_agency_automation_settings(owner_id,settings,revision);
  if changed<>revision+1 or not exists(select 1 from automation_configuration_versions v where v.revision=changed
    and actor_id=owner_id and configuration->'automation'=settings) then raise exception 'Configured save lost revision/actor/snapshot'; end if;
  if counters<>jsonb_build_object('leads',(select count(*) from leads),'tasks',(select count(*) from tasks),
    'messages',(select count(*) from communication_log),'enrollments',(select count(*) from sequence_enrollments),
    'outbox',(select count(*) from outreach_outbox),'notifications',(select count(*) from notifications)) then
    raise exception 'Configuration save executed business work'; end if;
  perform preview_automation_job('follow-up-routine');
  perform preview_automation_job('outreach');
  perform preview_automation_job('renewal-radar');
  perform preview_automation_job('internal-actions');
  perform preview_automation_job('due-reminders');
  if counters<>jsonb_build_object('leads',(select count(*) from leads),'tasks',(select count(*) from tasks),
    'messages',(select count(*) from communication_log),'enrollments',(select count(*) from sequence_enrollments),
    'outbox',(select count(*) from outreach_outbox),'notifications',(select count(*) from notifications)) then
    raise exception 'Preview created business work'; end if;
  begin perform save_agency_automation_settings(agent_id,original,changed); raise exception 'Agent edited automation';
    exception when insufficient_privilege then null; end;
  begin perform save_agency_automation_settings(owner_id,original,revision); raise exception 'Stale automation save succeeded';
    exception when sqlstate 'PT409' then null; end;
  if save_agency_automation_settings(owner_id,settings,changed)<>changed then raise exception 'No-op save changed revision'; end if;
  begin perform validate_automation_configuration(jsonb_set(settings,'{intake,warm_priority}','null')); raise exception 'Null priority accepted';
    exception when invalid_parameter_value then null; end;
  begin perform validate_automation_configuration(jsonb_set(settings,'{sequence,auto_enroll_imports}','true')); raise exception 'Unwired enrollment accepted';
    exception when invalid_parameter_value then null; end;
  begin perform validate_automation_configuration(jsonb_set(settings,'{renewal,milestones}','[30,45,0]')); raise exception 'Unsorted milestones accepted';
    exception when invalid_parameter_value then null; end;
  if intake_due_at(false,'2026-11-06 06:00-07')<>'2026-11-09 14:00-07'::timestamptz
    or intake_due_at(true,'2026-11-04 13:50-07')<>'2026-11-05 14:00-07'::timestamptz then
    raise exception 'Configured intake time or business-day cutoff was ignored'; end if;
  insert into leads(id,full_name,email,created_at) values(first_lead,'Controls lead',first_lead||'@example.invalid',clock_timestamp()),
    (old_lead,'Paused controls lead',old_lead||'@example.invalid',clock_timestamp());
  if not schedule_lead_intake(first_lead,false) then
    raise exception 'Intake was not created: existing %, lead %, policy %',
      (select jsonb_agg(jsonb_build_object('priority',priority,'due',due_date)) from tasks where related_id=first_lead),
      (select jsonb_build_object('source',source,'created_at',created_at) from leads where id=first_lead),automation_rule_policy('intake');
  end if;
  if schedule_lead_intake(first_lead,false) or not exists(select 1 from tasks where related_id=first_lead and priority='low'
    and extract(hour from due_date at time zone 'America/Phoenix')=14) then raise exception 'Intake timing/priority/dedup was ignored'; end if;
  insert into sequence_enrollments(id,lead_id) values(enrollment,first_lead);
  if not exists(select 1 from sequence_enrollments where id=enrollment and total_steps=5 and step_gap_days=8
    and configuration_revision=changed and configuration_snapshot=settings->'sequence') then raise exception 'Enrollment defaults not snapshotted'; end if;
  settings:=jsonb_set(settings,'{sequence,total_steps}','2');
  changed:=save_agency_automation_settings(owner_id,settings,changed);
  if (select total_steps from sequence_enrollments where id=enrollment)<>5 then raise exception 'Settings changed active sequence steps'; end if;
  settings:=jsonb_set(settings,'{intake,enabled}','false');
  settings:=jsonb_set(settings,'{follow_up,enabled}','false');
  settings:=jsonb_set(settings,'{service,tasks_enabled}','false');
  settings:=jsonb_set(settings,'{reminders,enabled}','false');
  changed:=save_agency_automation_settings(owner_id,settings,changed);
  if schedule_lead_intake(old_lead,false) or ensure_default_followups()<>0 then raise exception 'Paused intake/followup executed'; end if;
  insert into lead_intake_events(id,lead_id,submission_key,submitted_at,time_basis,snapshot)
    values(event_id,old_lead,'controls:'||event_id,now(),'submitted','{"website_id":"controls"}');
  perform create_intake_work(event_id);
  if exists(select 1 from tasks where intake_event_id=fixture.event_id) or not exists(select 1 from notifications where intake_event_id=fixture.event_id) then
    raise exception 'Paused intake created a task or hid the website request'; end if;
  if exists(select 1 from agent_workday where source_id=fixture.event_id and task_id is null) then raise exception 'Workday bypassed paused intake'; end if;
  insert into clients(id,full_name) values(account,'Controls account');
  insert into policies(id,client_id,insured_name,carrier,line_of_business,premium,effective_date,renewal_date)
    values(policy_id,account,'Controls policy','Test','Auto',100,current_date,current_date+365);
  insert into claims(id,client_id,policy_id,type,date_of_loss) values(claim_id,account,policy_id,'Controls claim',current_date);
  perform sync_service_action('claim',claim_id);
  if exists(select 1 from tasks where related_type='claim' and related_id=claim_id)
    or exists(select 1 from agent_workday where source_id=claim_id) then raise exception 'Service trigger or projection bypassed pause'; end if;
  insert into tasks(id,subject,kind,due_date,status) values(reminder,'Controls reminder','reminder',now()-interval '1 minute','open');
  perform dispatch_due_reminders();
  if exists(select 1 from notifications where task_id=reminder) then raise exception 'Paused reminder dispatched'; end if;
  settings:=jsonb_set(settings,'{intake,enabled}','true');
  settings:=jsonb_set(settings,'{reminders,enabled}','true');
  changed:=save_agency_automation_settings(owner_id,settings,changed);
  if schedule_lead_intake(old_lead,false) then raise exception 'Resume automatically replayed old intake'; end if;
  insert into leads(id,full_name,created_at) values(fresh_lead,'Fresh controls lead',clock_timestamp());
  if not schedule_lead_intake(fresh_lead,false) then raise exception 'Resume did not accept a future intake event'; end if;
  perform dispatch_due_reminders();
  if exists(select 1 from notifications where task_id=reminder) then raise exception 'Resume replayed old reminder'; end if;
  -- Simulate the next scheduler transaction; now() is fixed for this rollback fixture.
  update automation_rule_activation set active_since=now()-interval '30 seconds' where rule='reminders';
  insert into tasks(id,subject,kind,due_date,status) values(reminder2,'Future controls reminder','reminder',now(),'open');
  perform dispatch_due_reminders();
  perform dispatch_due_reminders();
  if (select count(*) from notifications where task_id=reminder2)<>1 then raise exception 'Future reminder absent or duplicated'; end if;
  insert into communication_log(id,client_id,channel,direction,body,sent_at,metadata)
    values(incoming,account,'email','inbound','Please reply',clock_timestamp(),jsonb_build_object('from',account||'@example.invalid'));
  perform alert_inbound_message(incoming,false);
  select id into reply_task from tasks where inbound_reply_key='client:'||account and status='open';
  if reply_task is null or (select due_date from tasks where id=reply_task)<>(select sent_at+interval '45 minutes' from communication_log where id=incoming) then
    raise exception 'Configured reply target was ignored'; end if;
  settings:=jsonb_set(settings,'{reply,complete_on_successful_send}','false');
  changed:=save_agency_automation_settings(owner_id,settings,changed);
  insert into communication_log(id,client_id,channel,direction,body,sent_at,metadata)
    values(outgoing,account,'sms','outbound','Sent answer',clock_timestamp()+interval '1 minute','{"delivery_status":"accepted_by_provider"}');
  if (select status from tasks where id=reply_task)<>'open' then raise exception 'Disabled auto-completion completed reply work'; end if;
  settings:=jsonb_set(settings,'{reply,enabled}','false');
  changed:=save_agency_automation_settings(owner_id,settings,changed);
  perform sync_reply_action(outgoing,true);
  if (select status from tasks where id=reply_task)<>'open' then raise exception 'Paused reply reconciliation modified existing work'; end if;
  if not exists(select 1 from agent_workday where task_id=reply_task) then raise exception 'Pausing hid existing work'; end if;
  if has_function_privilege('authenticated','public.save_agency_automation_settings(uuid,jsonb,integer)','execute')
    or has_function_privilege('service_role','public.sync_service_action_core(text,uuid)','execute') then raise exception 'Automation control authorization grants unsafe'; end if;
end;
$test$;
rollback;
