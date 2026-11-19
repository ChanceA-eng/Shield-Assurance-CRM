begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  source jsonb; result jsonb; target_batch uuid; candidate_id uuid; expected jsonb; stamp timestamptz;
  request_id uuid:=gen_random_uuid(); target_lead uuid;
  prospects jsonb:='[{"full_name":"Discovery synthetic","email":"discovery-test@example.invalid","address":"1 Synthetic St, Tucson, AZ, 85701","disposition":"pending","payload":{"profile":{"kind":"commercial","company":{"industry":"Transport","employees":"12"},"renewals":[{"type":"General Liability","date":"2027-04-01","evidence_class":"predicted","precision":"month"}]}}},{"full_name":"Research only synthetic","disposition":"pending","payload":{"profile":{"kind":"commercial"}}}]';
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'discovery-owner-'||owner_id||'@example.invalid',now()),
    (agent_id,'discovery-agent-'||agent_id||'@example.invalid',now()),
    (other_id,'discovery-other-'||other_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
    from auth.users where id in (owner_id,agent_id,other_id);
  begin
    perform save_discovery_source(agent_id,'{}');
    raise exception 'Agent approved a source';
  exception when insufficient_privilege then null; end;
  begin
    perform save_discovery_source(owner_id,jsonb_build_object('name','Synthetic','permission_reference','Test fixture',
      'acquisition_until',current_date+1,'retained_crm_rights',false));
    raise exception 'Unapproved retained rights accepted';
  exception when invalid_parameter_value then null; end;
  source:=save_discovery_source(owner_id,jsonb_build_object('name','Synthetic approved source','permission_reference','Synthetic retained-use test approval',
    'acquisition_until',current_date+1,'retained_crm_rights',true));
  result:=acquire_discovery_file(agent_id,(source->>'id')::uuid,request_id,repeat('a',64),'Synthetic.csv','commercial',2,prospects);
  target_batch:=(result->>'batch_id')::uuid;
  result:=acquire_discovery_file(agent_id,(source->>'id')::uuid,request_id,repeat('a',64),'Synthetic.csv','commercial',2,prospects);
  if result->>'already_acquired'<>'true' or (select count(*) from import_prospects where batch_id=target_batch)=0 then
    raise exception 'Upload retry did not reconcile'; end if;
  if (select count(*) from import_prospects p where p.batch_id=target_batch)<>2 then raise exception 'Upload replay duplicated candidates'; end if;
  begin
    perform acquire_discovery_file(agent_id,(source->>'id')::uuid,request_id,repeat('b',64),'Other.csv','commercial',2,prospects);
    raise exception 'Request identity accepted different file';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform acquire_discovery_file(agent_id,(source->>'id')::uuid,gen_random_uuid(),repeat('c',64),'Broken.csv','commercial',3,
      prospects||'[{"full_name":"","disposition":"pending","payload":{}}]');
    raise exception 'Malformed partial acquisition accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from import_batches where file_name='Broken.csv') then raise exception 'Partial staging escaped transaction'; end if;
  begin
    perform search_discovery_candidates(null,'{}',0);
    raise exception 'Missing actor queried discovery';
  exception when insufficient_privilege then null; end;
  result:=search_discovery_candidates(agent_id,jsonb_build_object('industry','transport','state','AZ','employees_min',10,'renewal_from','2027-04','renewal_to','2027-04'),0);
  if (result->>'total')::integer<>1 or result #>> '{candidates,0,profile,renewals,0,evidence_class}'<>'predicted' then
    raise exception 'Targeting or prediction evidence missing'; end if;
  select id,discovery_updated_at into candidate_id,stamp from import_prospects p where p.batch_id=target_batch and full_name='Discovery synthetic';
  select jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'address',address,
    'line_of_business',line_of_business,'payload',payload) into expected from import_prospects where id=candidate_id;
  begin
    perform promote_import_prospect(candidate_id,target_batch,agent_id,expected,prospects->0->'payload'->'profile','[]');
    raise exception 'Unreviewed candidate promoted';
  exception when sqlstate 'PT409' then null; end;
  perform review_discovery_candidate(agent_id,candidate_id,stamp,'reviewed','Synthetic verification');
  begin
    perform review_discovery_candidate(agent_id,candidate_id,stamp,'dismissed','Stale');
    raise exception 'Stale review accepted';
  exception when sqlstate 'PT409' then null; end;
  update import_prospects set phone='+15205550111' where id=candidate_id;
  if (select discovery_review from import_prospects where id=candidate_id)<>'needs_verification' then raise exception 'Identity edit retained reviewed approval'; end if;
  select discovery_updated_at into stamp from import_prospects where id=candidate_id;
  perform review_discovery_candidate(agent_id,candidate_id,stamp,'reviewed','Synthetic final verification');
  source:=save_discovery_source(owner_id,'{"active":false}',(source->>'id')::uuid,(source->>'updated_at')::timestamptz);
  begin
    perform promote_import_prospect(candidate_id,target_batch,agent_id,expected,prospects->0->'payload'->'profile','[]');
    raise exception 'Paused source promoted';
  exception when insufficient_privilege then null; end;
  source:=save_discovery_source(owner_id,'{"active":true}',(source->>'id')::uuid,(source->>'updated_at')::timestamptz);
  select jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'address',address,
    'line_of_business',line_of_business,'payload',payload) into expected from import_prospects where id=candidate_id;
  result:=promote_import_prospect(candidate_id,target_batch,agent_id,expected,prospects->0->'payload'->'profile','[]');
  if result->>'disposition'<>'committed' then raise exception 'Reviewed candidate not promoted'; end if;
  target_lead:=(result->>'lead_id')::uuid;
  if not exists(select 1 from leads l where l.id=target_lead and l.form_payload #>> '{import,retained_crm_rights}'='true') then
    raise exception 'Promotion lost source approval provenance'; end if;
  result:=promote_import_prospect(candidate_id,target_batch,agent_id,expected,'{}','[]');
  if result->>'disposition'<>'already_committed' then raise exception 'Promotion retry duplicated work'; end if;
  update discovery_sources set acquisition_until=current_date-1 where id=(source->>'id')::uuid;
  begin
    perform acquire_discovery_file(agent_id,(source->>'id')::uuid,gen_random_uuid(),repeat('d',64),'Expired.csv','commercial',2,prospects);
    raise exception 'Expired source acquired a file';
  exception when insufficient_privilege then null; end;
  insert into import_prospects(batch_id,full_name,payload)
    select target_batch,'Pagination synthetic '||i,'{"profile":{}}' from generate_series(1,51) i;
  result:=search_discovery_candidates(agent_id,'{"query":"Pagination synthetic"}',1);
  if (result->>'total')::integer<>51 or jsonb_array_length(result->'candidates')<>1 then raise exception 'Search pagination count is wrong'; end if;
  if exists(select 1 from sequence_enrollments where lead_id=target_lead) or exists(select 1 from outreach_outbox where lead_id=target_lead) then
    raise exception 'Discovery started outreach'; end if;
  if has_table_privilege('authenticated','discovery_sources','SELECT')
    or has_table_privilege('authenticated','discovery_saved_searches','SELECT')
    or has_function_privilege('authenticated','review_discovery_candidate(uuid,uuid,timestamptz,text,text)','EXECUTE')
    or has_function_privilege('service_role','promote_import_prospect_core(uuid,uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE') then
    raise exception 'Direct access bypasses discovery guards'; end if;
end;
$test$;
rollback;
