begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid();
  source jsonb; legacy jsonb; acquired jsonb; result jsonb; stamp timestamptz;
  candidate_id uuid; expected jsonb; profile jsonb; request_id uuid:=gen_random_uuid(); target_lead uuid;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'public-owner-'||owner_id||'@example.invalid',now()),
    (agent_id,'public-agent-'||agent_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
    from auth.users where id in (owner_id,agent_id);
  source:=save_discovery_source(owner_id,jsonb_build_object('provider','fmcsa','name','Synthetic FMCSA approval',
    'permission_reference','Synthetic business-only public-record fixture; retained-use rights reviewed',
    'retained_crm_rights',true,'acquisition_until',current_date+1));
  if source->>'provider'<>'fmcsa' then raise exception 'Public source type was not persisted'; end if;
  legacy:=save_discovery_source(owner_id,jsonb_build_object('name','Synthetic legacy file approval',
    'permission_reference','Synthetic retained-use file fixture','retained_crm_rights',true,'acquisition_until',current_date+1));
  if legacy->>'provider'<>'file' then raise exception 'Legacy file approval changed'; end if;
  begin
    perform save_discovery_source(owner_id,'{"provider":"file","active":false}',(source->>'id')::uuid,(source->>'updated_at')::timestamptz);
    raise exception 'Existing provider approval was rewritten';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_discovery_source(agent_id,jsonb_build_object('provider','fmcsa','name','Unauthorized','permission_reference','Fixture',
      'retained_crm_rights',true,'acquisition_until',current_date+1));
    raise exception 'Agent approved a public source';
  exception when insufficient_privilege then null; end;
  source:=save_discovery_source(owner_id,'{"active":false}',(source->>'id')::uuid,(source->>'updated_at')::timestamptz);
  source:=save_discovery_source(owner_id,'{"active":true}',(source->>'id')::uuid,(source->>'updated_at')::timestamptz);
  if source->>'provider'<>'fmcsa' then raise exception 'Pause/resume changed provider'; end if;
  profile:='{"kind":"commercial","company":{"industry":"DOT-registered motor carrier"},"dot":{"number":"999999991"},"public_source":{"provider":"fmcsa","record_id":"999999991","evidence_class":"public_record","registration_reported_on":null},"enrichment":{"fmcsa":{"power_units":12}}}';
  acquired:=acquire_discovery_file(agent_id,(source->>'id')::uuid,request_id,repeat('e',64),'FMCSA DOT 999999991','commercial',1,
    jsonb_build_array(jsonb_build_object('full_name','Synthetic public acquisition','phone','520-555-0191',
      'disposition','pending','payload',jsonb_build_object('profile',profile,'raw','[]'::jsonb))));
  select id,discovery_updated_at,jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'address',address,
    'line_of_business',line_of_business,'payload',payload) into candidate_id,stamp,expected
    from import_prospects where batch_id=(acquired->>'batch_id')::uuid;
  begin
    perform promote_import_prospect(candidate_id,(acquired->>'batch_id')::uuid,agent_id,expected,profile,'[]');
    raise exception 'Unreviewed public record was promoted';
  exception when sqlstate 'PT409' then null; end;
  perform review_discovery_candidate(agent_id,candidate_id,stamp,'reviewed','Synthetic business identity checked; contact remains unverified');
  result:=promote_import_prospect(candidate_id,(acquired->>'batch_id')::uuid,agent_id,expected,profile,'[]');
  target_lead:=(result->>'lead_id')::uuid;
  if not exists(select 1 from leads where id=target_lead and form_payload #>> '{profile,public_source,evidence_class}'='public_record'
    and form_payload #>> '{profile,dot,number}'='999999991') then raise exception 'Public provenance lost during promotion'; end if;
  if exists(select 1 from sequence_enrollments where lead_id=target_lead) or exists(select 1 from outreach_outbox where lead_id=target_lead) then
    raise exception 'Public acquisition started outreach'; end if;
  if has_function_privilege('service_role','save_discovery_source_core(uuid,jsonb,uuid,timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','save_discovery_source(uuid,jsonb,uuid,timestamptz)','EXECUTE') then
    raise exception 'Source approval guards can be bypassed'; end if;
end;
$test$;
rollback;
