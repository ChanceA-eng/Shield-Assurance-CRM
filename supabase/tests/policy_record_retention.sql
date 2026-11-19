begin;
do $test$
declare a uuid:=gen_random_uuid(); p uuid; result jsonb;
begin
  insert into clients(id,full_name) values(a,'Policy retention QA');
  result:=record_policy_placement_atomic(gen_random_uuid(),a,null,
    '{"insured_name":"Retention QA","carrier":"Carrier","line_of_business":"Auto","premium":100,"policy_number":"RETAIN-QA","effective_date":"2026-01-01","expiration_date":"2027-01-01","status":"issued"}',
    '{}','{"confirmed_on":"2026-01-01","reference":"QA portal","attested":true}','QA operator');
  p:=(result#>>'{policy,id}')::uuid;
  begin
    delete from policies where id=p;
    raise exception 'Policy deletion bypassed evidence retention';
  exception when check_violation then null; end;
  begin
    delete from clients where id=a;
    raise exception 'Account deletion bypassed evidence retention';
  exception when check_violation then null; end;
  if not exists(select 1 from policy_confirmation_evidence where policy_id=p) then raise exception 'Evidence was lost'; end if;
end;
$test$;
rollback;
