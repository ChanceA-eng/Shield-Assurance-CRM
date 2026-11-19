begin;
do $test$
declare
  batch uuid:=gen_random_uuid(); prospect uuid:=gen_random_uuid(); failing uuid:=gen_random_uuid();
  actor uuid; expected jsonb; result jsonb; new_lead uuid; original_tasks integer;
begin
  select user_id into actor from agency_members where active limit 1;
  actor:=coalesce(actor,gen_random_uuid());
  insert into import_batches(id,file_name) values(batch,'Synthetic intelligence fixture.csv');
  insert into import_prospects(id,batch_id,full_name,email,address,payload)
    values(prospect,batch,'Synthetic evidence fixture','intelligence-fixture@example.invalid','Test address','{"profile":{}}'),
      (failing,batch,'Synthetic rollback fixture','intelligence-fail@example.invalid','Other address','{"profile":{}}');
  select jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'address',address,
    'line_of_business',line_of_business,'payload',payload) into expected from import_prospects where id=prospect;
  result:=promote_import_prospect(prospect,batch,actor,expected,
    '{"kind":"commercial","renewals":[{"type":"General Liability","date":"2027-04-22","evidence_class":"predicted","precision":"month"}]}','[]');
  if result->>'disposition'<>'committed' then raise exception 'Promotion failed'; end if;
  new_lead:=(result->>'lead_id')::uuid;
  select count(*) into original_tasks from tasks where related_type='lead' and related_id=new_lead;
  if original_tasks<1 or not exists(select 1 from intelligence_import_evidence where lead_id=new_lead and source_file='Synthetic intelligence fixture.csv'
    and snapshot #>> '{renewals,0,evidence_class}'='predicted' and source_as_of is null) then raise exception 'Tasks or evidence missing'; end if;
  result:=promote_import_prospect(prospect,batch,actor,expected,'{}','[]');
  if result->>'disposition'<>'already_committed' or (select count(*) from tasks where related_type='lead' and related_id=new_lead)<>original_tasks then
    raise exception 'Replay duplicated work'; end if;
  update leads set form_payload=form_payload||'{"keep":"confirmed"}'::jsonb where id=new_lead;
  perform record_intelligence_enrichment(new_lead,actor,'fmcsa','{"power_units":12,"fetched_at":"2026-11-05T08:00:00Z"}',
    '{"full_name":"Synthetic evidence fixture","address":"Test address"}','name_search');
  perform record_intelligence_enrichment(new_lead,actor,'fmcsa','{"power_units":15,"fetched_at":"2026-11-05T09:00:00Z"}',
    '{"full_name":"Synthetic evidence fixture","address":"Test address"}','agent_selected_dot');
  if (select count(*) from intelligence_enrichment_observations where lead_id=new_lead)<>2
    or not exists(select 1 from leads where id=new_lead and form_payload->>'keep'='confirmed'
      and form_payload #>> '{profile,enrichment,fmcsa,power_units}'='15') then raise exception 'Source history or confirmed fields lost'; end if;
  begin
    perform record_intelligence_enrichment(new_lead,actor,'fmcsa','{"power_units":1,"fetched_at":"2026-11-05T08:00:00Z"}',
      '{"full_name":"Synthetic evidence fixture","address":"Test address"}','name_search');
    raise exception 'Older observation overwrote newer';
  exception when sqlstate 'PT409' then null; end;
  perform record_intelligence_enrichment(new_lead,actor,'osha','{"total_inspections":2}',
    '{"full_name":"Synthetic evidence fixture","address":"Test address"}','name_search');
  if not exists(select 1 from leads where id=new_lead and form_payload #>> '{profile,enrichment,fmcsa,power_units}'='15'
      and form_payload #>> '{profile,enrichment,osha,total_inspections}'='2') then raise exception 'Other source observation lost'; end if;
  begin
    perform record_intelligence_enrichment(new_lead,actor,'osha','{"total_inspections":9}',
      '{"full_name":"Outdated company identity","address":"Test address"}','name_search');
    raise exception 'Changed identity accepted';
  exception when sqlstate 'PT409' then null; end;
  select jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'address',address,
    'line_of_business',line_of_business,'payload',payload) into expected from import_prospects where id=failing;
  begin
    perform promote_import_prospect(failing,batch,actor,expected,'{}','[{"subject":"Broken","description":"Broken","due_date":"invalid"}]');
    raise exception 'Invalid task accepted';
  exception when sqlstate '22023' or sqlstate '22007' then null; end;
  if exists(select 1 from leads where form_payload #>> '{import,prospect_id}'=failing::text)
    or exists(select 1 from intelligence_import_evidence where prospect_id=failing)
    or (select disposition from import_prospects where id=failing)<>'pending' then raise exception 'Partial promotion escaped rollback'; end if;
  begin
    perform promote_import_prospect(failing,batch,actor,expected||'{"full_name":"Stale"}','{}','[]');
    raise exception 'Stale promotion accepted';
  exception when sqlstate 'PT409' then null; end;
  insert into leads(full_name,email,source,status)
    select 'Synthetic full-book fixture '||i,'full-book-'||i||'@example.invalid','intelligence_sql_qa','new' from generate_series(1,2101) i;
  result:=intelligence_import_matches('[{"index":0,"full_name":"Other","email":"full-book-2101@example.invalid"}]',actor);
  if jsonb_array_length(result->0->'matches')<>1 then raise exception 'Full-book match beyond 2000 missed'; end if;
  insert into leads(full_name,email,address,source,status) values('Same named business','distinct@example.invalid','Different branch','intelligence_sql_qa','new');
  result:=intelligence_import_matches('[{"index":0,"full_name":"Same named business","address":"Another branch"}]',actor);
  if jsonb_array_length(result->0->'matches')<>0 then raise exception 'Branches conflated by name'; end if;
  update import_prospects set email='full-book-2101@example.invalid' where id=failing;
  select jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'address',address,
    'line_of_business',line_of_business,'payload',payload) into expected from import_prospects where id=failing;
  result:=promote_import_prospect(failing,batch,actor,expected,'{}','[]');
  if result->>'disposition'<>'duplicate' or (select disposition from import_prospects where id=failing)<>'duplicate' then raise exception 'Commit did not recheck matching'; end if;
  if exists(select 1 from outreach_outbox where lead_id=new_lead) or exists(select 1 from sequence_enrollments where lead_id=new_lead) then raise exception 'Import started outreach'; end if;
  if has_table_privilege('authenticated','intelligence_import_evidence','select')
    or has_table_privilege('authenticated','intelligence_enrichment_observations','select')
    or has_function_privilege('authenticated','record_intelligence_enrichment(uuid,uuid,text,jsonb,jsonb,text)','execute')
    or has_function_privilege('authenticated','promote_import_prospect(uuid,uuid,uuid,jsonb,jsonb,jsonb)','execute') then raise exception 'Private evidence or promotion exposed'; end if;
end;
$test$;
rollback;
