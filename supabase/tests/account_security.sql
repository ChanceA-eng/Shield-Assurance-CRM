begin;
do $test$
declare owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid();
  request_id uuid; rejected boolean; old_email text; target text;
begin
  insert into auth.users(id,email,aud,role,raw_user_meta_data,raw_app_meta_data)
    values(owner_id,owner_id::text||'@example.invalid','authenticated','authenticated','{}','{}'),
      (admin_id,admin_id::text||'@example.invalid','authenticated','authenticated','{}','{}'),
      (agent_id,agent_id::text||'@example.invalid','authenticated','authenticated','{"role":"owner"}','{}');
  insert into agency_members(user_id,email,role) values
    (owner_id,owner_id::text||'@example.invalid','owner'),(admin_id,admin_id::text||'@example.invalid','admin'),
    (agent_id,agent_id::text||'@example.invalid','agent');
  old_email:=agent_id::text||'@example.invalid'; target:='changed-'||agent_id::text||'@example.invalid';
  rejected:=false;
  begin update auth.users set email_change=target where id=agent_id;
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Direct auth SDK pending email bypass was permitted'; end if;
  rejected:=false;
  begin update auth.users set email=target where id=agent_id;
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Direct email replacement bypass was permitted'; end if;
  request_id:=request_account_email(agent_id,target);
  if not exists(select 1 from account_email_changes where id=request_id and status='pending')
    then raise exception 'Agent self-approved request'; end if;
  rejected:=false;
  begin perform decide_account_email(admin_id,request_id,true);
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Admin approved agent change'; end if;
  perform decide_account_email(owner_id,request_id,true);
  update auth.users set email_change=target where id=agent_id;
  update account_email_changes set expires_at=now()-interval '1 second' where id=request_id;
  rejected:=false;
  begin update auth.users set email=target where id=agent_id;
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Expired approval was accepted'; end if;
  request_id:=request_account_email(agent_id,target);
  perform decide_account_email(owner_id,request_id,true);
  update agency_members set active=false where user_id=agent_id;
  rejected:=false;
  begin update auth.users set email=target where id=agent_id;
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Inactive account completed change'; end if;
  update agency_members set active=true where user_id=agent_id;
  rejected:=false;
  begin update auth.users set email=target where id=agent_id;
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Email was changed without both address proofs'; end if;
  update account_email_changes set old_token_hash='old-test-proof',new_token_hash='new-test-proof' where id=request_id;
  perform confirm_account_email('old-test-proof');
  rejected:=false;
  begin update auth.users set email=target where id=agent_id;
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Single-address confirmation was accepted'; end if;
  perform confirm_account_email('new-test-proof');
  update auth.users set email=target,email_change='' where id=agent_id;
  if not exists(select 1 from agency_members where user_id=agent_id and email=target and role='agent')
    or not exists(select 1 from account_email_changes where id=request_id and status='completed')
    then raise exception 'Verified completion did not synchronize stable member identity'; end if;
  request_id:=request_account_email(admin_id,'changed-'||admin_id::text||'@example.invalid');
  if not exists(select 1 from account_email_changes where id=request_id and status='approved' and approved_by=admin_id)
    then raise exception 'Admin could not request own verified change'; end if;
  if not reserve_account_security('test:'||request_id::text,1) or reserve_account_security('test:'||request_id::text,1)
    then raise exception 'Persistent rate limit failed'; end if;
  if has_table_privilege('authenticated','public.account_email_changes','INSERT')
    or has_function_privilege('authenticated','public.request_account_email(uuid,text)','EXECUTE') then
    raise exception 'Approval state exposed to direct client mutation'; end if;
end;
$test$;
rollback;
