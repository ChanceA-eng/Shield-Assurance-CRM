begin;

alter table public.gmail_connections
  add column if not exists sync_enabled boolean not null default true;

alter table public.gmail_oauth_states
  add column if not exists scope_mode text not null default 'shared_sync'
  check (scope_mode in ('shared_sync', 'send_only'));

create function public.connect_personal_gmail(
  p_user uuid, p_email text, p_refresh text, p_access text, p_expires timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  result uuid;
  old_email text;
  old_sync_enabled boolean;
begin
  perform pg_advisory_xact_lock(hashtext('gmail-connect'));
  if not exists(select 1 from agency_members where user_id=p_user and active) then
    raise exception 'Active membership required' using errcode='42501';
  end if;
  select email,sync_enabled into old_email,old_sync_enabled
    from gmail_connections where user_id=p_user;
  if old_email is not null and old_email<>p_email then
    raise exception 'A different mailbox cannot replace an existing mailbox; disconnect it first' using errcode='22023';
  end if;
  if old_sync_enabled is true then
    raise exception 'This mailbox already has a shared CRM sync connection. Keep its existing authorization or disconnect it before changing access.' using errcode='22023';
  end if;
  insert into gmail_connections(user_id,email,sync_enabled,sync_requested_at)
    values(p_user,p_email,false,null)
    on conflict(user_id) do update set status='connected',last_error=null,sync_enabled=false,sync_requested_at=null
    returning id into result;
  insert into gmail_tokens(connection_id,refresh_secret,access_secret,access_expires_at)
    values(result,p_refresh,p_access,p_expires) on conflict(connection_id) do update
      set refresh_secret=p_refresh,access_secret=p_access,access_expires_at=p_expires,token_lock=null,token_lease_until=null;
  insert into agency_audit(actor_id,target_id,action) values(p_user,result,'gmail_connected_send_only');
  return result;
end;
$$;

revoke all on function public.connect_personal_gmail(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.connect_personal_gmail(uuid,text,text,text,timestamptz) to service_role;

commit;
