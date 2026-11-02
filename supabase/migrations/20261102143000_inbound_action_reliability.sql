begin;
alter table public.notifications add column if not exists message_log_id uuid references public.communication_log(id) on delete set null;
create unique index if not exists notifications_message_log_unique on public.notifications(message_log_id) where message_log_id is not null;
alter table public.tasks add column if not exists inbound_reply_key text;
create unique index if not exists tasks_inbound_reply_open_unique on public.tasks(inbound_reply_key) where inbound_reply_key is not null and status='open';

create or replace function public.alert_inbound_message(p_log_id uuid,p_skip_task boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  message public.communication_log%rowtype;
  account uuid;
  lead uuid;
  label text;
  key text;
  href text;
  existing uuid;
  created boolean:=false;
  notified integer;
begin
  select * into message from communication_log where id=p_log_id;
  if message.id is null or message.direction<>'inbound' then raise exception 'Inbound message not found' using errcode='P0002'; end if;
  account:=message.client_id;
  lead:=nullif(message.metadata->>'lead_id','')::uuid;
  if lead is not null then select coalesce(account,account_id),full_name into account,label from leads where id=lead; end if;
  if account is not null then select full_name into label from clients where id=account; end if;
  label:=coalesce(label,message.metadata->>'from','Unknown sender');
  key:=coalesce('client:'||account::text,'lead:'||lead::text,
    'unmatched:'||coalesce(nullif(public.crm_normalize_address(message.metadata->>'from'),''),'unknown'));
  href:=case when account is not null then '/clients/'||account::text||'?tab=communication'
    when lead is not null then '/leads?lead='||lead::text||'&tab=conversation' else '/communication' end;
  perform pg_advisory_xact_lock(hashtextextended(key,0));
  insert into notifications(client_id,type,message,href,read,message_log_id)
    values(account,'message','New '||case when message.channel='sms' then 'text' else 'email' end||' from '||label||': '||
      left(coalesce(message.subject,message.body,''),90),href,false,p_log_id)
    on conflict(message_log_id) where message_log_id is not null do nothing;
  get diagnostics notified = row_count;
  if notified=0 then return jsonb_build_object('taskCreated',false); end if;
  if not p_skip_task and (account is not null or lead is not null) then
    select id into existing from tasks where status='open' and (
      inbound_reply_key=key or (subject ilike 'Reply%' and
        ((account is not null and ((related_type='client' and related_id=account) or account_id=account))
          or (lead is not null and related_type='lead' and related_id=lead))))
      order by created_at,id limit 1 for update;
    if existing is null then
      insert into tasks(subject,description,due_date,status,priority,kind,related_type,related_id,account_id,inbound_reply_key)
      values('Reply to '||label||case when message.channel='sms' then '''s text message' else '''s email' end,
        left(coalesce(message.body,''),280),message.sent_at+interval '2 hours','open','high','task',
        case when account is not null then 'client' else 'lead' end,coalesce(account,lead),account,key);
      created:=true;
    else
      update tasks set inbound_reply_key=key where id=existing;
    end if;
  end if;
  return jsonb_build_object('taskCreated',created);
end;
$$;
revoke all on function public.alert_inbound_message(uuid,boolean) from public,anon,authenticated;
grant execute on function public.alert_inbound_message(uuid,boolean) to service_role;
commit;
