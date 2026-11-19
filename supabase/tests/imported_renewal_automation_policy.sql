begin;
do $test$
declare actor uuid; revision integer; policy jsonb; due timestamptz;
  batch uuid:=gen_random_uuid(); prospect uuid:=gen_random_uuid(); prospect2 uuid:=gen_random_uuid();
  lead uuid; expected jsonb; result jsonb;
  task_count integer; contact_count integer;
begin
  select user_id into actor from agency_members where active and role='owner' limit 1;
  if actor is null then raise exception 'An owner is required to verify imported-renewal policy'; end if;
  select configuration_revision,automation_configuration into revision,policy from outreach_settings where id=1;
  due:=import_renewal_due_date('2027-04-01','month','2026-11-05T08:00:00Z');
  if due<>'2027-01-31T16:00:00Z'::timestamptz then raise exception 'Default month-precision renewal timing changed: %',due; end if;
  perform save_agency_automation_settings(actor,jsonb_set(policy,'{import_renewal,task_days_before}','30'),revision);
  select configuration_revision,automation_configuration into revision,policy from outreach_settings where id=1;
  due:=import_renewal_due_date('2027-04-22','date','2026-11-05T08:00:00Z');
  if due<>'2027-03-23T16:00:00Z'::timestamptz then raise exception 'Saved date-precision timing was ignored: %',due; end if;
  due:=import_renewal_due_date('2026-11-07','date','2026-11-08T19:00:00Z');
  if due<>'2026-11-09T16:00:00Z'::timestamptz then raise exception 'Overdue weekend fallback must use the next Arizona business day: %',due; end if;
  perform save_agency_automation_settings(actor,jsonb_set(policy,'{import_renewal,task_days_before}','0'),revision);
  select configuration_revision,automation_configuration into revision,policy from outreach_settings where id=1;
  due:=import_renewal_due_date('2027-04-22','date','2026-11-05T08:00:00Z');
  if due<>'2027-04-22T16:00:00Z'::timestamptz then raise exception 'Zero-day timing was not preserved: %',due; end if;
  perform save_agency_automation_settings(actor,jsonb_set(policy,'{import_renewal,task_days_before}','30'),revision);
  select configuration_revision,automation_configuration into revision,policy from outreach_settings where id=1;
  begin
    perform save_agency_automation_settings(actor,jsonb_set(policy,'{import_renewal,task_days_before}','366'),revision);
    raise exception 'Out-of-range import timing was accepted';
  exception when invalid_parameter_value then null; end;
  perform save_agency_automation_settings(actor,jsonb_set(policy,'{import_renewal,tasks_enabled}','false'),revision);
  select configuration_revision,automation_configuration into revision,policy from outreach_settings where id=1;
  insert into import_batches(id,file_name) values(batch,'Imported renewal policy fixture.csv');
  insert into import_prospects(id,batch_id,full_name,email,address,payload)
    values(prospect,batch,'Imported policy target','import-policy-'||actor||'@example.invalid','Imported address','{"profile":{}}');
  select jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'address',address,
    'line_of_business',line_of_business,'payload',payload) into expected from import_prospects where id=prospect;
  result:=promote_import_prospect(prospect,batch,actor,expected,
    '{"kind":"commercial","renewals":[{"type":"Workers Comp","date":"2027-04-22","evidence_class":"vendor_reported","precision":"date"}]}',
    '[{"subject":"Verify imported renewal","description":"Confirm timing before outreach.","due_date":"2027-03-23T16:00:00Z","renewal_date":"2027-04-22","renewal_precision":"date"}]');
  lead:=(result->>'lead_id')::uuid;
  select count(*) filter(where subject ilike '%renewal%'),count(*) filter(where subject ilike 'Contact new lead:%')
    into task_count,contact_count from tasks where related_type='lead' and related_id=lead;
  if task_count<>0 or contact_count<>1 or result->>'tasks_created'<>'0' or result->>'contact_tasks_created'<>'1' then
    raise exception 'Disabling imported renewal work suppressed first contact or retained renewal tasks: %',result; end if;
  perform save_agency_automation_settings(actor,jsonb_set(policy,'{import_renewal,tasks_enabled}','true'),revision);
  select configuration_revision,automation_configuration into revision,policy from outreach_settings where id=1;
  insert into import_prospects(id,batch_id,full_name,email,address,payload)
    values(prospect2,batch,'Enabled policy target','import-policy-enabled-'||actor||'@example.invalid','Imported address','{"profile":{}}');
  select jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'address',address,
    'line_of_business',line_of_business,'payload',payload) into expected from import_prospects where id=prospect2;
  begin
    perform promote_import_prospect(prospect2,batch,actor,expected,'{"kind":"commercial"}',
      '[{"subject":"Missing evidence","description":"No date metadata","due_date":"2027-03-23T16:00:00Z"}]');
    raise exception 'Incomplete imported renewal task was accepted';
  exception when sqlstate '22023' then null;
  end;
  result:=promote_import_prospect(prospect2,batch,actor,expected,'{"kind":"commercial"}',
    '[{"subject":"Verify imported renewal","description":"Confirm timing before outreach.","due_date":"2099-01-01T00:00:00Z","renewal_date":"2027-04-22","renewal_precision":"date"}]');
  lead:=(result->>'lead_id')::uuid;
  if result->>'tasks_created'<>'1' or not exists(select 1 from tasks where related_type='lead' and related_id=lead
      and subject='Verify imported renewal'
      and due_date=import_renewal_due_date('2027-04-22','date',clock_timestamp())) then
    raise exception 'Promotion did not calculate renewal due date from current saved timing policy: %',result; end if;
  if not exists(select 1 from automation_rule_activation where rule='import_renewal')
    or has_function_privilege('authenticated','import_renewal_due_date(date,text,timestamp with time zone)','execute') then
    raise exception 'Imported renewal activation scope or private due-date helper missing'; end if;
end;
$test$;
rollback;
