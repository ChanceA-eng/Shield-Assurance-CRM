begin;
do $test$
declare
  actor uuid:=gen_random_uuid();
  inactive_actor uuid:=gen_random_uuid();
  connection uuid;
  address text:='personal-gmail-'||actor||'@example.invalid';
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,address,now()),
    (inactive_actor,'inactive-gmail-'||inactive_actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role,active) values
    (actor,address,'agent',true),
    (inactive_actor,'inactive-gmail-'||inactive_actor||'@example.invalid','agent',false);
  connection:=connect_personal_gmail(actor,address,'encrypted-fixture-refresh','encrypted-fixture-access',now()+interval '1 hour');
  if not exists(select 1 from gmail_connections where id=connection and not sync_enabled
    and sync_requested_at is null and status='connected') then
    raise exception 'Send-only connection enabled sync or failed to connect';
  end if;
  if connect_personal_gmail(actor,address,'fixture-refresh-2','fixture-access-2',now())<>connection then
    raise exception 'Reconnection duplicated the mailbox';
  end if;
  if has_function_privilege('authenticated','public.connect_personal_gmail(uuid,text,text,text,timestamptz)','EXECUTE') then
    raise exception 'Untrusted caller can connect a mailbox';
  end if;
  begin
    perform connect_personal_gmail(inactive_actor,'inactive@example.invalid','fixture','fixture',now());
    raise exception 'Inactive member connected a mailbox';
  exception when insufficient_privilege then null;
  end;
  begin
    perform connect_personal_gmail(actor,'different@example.invalid','fixture','fixture',now());
    raise exception 'Existing mailbox identity was replaced';
  exception when invalid_parameter_value then null;
  end;
  update gmail_connections set sync_enabled=true where id=connection;
  begin
    perform connect_personal_gmail(actor,address,'fixture','fixture',now());
    raise exception 'Shared mailbox silently downgraded to send-only';
  exception when invalid_parameter_value then null;
  end;
end;
$test$;
rollback;
