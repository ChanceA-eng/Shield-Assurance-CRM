begin;

create or replace function public.default_automation_configuration()
returns jsonb language sql immutable set search_path=public as $$
select $defaults${
  "schema_version":1,
  "intake":{"enabled":true,"warm_priority":"high","cold_priority":"medium","due_hour":16,"cold_next_business_day":true},
  "follow_up":{"enabled":true,"statuses":["new","contacted","quoted"],"due_hour":9,"priority":"medium"},
  "reply":{"enabled":true,"due_minutes":120,"complete_on_successful_send":true},
  "renewal":{"enabled":true,"window_days":45,"grace_days":7,"milestones":[45,30,15,7,0],"task_days_before":30,"urgent_days_before":15},
  "sequence":{"total_steps":3,"step_gap_days":5,"auto_enroll_imports":false,"auto_enroll_website":false},
  "import_renewal":{"tasks_enabled":true,"task_days_before":60},
  "reminders":{"enabled":true},
  "notifications":{"service_events":true,"renewals":true,"message_replies":true},
  "service":{"tasks_enabled":true,"acknowledgment_email_enabled":true,"task_templates":{
    "claim":{"subject":"Review {service_type}: {account_name}","description":"Automatically queued from the source record. Resolve the request in its linked record."},
    "endorsement":{"subject":"Review {service_type}: {account_name}","description":"Automatically queued from the source record. Resolve the request in its linked record."},
    "certificate":{"subject":"Review {service_type}: {account_name}","description":"Automatically queued from the source record. Resolve the request in its linked record."}
  }}
}$defaults$::jsonb;
$$;

do $patch$
declare validation text:=pg_get_functiondef('public.validate_automation_configuration(jsonb)'::regprocedure);
begin
  if strpos(validation,'{import_renewal,task_days_before}')=0 or strpos(validation,'  return true;')=0 then
    raise exception 'Installed automation validator changed; inspect service template upgrade';
  end if;
  validation:=replace(validation,'  return true;',
    '  for k in select unnest(array[''claim'',''endorsement'',''certificate'']) loop
    v:=p_value#>array[''service'',''task_templates'',k];
    if jsonb_typeof(v) is distinct from ''object''
      or (select count(*) from jsonb_object_keys(v))<>2
      or not (v?''subject'' and v?''description'')
      or jsonb_typeof(v->''subject'') is distinct from ''string''
      or jsonb_typeof(v->''description'') is distinct from ''string''
      or length(btrim(v->>''subject'')) not between 1 and 240
      or length(btrim(v->>''description'')) not between 1 and 2000
      or strpos(v->>''subject'',''{service_type}'')=0
      or strpos(v->>''subject'',''{account_name}'')=0
      or regexp_replace(v->>''subject'',''\{(service_type|account_name)\}'','''',''g'') ~ ''[{}]''
      or regexp_replace(v->>''description'',''\{(service_type|account_name)\}'','''',''g'') ~ ''[{}]'' then
      raise exception ''Invalid service task template'' using errcode=''22023'';
    end if;
  end loop;
  return true;');
  execute validation;
end;
$patch$;

update public.outreach_settings
  set automation_configuration=jsonb_set(
    jsonb_set(automation_configuration,'{service,task_templates}',
      public.default_automation_configuration()#>'{service,task_templates}'),
    '{notifications}',public.default_automation_configuration()->'notifications')
  where id=1 and ((automation_configuration#>'{service,task_templates}') is null
    or not (automation_configuration?'notifications'));
update public.automation_configuration_versions
  set configuration=jsonb_set(
    jsonb_set(configuration,'{automation,service,task_templates}',
      public.default_automation_configuration()#>'{service,task_templates}'),
    '{automation,notifications}',public.default_automation_configuration()->'notifications')
  where configuration#>'{automation,service,task_templates}' is null
    or configuration#>'{automation,notifications}' is null;

create table public.automation_notification_activation (
  category text primary key check(category in ('service_events','renewals','message_replies')),
  active_since timestamptz not null default '-infinity'
);
insert into public.automation_notification_activation(category)
values('service_events'),('renewals'),('message_replies');
alter table public.automation_notification_activation enable row level security;
revoke all on public.automation_notification_activation from public,anon,authenticated,service_role;

create function public.automation_notification_allows(p_category text,p_event_at timestamptz default clock_timestamp())
returns boolean language plpgsql stable security definer set search_path=public as $$
declare policy jsonb; started timestamptz;
begin
  if p_event_at is null then return false; end if;
  if p_category not in ('service_events','renewals','message_replies') then
    raise exception 'Unsupported automation notification category' using errcode='22023';
  end if;
  policy:=automation_rule_policy('notifications');
  select active_since into started from automation_notification_activation where category=p_category;
  if started is null then raise exception 'Notification activation is not initialized' using errcode='P0002'; end if;
  return coalesce((policy->>p_category)::boolean,false) and p_event_at>=started;
end;
$$;
revoke all on function public.automation_notification_allows(text,timestamptz) from public,anon,authenticated;
grant execute on function public.automation_notification_allows(text,timestamptz) to service_role;

create function public.capture_automation_notification_activation()
returns trigger language plpgsql security definer set search_path=public as $$
declare category_key text;
begin
  foreach category_key in array array['service_events','renewals','message_replies'] loop
    if (new.automation_configuration->'notifications'->>category_key)::boolean
      and not (old.automation_configuration->'notifications'->>category_key)::boolean then
      update automation_notification_activation set active_since=clock_timestamp() where category=category_key;
    end if;
  end loop;
  return null;
end;
$$;
create trigger capture_automation_notification_activation after update of automation_configuration on public.outreach_settings
  for each row execute function public.capture_automation_notification_activation();
revoke all on function public.capture_automation_notification_activation() from public,anon,authenticated;

do $patch$
declare definition text; old text; replacement text;
begin
  definition:=pg_get_functiondef('public.sync_internal_action(text,text,boolean,text,text,uuid,uuid,text,text,timestamp with time zone,text,boolean)'::regprocedure);
  old:='declare work public.tasks%rowtype; prior public.workday_item_state%rowtype; action_id uuid;';
  replacement:='declare work public.tasks%rowtype; prior public.workday_item_state%rowtype; action_id uuid; service_template jsonb; service_name text;';
  if strpos(definition,old)=0 then raise exception 'Internal action declaration changed'; end if;
  definition:=replace(definition,old,replacement);
  old:='begin
  perform pg_advisory_xact_lock(hashtextextended(''internal-action:''||p_key,0));';
  replacement:='begin
  if p_category=''service'' then
    service_template:=automation_rule_policy(''service'')->''task_templates''->p_related_type;
    select full_name into service_name from clients where id=p_account;
    if service_name is null then raise exception ''A service task requires its linked account name''; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(''internal-action:''||p_key,0));';
  if strpos(definition,old)=0 then raise exception 'Internal action setup changed'; end if;
  definition:=replace(definition,old,replacement);
  old:='values(left(p_subject,240),''Automatically queued from the source record. Resolve the request in its linked record.'',';
  replacement:='values(left(p_subject,240),case when p_category=''service'' then
      replace(replace(service_template->>''description'',''{service_type}'',p_related_type),''{account_name}'',service_name)
      else ''Automatically queued from the source record. Resolve the request in its linked record.'' end,';
  if strpos(definition,old)=0 then raise exception 'Internal action task insertion changed'; end if;
  definition:=replace(definition,old,replacement);
  old:='subject=case when work.automation_key is not null and work.automation_event is distinct from p_event then left(p_subject,240) else work.subject end,';
  replacement:='subject=case when p_category=''service'' then work.subject
      when work.automation_key is not null and work.automation_event is distinct from p_event then left(p_subject,240) else work.subject end,';
  if strpos(definition,old)=0 then raise exception 'Internal action task-preservation baseline changed'; end if;
  definition:=replace(definition,old,replacement);
  old:='if p_notify and (work.id is null or work.status=''open'' or work.automation_event is distinct from p_event) then';
  replacement:='if p_notify and (p_category<>''service'' or automation_notification_allows(''service_events'',p_due))
    and (work.id is null or work.status=''open'' or work.automation_event is distinct from p_event) then';
  if strpos(definition,old)=0 then raise exception 'Internal action notification gate changed'; end if;
  definition:=replace(definition,old,replacement);
  execute definition;
end;
$patch$;

do $patch$
declare definition text; old text:=$old$'Review '||p_kind||': '||record_data.full_name$old$;
  replacement text:=$new$replace(replace((automation_rule_policy('service')->'task_templates'->p_kind->>'subject'),
    '{service_type}',p_kind),'{account_name}',record_data.full_name)$new$;
begin
  definition:=pg_get_functiondef('public.sync_service_action_core(text,uuid)'::regprocedure);
  if strpos(definition,old)=0 then raise exception 'Service task subject baseline changed'; end if;
  execute replace(definition,old,replacement);
end;
$patch$;

do $patch$
declare definition text; old text; replacement text;
begin
  definition:=pg_get_functiondef('public.sync_reply_action(uuid,boolean)'::regprocedure);
  old:='if p_notify and active and exists(select 1 from tasks where id=action_id and status=''open'') then';
  replacement:='if p_notify and automation_notification_allows(''message_replies'',message.sent_at)
    and active and exists(select 1 from tasks where id=action_id and status=''open'') then';
  if strpos(definition,old)=0 then raise exception 'Reply notification baseline changed'; end if;
  execute replace(definition,old,replacement);
end;
$patch$;

do $patch$
declare definition text; old text; replacement text;
begin
  definition:=pg_get_functiondef('public.alert_inbound_message(uuid,boolean)'::regprocedure);
  old:=$old$  insert into notifications(client_id,type,message,href,read,message_log_id,task_id)
    values(account,'message',left('New '||case when message.channel='sms' then 'text' else 'email' end||' from '||label||': '||coalesce(message.subject,message.body,''),280),href,false,p_log_id,action_id)
    on conflict(message_log_id) where message_log_id is not null do update set task_id=coalesce(excluded.task_id,notifications.task_id);$old$;
  replacement:=$new$  if automation_notification_allows('message_replies',message.sent_at) then
    insert into notifications(client_id,type,message,href,read,message_log_id,task_id)
      values(account,'message',left('New '||case when message.channel='sms' then 'text' else 'email' end||' from '||label||': '||coalesce(message.subject,message.body,''),280),href,false,p_log_id,action_id)
      on conflict(message_log_id) where message_log_id is not null do update set task_id=coalesce(excluded.task_id,notifications.task_id);
  end if;$new$;
  if strpos(definition,old)=0 then raise exception 'Inbound notification baseline changed'; end if;
  execute replace(definition,old,replacement);
end;
$patch$;

do $patch$
declare definition text; old text; replacement text;
begin
  definition:=pg_get_functiondef('public.persist_renewal_radar_core(uuid,date,integer,jsonb,text)'::regprocedure);
  old:=$old$  insert into public.notifications(client_id, type, message, href, read, renewal_key)
    values (owner, 'renewal', p_message, '/clients/' || owner::text || '?tab=policies', false,
      p_policy_id::text || ':' || p_renewal_date::text || ':' || p_milestone::text)
    on conflict (renewal_key) where renewal_key is not null do nothing;
  get diagnostics notified = row_count;$old$;
  replacement:=$new$  if automation_notification_allows('renewals',
    (p_renewal_date-p_milestone+time '09:00') at time zone 'America/Phoenix') then
    insert into public.notifications(client_id, type, message, href, read, renewal_key)
      values (owner, 'renewal', p_message, '/clients/' || owner::text || '?tab=policies', false,
        p_policy_id::text || ':' || p_renewal_date::text || ':' || p_milestone::text)
      on conflict (renewal_key) where renewal_key is not null do nothing;
    get diagnostics notified = row_count;
  end if;$new$;
  if strpos(definition,old)=0 then raise exception 'Renewal notification baseline changed'; end if;
  execute replace(definition,old,replacement);
end;
$patch$;

notify pgrst,'reload schema';
commit;
