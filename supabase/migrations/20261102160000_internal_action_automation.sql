begin;

alter table public.tasks add column automation_key text;
alter table public.tasks add column automation_event text;
alter table public.tasks add column action_href text;
alter table public.tasks add column action_category text;
create unique index tasks_automation_key_unique on public.tasks(automation_key) where automation_key is not null;
alter table public.notifications add column automation_key text;
create unique index notifications_automation_key_unique on public.notifications(automation_key) where automation_key is not null;

-- This only manages follow-up work. It never binds coverage or sends a customer message.
create function public.sync_internal_action(
  p_key text,p_event text,p_active boolean,p_category text,p_related_type text,p_related_id uuid,
  p_account uuid,p_subject text,p_href text,p_due timestamptz,p_reply_key text default null,
  p_notify boolean default true
) returns uuid language plpgsql security definer set search_path=public as $$
declare work public.tasks%rowtype; prior public.workday_item_state%rowtype; action_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('internal-action:'||p_key,0));
  select * into work from tasks where automation_key=p_key for update;
  if work.id is null and (p_active or p_reply_key is not null) then
    select * into work from tasks where status='open'
      and (automation_key is null or (p_reply_key is not null and action_category='reply')) and (
      (p_reply_key is not null and (inbound_reply_key=p_reply_key or (subject ilike 'Reply%' and
        ((p_account is not null and (account_id=p_account or (related_type='client' and related_id=p_account)))
          or (p_account is null and related_type=p_related_type and related_id=p_related_id)))))
      or (p_reply_key is null and p_related_type in ('claim','endorsement','certificate')
        and related_type=p_related_type and related_id=p_related_id)
    ) order by created_at,id limit 1 for update;
  end if;
  if not p_active then
    if work.id is not null then
      update tasks set status='completed',automation_key=p_key,automation_event='resolved:'||p_event,
        action_href=p_href,action_category=p_category
        where id=work.id and (status='open' or automation_event is distinct from 'resolved:'||p_event);
      update notifications set read=true where task_id=work.id and not read;
    end if;
    return work.id;
  end if;
  if work.id is null then
    select * into prior from workday_item_state where work_id=p_key;
    insert into tasks(subject,description,due_date,status,priority,kind,related_type,related_id,account_id,
      automation_key,automation_event,action_href,action_category,inbound_reply_key,assignee)
    values(left(p_subject,240),'Automatically queued from the source record. Resolve the request in its linked record.',
      coalesce(prior.snoozed_until,p_due),'open',case when p_category in ('reply','delivery') then 'high' else 'medium' end,
      'task',p_related_type,p_related_id,p_account,p_key,p_event,p_href,p_category,p_reply_key,prior.assignee)
    returning id into action_id;
  else
    action_id:=work.id;
    update tasks set automation_key=p_key,automation_event=p_event,action_href=p_href,action_category=p_category,
      inbound_reply_key=coalesce(p_reply_key,inbound_reply_key),
      subject=case when work.automation_key is not null and work.automation_event is distinct from p_event then left(p_subject,240) else work.subject end,
      due_date=case when work.status='completed' and work.automation_event is distinct from p_event then greatest(work.due_date,p_due) else work.due_date end,
      status=case when work.status='completed' and work.automation_event is distinct from p_event then 'open' else work.status end
      where id=work.id and (automation_key is distinct from p_key or automation_event is distinct from p_event
        or action_href is distinct from p_href or action_category is distinct from p_category);
  end if;
  if p_notify and (work.id is null or work.status='open' or work.automation_event is distinct from p_event) then
    insert into notifications(client_id,type,message,href,read,task_id,automation_key)
      values(p_account,case when p_category='service' then coalesce(p_related_type,'message')
        when p_category in ('approval','delivery') then 'outreach' else 'message' end,
        left(p_subject,280),p_href,false,action_id,p_key||':'||p_event||
          case when work.automation_event like 'resolved:%' then ':reopened:'||work.updated_at::text else '' end)
      on conflict(automation_key) where automation_key is not null do nothing;
  end if;
  return action_id;
end;
$$;

create function public.sync_service_action(p_kind text,p_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare record_data record; active boolean; href text;
begin
  if p_kind not in ('claim','endorsement','certificate') then raise exception 'Unsupported service source'; end if;
  select * into record_data from (
    select c.id,c.client_id,c.status,c.created_at,a.full_name from claims c join clients a on a.id=c.client_id where p_kind='claim' and c.id=p_id
    union all select e.id,e.client_id,e.status,e.created_at,a.full_name from endorsements e join clients a on a.id=e.client_id where p_kind='endorsement' and e.id=p_id
    union all select c.id,c.client_id,c.status,c.created_at,a.full_name from certificates c join clients a on a.id=c.client_id where p_kind='certificate' and c.id=p_id
  ) source;
  if record_data.id is null then return null; end if;
  active:=lower(record_data.status) in ('open','pending','requested','in_progress','in progress','submitted');
  href:='/clients/'||record_data.client_id::text||'?tab=policies&context_type='||p_kind||'&context_id='||p_id::text;
  return sync_internal_action('service:'||p_kind||':'||p_id::text,p_id::text,active,'service',p_kind,p_id,
    record_data.client_id,'Review '||p_kind||': '||record_data.full_name,href,record_data.created_at);
end;
$$;

create function public.sync_outreach_action(p_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare item record; active boolean; category text;
begin
  select o.*,l.full_name,l.account_id into item from outreach_outbox o join leads l on l.id=o.lead_id where o.id=p_id;
  if item.id is null then return null; end if;
  active:=item.status in ('pending_approval','failed','acceptance_unknown','accepted_by_provider')
    or (item.status='sending' and item.sent_at<now()-interval '10 minutes');
  category:=case when item.status='pending_approval' then 'approval' else 'delivery' end;
  return sync_internal_action('outreach:'||p_id::text,item.status,active,category,'lead',item.lead_id,item.account_id,
    case when category='approval' then 'Approve outreach: ' else 'Review outreach attempt: ' end||item.full_name,
    '/outreach?attempt='||p_id::text,item.created_at);
end;
$$;

create function public.sync_reply_action(p_log_id uuid,p_notify boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare message record; label text; related_kind text; related_id uuid; href text; action_id uuid; active boolean;
begin
  select c.* into message from canonical_communications c where c.id=p_log_id;
  if message.id is null or message.channel not in ('email','sms') then return null; end if;
  -- Ignore failed/scheduled logs and late arrivals that are already answered.
  select c.* into message from canonical_communications c where c.conversation_key=message.conversation_key
    and c.channel in ('email','sms') and c.direction in ('inbound','outbound')
    and coalesce(c.metadata->>'status','') not in ('failed','pending','scheduled')
    and coalesce(c.metadata->>'delivery_status','') not in ('failed','pending','scheduled')
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
        (message.canonical_account_id is not null and t.account_id=message.canonical_account_id)
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

create or replace function public.alert_inbound_message(p_log_id uuid,p_skip_task boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare message public.communication_log%rowtype; action_id uuid; prior_task uuid; label text; href text; account uuid;
begin
  select * into message from communication_log where id=p_log_id;
  if message.id is null or message.direction<>'inbound' then raise exception 'Inbound message not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inbound-alert:'||p_log_id::text,0));
  select t.id into prior_task from tasks t join canonical_communications c on c.id=p_log_id
    where t.automation_key='message:'||c.conversation_key or (t.status='open' and (
      t.inbound_reply_key=c.conversation_key or (t.subject ilike 'Reply%' and
      ((c.canonical_account_id is not null and (t.account_id=c.canonical_account_id or (t.related_type='client' and t.related_id=c.canonical_account_id)))
        or (c.canonical_account_id is null and t.related_type='lead' and t.related_id=c.canonical_lead_id)))))
    order by t.created_at,t.id limit 1;
  if not p_skip_task then action_id:=sync_reply_action(p_log_id); end if;
  select c.canonical_account_id,coalesce(a.full_name,l.full_name,message.metadata->>'from','Unknown sender')
    into account,label from canonical_communications c left join clients a on a.id=c.canonical_account_id
      left join leads l on l.id=c.canonical_lead_id where c.id=p_log_id;
  if action_id is not null then
    select action_href into href from tasks where id=action_id;
  else
    href:='/communication';
  end if;
  insert into notifications(client_id,type,message,href,read,message_log_id,task_id)
    values(account,'message',left('New '||case when message.channel='sms' then 'text' else 'email' end||' from '||label||': '||coalesce(message.subject,message.body,''),280),href,false,p_log_id,action_id)
    on conflict(message_log_id) where message_log_id is not null do update set task_id=coalesce(excluded.task_id,notifications.task_id);
  return jsonb_build_object('taskCreated',prior_task is null and action_id is not null);
end;
$$;

create function public.internal_action_source_changed()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='outreach_outbox' then perform sync_outreach_action(coalesce(new.id,old.id));
  elsif tg_table_name='communication_log' then
    if new.direction='outbound' then perform sync_reply_action(new.id); end if;
  else perform sync_service_action(case tg_table_name when 'claims' then 'claim' when 'endorsements' then 'endorsement' else 'certificate' end,new.id);
  end if;
  return null;
end;
$$;
create trigger internal_claim_action after insert or update of status on public.claims for each row execute function public.internal_action_source_changed();
create trigger internal_endorsement_action after insert or update of status on public.endorsements for each row execute function public.internal_action_source_changed();
create trigger internal_certificate_action after insert or update of status on public.certificates for each row execute function public.internal_action_source_changed();
create trigger internal_outreach_action after insert or update of status on public.outreach_outbox for each row execute function public.internal_action_source_changed();
create trigger internal_reply_resolution after insert or update of direction,metadata on public.communication_log for each row execute function public.internal_action_source_changed();

create function public.reconcile_internal_actions()
returns jsonb language plpgsql security definer set search_path=public as $$
declare source record; amount integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('internal-action-reconciliation',0));
  for source in select 'claim' as kind,id from claims union all select 'endorsement',id from endorsements union all select 'certificate',id from certificates loop
    perform sync_service_action(source.kind,source.id); amount:=amount+1;
  end loop;
  for source in select id from outreach_outbox where status in ('pending_approval','failed','acceptance_unknown','accepted_by_provider','sending')
    or exists(select 1 from tasks where automation_key='outreach:'||outreach_outbox.id::text and status='open') loop
    perform sync_outreach_action(source.id); amount:=amount+1;
  end loop;
  for source in
    select distinct on (c.conversation_key) c.id from canonical_communications c
      where c.channel in ('email','sms') and (c.inbound_event_key is not null or
        exists(select 1 from tasks t where t.automation_key='message:'||c.conversation_key))
      order by c.conversation_key,c.sent_at desc,c.id desc
  loop
    perform sync_reply_action(source.id,true); amount:=amount+1;
  end loop;
  return jsonb_build_object('sources_checked',amount);
end;
$$;

revoke all on function public.sync_internal_action(text,text,boolean,text,text,uuid,uuid,text,text,timestamptz,text,boolean) from public,anon,authenticated;
revoke all on function public.sync_service_action(text,uuid) from public,anon,authenticated;
revoke all on function public.sync_outreach_action(uuid) from public,anon,authenticated;
revoke all on function public.sync_reply_action(uuid,boolean) from public,anon,authenticated;
revoke all on function public.internal_action_source_changed() from public,anon,authenticated;
revoke all on function public.reconcile_internal_actions() from public,anon,authenticated;
grant execute on function public.reconcile_internal_actions() to service_role;
grant execute on function public.sync_service_action(text,uuid) to service_role;
select public.reconcile_internal_actions();
notify pgrst,'reload schema';
commit;
