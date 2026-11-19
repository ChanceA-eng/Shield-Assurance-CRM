begin;
do $test$
declare
  actor uuid; revision integer; configuration jsonb; changed jsonb;
  account uuid:=gen_random_uuid(); first_claim uuid:=gen_random_uuid(); second_claim uuid:=gen_random_uuid(); third_claim uuid:=gen_random_uuid();
  service_policy uuid:=gen_random_uuid();
  first_task uuid; second_task uuid; third_task uuid; service_active_since timestamptz; reply_active_since timestamptz;
  policy_one uuid:=gen_random_uuid(); policy_two uuid:=gen_random_uuid(); term_one date:=current_date+20; term_two date:=current_date+46;
  result jsonb; definition text;
begin
  select user_id into actor from agency_members where active and role='owner' limit 1;
  if actor is null then raise exception 'An owner is required to verify service notification settings'; end if;
  select configuration_revision,automation_configuration into revision,configuration from outreach_settings where id=1;
  if exists(select 1 from automation_configuration_versions versions
      where versions.configuration#>'{automation,import_renewal}' is null
        or versions.configuration#>'{automation,service,task_templates}' is null
        or versions.configuration#>'{automation,notifications}' is null) then
    raise exception 'Historical automation versions were not upgraded with validated defaults'; end if;
  if configuration#>>'{service,task_templates,claim,subject}'<>'Review {service_type}: {account_name}'
    or (configuration#>>'{notifications,service_events}')::boolean is not true then
    raise exception 'Service templates or notification defaults changed current behavior'; end if;
  insert into clients(id,full_name) values(account,'Service template fixture account');
  insert into policies(id,client_id,insured_name,carrier,line_of_business,premium,effective_date,renewal_date,status)
    values(service_policy,account,'Service fixture insured','Fixture carrier','Auto',500,current_date,current_date+365,'active');
  insert into claims(id,client_id,policy_id,type,status,date_of_loss)
    values(first_claim,account,service_policy,'Auto claim','open',current_date);
  select id into first_task from tasks where related_type='claim' and related_id=first_claim and status='open' limit 1;
  if first_task is null or (select subject from tasks where id=first_task)<>'Review claim: Service template fixture account'
    or (select description from tasks where id=first_task)<>'Automatically queued from the source record. Resolve the request in its linked record.' then
    raise exception 'Default service task wording changed'; end if;

  changed:=jsonb_set(configuration,'{service,task_templates,claim,subject}',
    to_jsonb('Verify {service_type}: {account_name}'::text));
  changed:=jsonb_set(changed,'{service,task_templates,claim,description}',
    to_jsonb('Check {account_name} against the {service_type} record before closing.'::text));
  changed:=jsonb_set(changed,'{notifications,service_events}','false');
  revision:=save_agency_automation_settings(actor,changed,revision);
  select configuration_revision,automation_configuration into revision,configuration from outreach_settings where id=1;
  update claims set status='pending' where id=first_claim;
  insert into claims(id,client_id,policy_id,type,status,date_of_loss)
    values(second_claim,account,service_policy,'Property claim','open',current_date);
  select id into second_task from tasks where related_type='claim' and related_id=second_claim and status='open' limit 1;
  if second_task is null or (select subject from tasks where id=first_task)<>'Review claim: Service template fixture account'
    or (select subject from tasks where id=second_task)<>'Verify claim: Service template fixture account'
    or (select description from tasks where id=second_task)<>'Check Service template fixture account against the claim record before closing.'
    or exists(select 1 from notifications where task_id=second_task) then
    raise exception 'Custom service wording, task preservation or notification pause failed: first %, second %, description %, notification %',
      (select subject from tasks where id=first_task),(select subject from tasks where id=second_task),
      (select description from tasks where id=second_task),exists(select 1 from notifications where task_id=second_task); end if;

  changed:=jsonb_set(configuration,'{notifications,service_events}','true');
  revision:=save_agency_automation_settings(actor,changed,revision);
  select configuration_revision,automation_configuration into revision,configuration from outreach_settings where id=1;
  select activation.active_since into service_active_since from automation_notification_activation activation where activation.category='service_events';
  update claims set status='pending' where id=second_claim;
  if exists(select 1 from notifications where task_id=second_task and created_at>=service_active_since) then
    raise exception 'Re-enabling service notifications replayed an old event'; end if;
  insert into claims(id,client_id,policy_id,type,status,date_of_loss,created_at)
    values(third_claim,account,service_policy,'Glass claim','open',current_date,clock_timestamp()+interval '1 second');
  select id into third_task from tasks where related_type='claim' and related_id=third_claim and status='open' limit 1;
  if third_task is null or not exists(select 1 from notifications where task_id=third_task) then
    raise exception 'A future service event did not create its enabled notification'; end if;

  changed:=jsonb_set(configuration,'{notifications,renewals}','false');
  revision:=save_agency_automation_settings(actor,changed,revision);
  select configuration_revision,automation_configuration into revision,configuration from outreach_settings where id=1;
  insert into policies(id,client_id,insured_name,carrier,line_of_business,premium,effective_date,renewal_date,status)
    values(policy_one,account,'Fixture insured','Fixture carrier','Auto',500,current_date,current_date+20,'active');
  result:=persist_renewal_radar(policy_one,term_one,30,
    jsonb_build_object('subject','Verify policy renewal','description','Review saved policy data.','due_date',now(),'priority','medium'),
    'Fixture renewal notification');
  if (result->>'tasksCreated')::integer<>1 or (result->>'notifications')::integer<>0
    or exists(select 1 from notifications where renewal_key=policy_one::text||':'||term_one::text||':30') then
    raise exception 'Renewal notification pause changed task creation or emitted an alert: %',result; end if;
  changed:=jsonb_set(changed,'{notifications,renewals}','true');
  revision:=save_agency_automation_settings(actor,changed,revision);
  select configuration_revision,automation_configuration into revision,configuration from outreach_settings where id=1;
  result:=persist_renewal_radar(policy_one,term_one,30,
    jsonb_build_object('subject','Verify policy renewal','description','Review saved policy data.','due_date',now(),'priority','medium'),
    'Fixture renewal notification');
  if (result->>'notifications')::integer<>0 then raise exception 'Enabling renewal alerts replayed an old milestone'; end if;
  insert into policies(id,client_id,insured_name,carrier,line_of_business,premium,effective_date,renewal_date,status)
    values(policy_two,account,'Future insured','Fixture carrier','Auto',500,current_date,term_two,'active');
  result:=persist_renewal_radar(policy_two,term_two,45,
    jsonb_build_object('subject','Verify future policy renewal','description','Review saved policy data.','due_date',now(),'priority','medium'),
    'Future fixture renewal notification');
  if (result->>'notifications')::integer<>1 then raise exception 'Future renewal notification did not respect enabled policy: %',result; end if;

  changed:=jsonb_set(configuration,'{notifications,message_replies}','false');
  revision:=save_agency_automation_settings(actor,changed,revision);
  select configuration_revision,automation_configuration into revision,configuration from outreach_settings where id=1;
  if automation_notification_allows('message_replies',clock_timestamp()) then raise exception 'Paused reply notification was allowed'; end if;
  changed:=jsonb_set(changed,'{notifications,message_replies}','true');
  revision:=save_agency_automation_settings(actor,changed,revision);
  select active_since into reply_active_since from automation_notification_activation where category='message_replies';
  if automation_notification_allows('message_replies',reply_active_since-interval '1 second')
    or not automation_notification_allows('message_replies',clock_timestamp()) then
    raise exception 'Reply notification re-enable did not apply only to future events'; end if;
  definition:=pg_get_functiondef('public.alert_inbound_message(uuid,boolean)'::regprocedure);
  if strpos(definition,'automation_notification_allows(''message_replies'',message.sent_at)')=0 then
    raise exception 'Inbound reply executor is not wired to its saved notification control'; end if;
end;
$test$;
rollback;
