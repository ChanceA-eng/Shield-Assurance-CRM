begin;
do $test$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid(); other_asset uuid:=gen_random_uuid();
  archived uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); result jsonb; replay jsonb; p uuid; original_snapshot jsonb;
  fields jsonb:=jsonb_build_object('insured_name','Schedule QA','carrier','QA carrier','line_of_business','Auto',
    'policy_number','SCHEDULE-QA','premium',100,'effective_date','2026-01-01','expiration_date','2027-01-01','status','issued');
begin
  insert into clients(id,full_name) values(a,'Schedule account'),(b,'Other account');
  insert into client_assets(id,client_id,title,asset_type,metadata) values
    (asset,a,'Selected vehicle','vehicle','{"details":{"year":"2025","vin":"QA-123"}}'),
    (other_asset,b,'Other account vehicle','vehicle','{"details":{"year":"2024"}}'),
    (archived,a,'Archived vehicle','vehicle','{"details":{}}');
  update client_assets set archived_at=now() where id=archived;
  begin
    perform issue_policy_with_assets_atomic(gen_random_uuid(),a,null,fields,array[other_asset]);
    raise exception 'Cross-account asset accepted';
  exception when check_violation then null; end;
  begin
    perform issue_policy_with_assets_atomic(gen_random_uuid(),a,null,fields,array[archived]);
    raise exception 'Archived asset accepted';
  exception when check_violation then null; end;
  result:=issue_policy_with_assets_atomic(req,a,null,fields,array[asset]);
  p:=(result#>>'{policy,id}')::uuid;
  if (select count(*) from policy_insured_assets where policy_id=p)<>1 then raise exception 'Selected schedule not created'; end if;
  select s.snapshot into original_snapshot from policy_insured_assets s where s.policy_id=p;
  update client_assets set title='Changed inventory',metadata='{"details":{"vin":"EDITED"}}' where id=asset;
  if (select s.snapshot from policy_insured_assets s where s.policy_id=p)<>original_snapshot
    or original_snapshot->>'title'<>'Selected vehicle' then raise exception 'Schedule snapshot changed with inventory'; end if;
  replay:=issue_policy_with_assets_atomic(req,a,null,fields,array[asset]);
  if replay->>'created'<>'false' or (replay#>>'{policy,id}')::uuid<>p then raise exception 'Safe issuance retry failed'; end if;
  begin
    perform issue_policy_with_assets_atomic(req,a,null,fields,array[]::uuid[]);
    raise exception 'Changed asset selection accepted for the same request ID';
  exception when unique_violation then null; end;
  if has_function_privilege('authenticated','public.issue_policy_with_assets_atomic(uuid,uuid,uuid,jsonb,uuid[],uuid,timestamptz)','EXECUTE') then
    raise exception 'Asset issuance RPC exposed to authenticated role'; end if;
end;
$test$;
rollback;
