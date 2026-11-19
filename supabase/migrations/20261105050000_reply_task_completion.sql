begin;

create or replace function public.sync_reply_action(p_log_id uuid,p_notify boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare message record; label text; related_kind text; related_id uuid; href text; action_id uuid; active boolean;
begin
  select c.* into message from canonical_communications c where c.id=p_log_id;
  if message.id is null or message.channel not in ('email','sms') then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('internal-action:message:'||message.conversation_key,0));
  -- Only recorded successful sends can answer inbound work, across either channel.
  select c.* into message from canonical_communications c where c.conversation_key=message.conversation_key
    and c.channel in ('email','sms') and c.direction in ('inbound','outbound')
    and coalesce(c.metadata->>'historical_import','false')<>'true'
    and (c.direction='inbound' or (
      coalesce(c.metadata->>'delivery_status',c.metadata->>'status','') in ('accepted_by_provider','sent','delivered','opened')
      and coalesce(c.metadata->>'status','') not in ('failed','pending','scheduled','sending','acceptance_unknown','cancelled')
    ))
    order by c.sent_at desc,c.id desc limit 1;
  if message.id is null then return null; end if;
  if message.canonical_account_id is not null then
    select full_name into label from clients where id=message.canonical_account_id;
    related_kind:='client'; related_id:=message.canonical_account_id;
    href:='/clients/'||related_id::text||'?tab=communication';
  elsif message.canonical_lead_id is not null then
    select full_name into label from leads where id=message.canonical_lead_id;
    related_kind:='lead'; related_id:=message.canonical_lead_id;
    href:='/leads?lead='||related_id::text||'&tab=conversation';
  else
    label:=coalesce(message.metadata->>'from','Unknown sender');
    related_kind:='conversation'; related_id:=message.id;
    href:='/communication?conversation='||message.conversation_key;
  end if;
  active:=message.direction='inbound' and not (coalesce(message.body,'') ~* '(\munsubscribe\M|\mopt[ -]?out\M|^[[:space:]]*stop[[:space:]]*$|\mstop[[:space:]]+(sending|emailing|texting)\M|remove me)');
  action_id:=sync_internal_action('message:'||message.conversation_key,message.id::text,active,'reply',
    related_kind,related_id,message.canonical_account_id,'Reply to '||label,href,
    message.sent_at+interval '2 hours',message.conversation_key,false);
  if action_id is not null then
    update tasks t set status='completed',description=coalesce(t.description,'')||E'\nConsolidated into the canonical conversation follow-up.'
      where t.id<>action_id and t.status='open' and t.action_category='reply' and (
        (message.canonical_account_id is not null and (t.account_id=message.canonical_account_id
          or (t.related_type='client' and t.related_id=message.canonical_account_id)
          or (t.related_type='lead' and exists(select 1 from leads l where l.id=t.related_id and l.account_id=message.canonical_account_id))))
        or (message.canonical_account_id is null and t.related_type='lead' and t.related_id=message.canonical_lead_id));
  end if;
  if p_notify and active and exists(select 1 from tasks where id=action_id and status='open') then
    insert into notifications(client_id,type,message,href,read,message_log_id,task_id)
      values(message.canonical_account_id,'message','Reply to '||label,href,false,message.id,action_id)
      on conflict(message_log_id) where message_log_id is not null do update set task_id=excluded.task_id;
  end if;
  return action_id;
end;
$$;

revoke all on function public.sync_reply_action(uuid,boolean) from public,anon,authenticated;
grant execute on function public.sync_reply_action(uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
