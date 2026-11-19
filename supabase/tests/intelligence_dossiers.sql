begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  target_lead uuid:=gen_random_uuid(); target_client uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
  private_lead uuid:=gen_random_uuid();
  result jsonb; findings jsonb:='{"decision_maker":"Synthetic CFO; authority confirmed","renewal_line":"General Liability","renewal_date":"2027-04-22"}';
  key text;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'dossier-owner-'||owner_id||'@example.invalid',now()),
    (agent_id,'dossier-agent-'||agent_id||'@example.invalid',now()),
    (other_id,'dossier-other-'||other_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
    from auth.users where id in (owner_id,agent_id,other_id);
  insert into clients(id,full_name,agent_user_id) values(target_client,'Synthetic dossier account',agent_id);
  insert into leads(id,full_name,source,status,agent_user_id) values(target_lead,'Synthetic dossier lead','intelligence_sql_qa','new',agent_id);
  key:='lead:'||target_lead;
  result:=get_intelligence_dossier(agent_id,'lead',target_lead);
  if result->>'version'<>'0' then raise exception 'New dossier has false findings'; end if;
  begin
    perform get_intelligence_dossier(other_id,'lead',target_lead);
    raise exception 'Unassigned agent read private dossier';
  exception when insufficient_privilege then null; end;
  begin
    perform save_intelligence_dossier(other_id,'lead',target_lead,key,0,request_id,findings,'Synthetic call',current_date);
    raise exception 'Unassigned agent wrote private dossier';
  exception when insufficient_privilege then null; end;
  result:=save_intelligence_dossier(agent_id,'lead',target_lead,key,0,request_id,findings,'Synthetic call; explicit confirmation',current_date);
  if result->>'version'<>'1' then raise exception 'Findings were not versioned'; end if;
  result:=save_intelligence_dossier(agent_id,'lead',target_lead,key,0,request_id,findings,'Synthetic call; explicit confirmation',current_date);
  if result->>'already_saved'<>'true' then raise exception 'Retry did not reconcile'; end if;
  if (select count(*) from intelligence_dossier_confirmations where scope_key=key)<>1 then raise exception 'Retry duplicated history'; end if;
  begin
    perform save_intelligence_dossier(agent_id,'lead',target_lead,key,0,gen_random_uuid(),'{}','Stale',current_date);
    raise exception 'Stale findings accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform save_intelligence_dossier(agent_id,'lead',target_lead,key,1,request_id,'{}','Different',current_date);
    raise exception 'Retry changed content';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform save_intelligence_dossier(agent_id,'lead',target_lead,key,1,gen_random_uuid(),'{"renewal_line":"GL","renewal_date":"2027-02-30"}','Impossible date',current_date);
    raise exception 'Impossible renewal accepted';
  exception when datetime_field_overflow or invalid_parameter_value then null; end;
  result:=save_intelligence_dossier(agent_id,'lead',target_lead,key,1,gen_random_uuid(),'{}','Retracted after review',current_date);
  if (get_intelligence_dossier(agent_id,'lead',target_lead)->'findings')<>'{}'::jsonb then raise exception 'Retraction did not clear current findings'; end if;
  insert into intelligence_enrichment_observations(lead_id,source,actor_id,match_method,snapshot)
    values(target_lead,'fmcsa',agent_id,'agent_selected_dot','{"dot_number":"123","power_units":12,"mcs150_date":"2026-10-01"}');
  update leads set account_id=target_client where id=target_lead;
  result:=get_intelligence_dossier(agent_id,'lead',target_lead);
  if result->>'scope_key'<>'client:'||target_client or jsonb_array_length(result->'confirmations')<>2
    or jsonb_array_length(result->'observations')<>1 then raise exception 'Linking lost canonical scope or history'; end if;
  begin
    perform save_intelligence_dossier(agent_id,'lead',target_lead,key,2,gen_random_uuid(),'{}','Stale scope',current_date);
    raise exception 'Stale account linkage accepted';
  exception when sqlstate 'PT409' then null; end;
  result:=save_intelligence_dossier(agent_id,'client',target_client,'client:'||target_client,0,gen_random_uuid(),findings,'Canonical account verification',current_date);
  if get_intelligence_dossier(agent_id,'lead',target_lead)->>'version'<>'1' then raise exception 'Lead and account dossiers diverged'; end if;
  insert into leads(id,full_name,source,status,agent_user_id)
    values(private_lead,'Other agent dossier lead','intelligence_sql_qa','new',other_id);
  perform save_intelligence_dossier(other_id,'lead',private_lead,'lead:'||private_lead,0,gen_random_uuid(),
    '{"decision_maker":"Other agent private finding"}','Other agent reference',current_date);
  insert into intelligence_enrichment_observations(lead_id,source,actor_id,match_method,snapshot)
    values(private_lead,'fmcsa',other_id,'agent_selected_dot','{"dot_number":"456","power_units":5}');
  update leads set account_id=target_client where id=private_lead;
  result:=get_intelligence_dossier(agent_id,'client',target_client);
  if (result->>'observations_total')::integer<>1 or (result->>'history_total')::integer<>3
    or result::text like '%Other agent private finding%' then raise exception 'Linked account leaked other assigned lead evidence'; end if;
  result:=get_intelligence_dossier(owner_id,'client',target_client);
  if (result->>'observations_total')::integer<>2 or (result->>'history_total')::integer<>4
    then raise exception 'Owner could not review authorized linked evidence'; end if;
  insert into intelligence_enrichment_observations(lead_id,source,actor_id,match_method,snapshot,observed_at)
    select target_lead,'fmcsa',agent_id,'agent_selected_dot','{"dot_number":"123","power_units":12}'::jsonb,
      now()-make_interval(mins=>series) from generate_series(1,30) series;
  result:=get_intelligence_dossier(agent_id,'client',target_client,0);
  if (result->>'observations_total')::integer<>31 or jsonb_array_length(result->'observations')<>25
    then raise exception 'First history page count is incorrect'; end if;
  result:=get_intelligence_dossier(agent_id,'client',target_client,1);
  if jsonb_array_length(result->'observations')<>6 or jsonb_array_length(result->'confirmations')<>0
    or result->'current_confirmation'->>'reference'<>'Canonical account verification'
    then raise exception 'Paging lost current confirmation or source history'; end if;
  update clients set agent_user_id=other_id where id=target_client;
  begin
    perform get_intelligence_dossier(agent_id,'lead',target_lead);
    raise exception 'Account reassignment did not revoke dossier access';
  exception when insufficient_privilege then null; end;
  if get_intelligence_dossier(owner_id,'client',target_client)->>'version'<>'1' then raise exception 'Owner could not review assigned dossier'; end if;
  if has_table_privilege('authenticated','intelligence_dossiers','SELECT')
    or has_table_privilege('service_role','intelligence_dossier_confirmations','UPDATE')
    or has_function_privilege('authenticated','get_intelligence_dossier(uuid,text,uuid,integer)','EXECUTE') then
    raise exception 'Private or append-only dossier guards bypassed'; end if;
  if exists(select 1 from sequence_enrollments where sequence_enrollments.lead_id=target_lead)
    or exists(select 1 from outreach_outbox where outreach_outbox.lead_id=target_lead) then raise exception 'Dossier initiated outreach'; end if;
end;
$test$;
rollback;
