begin;
do $test$
declare owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid(); test_id uuid:=gen_random_uuid(); hash text:=repeat('a',64);
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'email-owner-'||owner_id||'@example.invalid',now()),
    (agent_id,'email-agent-'||agent_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
    from auth.users where id in (owner_id,agent_id);
  begin
    perform claim_email_setup_check(agent_id,test_id,hash);
    raise exception 'An agent could claim an email test';
  exception when insufficient_privilege then null; end;
  perform claim_email_setup_check(owner_id,test_id,hash);
  perform claim_email_setup_check(owner_id,test_id,hash);
  if (select count(*) from email_setup_checks where actor_id=owner_id)<>1 then raise exception 'Retry duplicated the email test'; end if;
  if not exists(select 1 from email_setup_checks where id=test_id and verified_at is null and expected_sender='email-owner-'||owner_id||'@example.invalid') then
    raise exception 'The test was not tied to the owner or was prematurely verified';
  end if;
  begin
    perform claim_email_setup_check(owner_id,gen_random_uuid(),hash);
    raise exception 'Email test rate limit was bypassed';
  exception when invalid_parameter_value then null; end;
  begin
    perform claim_email_setup_check(owner_id,test_id,repeat('b',64));
    raise exception 'The same test accepted a different configuration';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('authenticated','public.email_setup_checks','UPDATE')
    or has_table_privilege('authenticated','public.email_setup_checks','SELECT')
    or has_function_privilege('authenticated','public.claim_email_setup_check(uuid,uuid,text)','EXECUTE') then
    raise exception 'Clients can forge reply verification or bypass the owner API';
  end if;
end;
$test$;
rollback;
