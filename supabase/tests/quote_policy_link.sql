begin;
do $test$
declare a uuid:=gen_random_uuid(); other_account uuid:=gen_random_uuid(); l uuid:=gen_random_uuid();
  q uuid:=gen_random_uuid(); op uuid:=gen_random_uuid(); v timestamptz; result jsonb; retry jsonb; fields jsonb; p uuid;
begin
  insert into clients(id,full_name) values(a,'Quote placement fixture'),(other_account,'Other quote fixture');
  insert into leads(id,full_name,account_id,status) values(l,'Placement lead',a,'quoted');
  insert into quote_options(id,client_id,lead_id,source_lead_id,carrier,line_of_business,premium,status,created_by,updated_by)
    values(q,a,l,l,'Carrier','Commercial Auto',100,'accepted','QA','QA') returning updated_at into v;
  fields:=jsonb_build_object('insured_name','Placement lead','carrier','Carrier','line_of_business','Commercial Auto','premium',110,
    'policy_number','QA-'||q::text,'effective_date','2026-11-02','expiration_date','2027-11-02');
  begin
    perform issue_quote_policy_atomic(op,other_account,null,fields,q,v);
    raise exception 'Wrong account accepted';
  exception when check_violation then null; end;
  begin
    perform issue_quote_policy_atomic(op,a,l,fields,q,v-interval '1 second');
    raise exception 'Stale quote accepted';
  exception when serialization_failure then null; end;
  result:=issue_quote_policy_atomic(op,a,l,fields,q,v);
  p:=(result->'policy'->>'id')::uuid;
  if (result->'policy'->>'quote_option_id')::uuid<>q or result->'policy'->'quote_snapshot'->>'carrier'<>'Carrier' then
    raise exception 'Policy quote provenance missing'; end if;
  if (select status from leads where id=l)<>'won' then raise exception 'Confirmed placement did not complete selected lead'; end if;
  update quote_options set carrier='Changed later',updated_at=now()+interval '1 second' where id=q;
  retry:=issue_quote_policy_atomic(op,a,l,fields,q,v);
  if retry->>'created'<>'false' or (retry->'policy'->>'id')::uuid<>p then raise exception 'Quote issuance retry duplicated'; end if;
  if (select quote_snapshot->>'carrier' from policies where id=p)<>'Carrier' then raise exception 'Later quote edit altered policy snapshot'; end if;
  begin
    perform issue_quote_policy_atomic(gen_random_uuid(),a,null,fields,q,now()+interval '1 second');
    raise exception 'Second policy from same quote accepted';
  exception when unique_violation then null; end;
  if (select count(*) from policies where client_id=a)<>1 then raise exception 'Failed second issuance left a policy'; end if;
  if has_function_privilege('authenticated','public.issue_quote_policy_atomic(uuid,uuid,uuid,jsonb,uuid,timestamptz)','EXECUTE') then
    raise exception 'Quote issuance exposed directly'; end if;
end;
$test$;
rollback;
