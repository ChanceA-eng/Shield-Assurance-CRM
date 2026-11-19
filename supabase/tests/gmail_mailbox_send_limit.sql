begin;
do $test$
declare
  actor uuid:=gen_random_uuid();
  teammate uuid:=gen_random_uuid();
  connection uuid;
  second_connection uuid;
  attempt uuid;
  address text:='limit-'||actor||'@example.invalid';
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,address,now()),(teammate,'teammate-'||teammate||'@example.invalid',now());
  insert into agency_members(user_id,email,role,active) values(actor,address,'agent',true),(teammate,'teammate-'||teammate||'@example.invalid','agent',true);
  connection:=connect_personal_gmail(actor,address,'refresh','access',now()+interval '1 hour');
  second_connection:=connect_personal_gmail(teammate,'teammate-'||teammate||'@example.invalid','refresh','access',now()+interval '1 hour');
  for i in 1..50 loop
    attempt:=gen_random_uuid();
    insert into agent_email_attempts(id,user_id,connection_id,to_email,subject,body,content_hash,rfc_message_id,status)
    values(attempt,actor,connection,'recipient-'||i||'@example.invalid','Fixture','Fixture',attempt::text,'<'||attempt||'@example.invalid>','recorded');
    if (select count(*) from agent_email_attempts where connection_id=connection)<>i then raise exception 'Reservation % was not recorded',i; end if;
  end loop;
  begin
    attempt:=gen_random_uuid();
    insert into agent_email_attempts(id,user_id,connection_id,to_email,subject,body,content_hash,rfc_message_id)
    values(attempt,actor,connection,'overflow@example.invalid','Fixture','Fixture',attempt::text,'<'||attempt||'@example.invalid>');
    raise exception '51st message escaped the shared mailbox limit';
  exception when sqlstate 'PT429' then null;
  end;
  update agent_email_attempts set created_at=clock_timestamp()-interval '24 hours 1 second'
    where id=(select id from agent_email_attempts where connection_id=connection order by created_at limit 1);
  attempt:=gen_random_uuid();
  insert into agent_email_attempts(id,user_id,connection_id,to_email,subject,body,content_hash,rfc_message_id)
  values(attempt,actor,connection,'next-window@example.invalid','Fixture','Fixture',attempt::text,'<'||attempt||'@example.invalid>');
  attempt:=gen_random_uuid();
  insert into agent_email_attempts(id,user_id,connection_id,to_email,subject,body,content_hash,rfc_message_id)
  values(attempt,teammate,second_connection,'independent@example.invalid','Fixture','Fixture',attempt::text,'<'||attempt||'@example.invalid>');
  if has_function_privilege('authenticated','public.enforce_gmail_mailbox_send_limit()','EXECUTE') then
    raise exception 'Untrusted caller can execute the reservation trigger';
  end if;
end;
$test$;
rollback;
