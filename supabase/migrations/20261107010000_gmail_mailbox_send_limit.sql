begin;

create function public.enforce_gmail_mailbox_send_limit()
returns trigger language plpgsql security definer set search_path=public as $$
declare mailbox_email text;
begin
  select lower(trim(email)) into mailbox_email from gmail_connections where id=new.connection_id;
  if mailbox_email is null then raise exception 'Gmail connection is missing' using errcode='23503'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gmail-send-limit:'||mailbox_email,0));
  if exists(select 1 from agent_email_attempts where id=new.id) then return new; end if;
  new.created_at:=clock_timestamp();
  if (select count(*) from agent_email_attempts a join gmail_connections c on c.id=a.connection_id
    where lower(trim(c.email))=mailbox_email and a.created_at>new.created_at-interval '24 hours')>=50 then
    raise exception 'This mailbox reached its CRM limit of 50 messages in 24 hours. Schedule later or wait for the limit to reset.'
      using errcode='PT429';
  end if;
  return new;
end;
$$;

create trigger gmail_mailbox_send_limit before insert on public.agent_email_attempts
for each row execute function public.enforce_gmail_mailbox_send_limit();

create index agent_email_attempts_mailbox_window on public.agent_email_attempts(connection_id,created_at);
revoke all on function public.enforce_gmail_mailbox_send_limit() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
