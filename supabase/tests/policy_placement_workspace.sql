begin;
do $test$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid();
  other_doc uuid:=gen_random_uuid(); quote uuid:=gen_random_uuid(); result jsonb; replay jsonb; p uuid; replacement uuid;
  fields jsonb:='{"insured_name":"Placement QA","carrier":"Carrier","line_of_business":"Auto","policy_number":"PLACEMENT-QA","premium":100,"effective_date":"2026-01-01","expiration_date":"2027-01-01","status":"issued"}';
  evidence jsonb:=jsonb_build_object('confirmed_on','2026-01-01','reference','Carrier portal ABC','attested',true);
begin
  insert into clients(id,full_name) values(a,'Placement QA account'),(b,'Other QA account');
  insert into client_files(id,client_id,file_name,status,metadata) values
    (doc,a,'Carrier.pdf','stored',jsonb_build_object('source_kind','stored','storage',jsonb_build_object('path','clients/'||a||'/carrier.pdf'))),
    (other_doc,b,'Other.pdf','stored',jsonb_build_object('source_kind','stored','storage',jsonb_build_object('path','clients/'||b||'/other.pdf')));
  begin
    perform record_policy_placement_atomic(req,a,null,fields,'{}',evidence-'reference','QA operator');
    raise exception 'Missing carrier reference accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform record_policy_placement_atomic(req,a,null,fields,'{}',evidence||jsonb_build_object('file_id',other_doc),'QA operator');
    raise exception 'Cross-account evidence accepted';
  exception when check_violation then null; end;
  result:=record_policy_placement_atomic(req,a,null,fields,'{}',evidence||jsonb_build_object('file_id',doc),'QA operator');
  p:=(result#>>'{policy,id}')::uuid;
  if (select count(*) from policy_confirmation_evidence where policy_id=p)<>1 then raise exception 'Evidence missing'; end if;
  if (select count(*) from placement_documents where policy_id=p)<>1 then raise exception 'Document link missing'; end if;
  if (select count(*) from policy_term_history where policy_id=p and recorded_by='QA operator')<>1 then raise exception 'Actor history missing'; end if;
  replay:=record_policy_placement_atomic(req,a,null,fields,'{}',evidence||jsonb_build_object('file_id',doc),'Another operator');
  if replay#>>'{policy,id}'<>p::text or replay->>'created'<>'false' then raise exception 'Retry not idempotent'; end if;
  if (select recorded_by from policy_confirmation_evidence where policy_id=p)<>'QA operator' then raise exception 'Retry changed actor'; end if;
  update client_files set file_name='Renamed.pdf' where id=doc;
  if (select file_snapshot->>'file_name' from placement_documents where policy_id=p)<>'Carrier.pdf' then raise exception 'Evidence filename not retained'; end if;
  begin
    perform record_policy_placement_atomic(gen_random_uuid(),a,null,fields||'{"source":"Rewrite"}','{}',evidence,'QA');
    raise exception 'Rewrite without predecessor accepted';
  exception when check_violation then null; end;
  result:=record_policy_placement_atomic(gen_random_uuid(),a,null,
    fields||jsonb_build_object('source','Rewrite','prior_policy_id',p,'policy_number','REPLACEMENT-QA'),'{}',evidence,'QA rewrite operator');
  replacement:=(result#>>'{policy,id}')::uuid;
  if (select prior_policy_id from policies where id=replacement)<>p then raise exception 'Rewrite lineage missing'; end if;
  if (select status from policies where id=p)<>'issued' then raise exception 'Rewrite changed original term'; end if;
  begin
    perform update_policy_record_atomic(replacement,jsonb_build_object('prior_policy_id',replacement),'QA');
    raise exception 'Self-reference accepted';
  exception when check_violation then null; end;
  begin
    perform record_policy_placement_atomic(gen_random_uuid(),b,null,
      fields||jsonb_build_object('source','Renewal','prior_policy_id',p),'{}',evidence,'QA');
    raise exception 'Cross-account previous term accepted';
  exception when check_violation then null; end;
  begin
    perform record_policy_placement_atomic(req,a,null,fields,'{}',evidence||'{"reference":"Changed"}','QA operator');
    raise exception 'Different retry evidence accepted';
  exception when unique_violation then null; end;
  begin
    perform claim_document_deletion(a,doc);
    raise exception 'Linked evidence document deletion accepted';
  exception when check_violation then null; end;
  perform update_policy_record_atomic(p,'{"premium":150}','QA edit operator');
  if (select count(*) from policy_term_history where policy_id=p)<>2 then raise exception 'Policy edit history missing'; end if;
  if (select (snapshot->>'premium')::numeric from policy_term_history where policy_id=p order by id desc limit 1)<>150 then raise exception 'Updated history snapshot missing'; end if;
  begin
    perform update_policy_record_atomic(p,jsonb_build_object('account_id',b,'client_id',b),'QA edit operator');
    raise exception 'Placement account reassigned';
  exception when check_violation then null; end;
  insert into quote_options(id,client_id,carrier,line_of_business,premium,created_by,updated_by)
    values(quote,a,'Carrier','Auto',150,'QA','QA');
  perform attach_placement_document(a,null,quote,doc,'QA');
  perform attach_placement_document(a,null,quote,doc,'QA');
  if (select count(*) from placement_documents where quote_id=quote)<>1 then raise exception 'Duplicate quote document'; end if;
  begin
    perform attach_placement_document(b,null,quote,other_doc,'QA');
    raise exception 'Cross-account quote link accepted';
  exception when no_data_found then null; end;
  perform claim_document_deletion(b,other_doc);
  begin
    perform record_policy_placement_atomic(gen_random_uuid(),b,null,fields,'{}',evidence||jsonb_build_object('file_id',other_doc),'QA');
    raise exception 'Deletion-pending file accepted';
  exception when check_violation then null; end;
  if has_function_privilege('authenticated','public.record_policy_placement_atomic(uuid,uuid,uuid,jsonb,uuid[],jsonb,text,uuid,timestamptz)','EXECUTE') then
    raise exception 'Placement function exposed'; end if;
end;
$test$;
rollback;
