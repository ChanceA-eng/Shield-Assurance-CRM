begin;

create table public.workday_item_state(
  work_id text primary key,
  assignee text check(length(assignee)<=120),
  snoozed_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.workday_item_state enable row level security;
revoke all on public.workday_item_state from public,anon,authenticated;
grant all on public.workday_item_state to service_role;

create or replace function public.crm_normalize_address(value text)
returns text language plpgsql immutable strict as $$
declare candidate text; digits text;
begin
  candidate:=lower(trim(coalesce(substring(value from '<([^>]+@[^>]+)>'),value)));
  if position('@' in candidate)>0 then return candidate; end if;
  digits:=regexp_replace(candidate,'[^0-9]','','g');
  if length(digits)=11 and left(digits,1)='1' then digits:=substring(digits from 2); end if;
  return case when length(digits)>=7 then digits else '' end;
end;
$$;

create or replace view public.agent_workday as
with task_context as (
  select t.*,coalesce(t.account_id,case when t.related_type='client' then t.related_id end,
    p.client_id,c.client_id,e.client_id,cert.client_id) as owner_account
  from public.tasks t
  left join public.policies p on t.related_type in ('policy','renewal_pipeline') and p.id=t.related_id
  left join public.claims c on t.related_type='claim' and c.id=t.related_id
  left join public.endorsements e on t.related_type='endorsement' and e.id=t.related_id
  left join public.certificates cert on t.related_type='certificate' and cert.id=t.related_id
), message_context as (
  select m.*,coalesce('client:'||coalesce(m.client_id,l.account_id)::text,
    'lead:'||l.id::text,'unmatched:'||coalesce(
      nullif(public.crm_normalize_address(case when m.direction='inbound' then m.metadata->>'from' else m.metadata->>'to' end),''),
      nullif(public.crm_normalize_address(case when m.direction='inbound' then m.metadata->>'to' else m.metadata->>'from' end),''),
      'unknown')) as conversation,
    coalesce(m.client_id,l.account_id) as account_id,l.id as lead_id,
    coalesce(a.full_name,l.full_name,m.metadata->>'from','Unknown sender') as name
  from public.communication_log m
  left join public.leads l on l.id::text=m.metadata->>'lead_id'
  left join public.clients a on a.id=coalesce(m.client_id,l.account_id)
  where m.channel in ('email','sms') and m.direction in ('inbound','outbound')
    and coalesce(m.metadata->>'status','') not in ('failed','pending','scheduled')
    and coalesce(m.metadata->>'delivery_status','') not in ('failed','pending','scheduled')
), latest_message as (
  select distinct on (conversation) * from message_context order by conversation,sent_at desc,id desc
), unanswered as (
  select * from latest_message where direction='inbound'
), reply_tasks as (
  select distinct on (coalesce('client:'||owner_account::text,case when related_type='lead' then 'lead:'||related_id::text end))
    coalesce('client:'||owner_account::text,case when related_type='lead' then 'lead:'||related_id::text end) as conversation,
    id,due_date,assignee,updated_at
  from task_context where status='open' and subject ilike 'Reply%'
  order by coalesce('client:'||owner_account::text,case when related_type='lead' then 'lead:'||related_id::text end),created_at,id
), rows as (
  select 'task:'||t.id::text as id,t.id as task_id,t.id as source_id,
    case when t.intake_event_id is not null then 'website' when t.related_type in ('policy','renewal_pipeline') or t.description like '%renewal-radar:%' then 'renewal'
      when t.related_type in ('claim','endorsement','certificate') then 'service'
      when t.kind='reminder' then 'reminder' else 'task' end as kind,
    t.subject,coalesce(l.full_name,a.full_name,'General work') as name,
    case when t.intake_event_id is not null then 'Website request still needs action'
      when t.kind='reminder' then 'Dated reminder'
      else coalesce(nullif(t.description,''),'Open follow-up') end as reason,
    t.due_date as due_at,t.created_at,t.assignee,t.priority,t.updated_at,
    case when t.related_type='lead' then '/leads?lead='||t.related_id::text
      when t.related_type='event' then '/scheduler?event='||t.related_id::text
      when t.owner_account is not null and t.related_type in ('claim','endorsement','certificate','policy','renewal_pipeline')
        then '/clients/'||t.owner_account::text||'?tab=policies&context_type='||
          case when t.related_type='renewal_pipeline' then 'policy' else t.related_type end||'&context_id='||t.related_id::text
      when t.owner_account is not null then '/clients/'||t.owner_account::text||'?tab=tasks'
      else '/tasks' end as href
  from task_context t
  left join public.leads l on t.related_type='lead' and l.id=t.related_id
  left join public.clients a on a.id=t.owner_account
  left join unanswered reply on t.subject ilike 'Reply%' and reply.conversation=
    coalesce('client:'||t.owner_account::text,case when t.related_type='lead' then 'lead:'||t.related_id::text end)
  where t.status='open' and reply.id is null
  union all
  select 'intake:'||i.id::text,null::uuid,i.id,'website','Respond to website request',l.full_name,
    'Request is not handled. Opening or dismissing the banner does not complete this work.',
    coalesce(i.submitted_at,i.received_at),i.received_at,null::text,'high',null::timestamptz,
    '/leads?lead='||l.id::text
  from public.lead_intake_events i join public.leads l on l.id=i.lead_id
  where i.handled_at is null and not exists(select 1 from public.tasks t where t.intake_event_id=i.id)
  union all
  select 'message:'||u.conversation,reply_task.id,u.id,'reply','Reply to '||u.name,u.name,
    'Latest conversation message is inbound; reading it does not answer it.',
    coalesce(reply_task.due_date,u.sent_at+interval '2 hours'),u.sent_at,reply_task.assignee,'high',reply_task.updated_at,
    case when u.account_id is not null then '/clients/'||u.account_id::text||'?tab=communication'
      when u.lead_id is not null then '/leads?lead='||u.lead_id::text||'&tab=conversation'
      else '/communication' end
  from unanswered u
  left join reply_tasks reply_task on reply_task.conversation=u.conversation
  union all
  select 'service:'||s.kind||':'||s.id::text,null::uuid,s.id,'service',
    'Review '||s.kind,a.full_name,'This service request is still open and has no open task.',
    s.created_at,s.created_at,null::text,'medium',null::timestamptz,
    '/clients/'||s.client_id::text||'?tab=policies&context_type='||s.kind||'&context_id='||s.id::text
  from (
    select id,client_id,created_at,status,'claim'::text as kind from public.claims
    union all select id,client_id,created_at,status,'endorsement' from public.endorsements
    union all select id,client_id,created_at,status,'certificate' from public.certificates
  ) s join public.clients a on a.id=s.client_id
  where lower(s.status) in ('open','pending','requested','in_progress','in progress','submitted')
    and not exists(select 1 from public.tasks t where t.related_type=s.kind and t.related_id=s.id and t.status='open')
  union all
  select 'outreach:'||o.id::text,null::uuid,o.id,
    case when o.status='pending_approval' then 'approval' else 'delivery' end,
    case when o.status='pending_approval' then 'Review outreach draft' else 'Review outreach delivery failure' end,
    coalesce(l.full_name,'Outreach'),coalesce(nullif(to_jsonb(o)->>'error',''),'Open Outreach to review this item.'),
    o.created_at,o.created_at,null::text,'medium',null::timestamptz,'/outreach'
  from public.outreach_outbox o left join public.leads l on l.id=o.lead_id
  where o.status in ('pending_approval','failed','acceptance_unknown','accepted_by_provider')
    or (o.status='sending' and o.sent_at<now()-interval '10 minutes')
), effective as (
  select r.id,r.task_id,r.source_id,r.kind,r.subject,r.name,r.reason,
    case when r.task_id is null then coalesce(s.snoozed_until,r.due_at) else r.due_at end as due_at,
    r.created_at,case when r.task_id is null then s.assignee else r.assignee end as assignee,r.priority,
    case when r.task_id is null then s.updated_at else r.updated_at end as updated_at,r.href,
    r.task_id is null and s.snoozed_until>now() as source_snoozed
  from rows r left join public.workday_item_state s on s.work_id=r.id
)
select id,task_id,source_id,kind,subject,name,reason,due_at,created_at,assignee,priority,updated_at,href,
  not coalesce(source_snoozed,false) and
  (case when kind='reply' and task_id is not null then due_at is null or due_at<=now()
    else kind in ('reply','website','approval','delivery') or due_at is null or due_at<(date_trunc('day',now() at time zone 'America/Phoenix')+interval '1 day') at time zone 'America/Phoenix' end) as actionable,
  case when due_at<now() then 'overdue' when due_at<(date_trunc('day',now() at time zone 'America/Phoenix')+interval '1 day') at time zone 'America/Phoenix' then 'today'
    when due_at is null then 'unscheduled' else 'upcoming' end as timing,
  case when source_snoozed or (kind='reply' and task_id is not null and due_at>now()) then 5
    when kind='reply' then 0 when due_at<now() then 1 when kind='website' then 2 when priority='high' then 3 else 4 end as urgency
from effective;

revoke all on public.agent_workday from public,anon,authenticated;
grant select on public.agent_workday to service_role;
create index if not exists tasks_open_workday_idx on public.tasks(due_date,id) where status='open';
create index if not exists communication_workday_latest_idx on public.communication_log(sent_at desc,id desc) where direction in ('inbound','outbound');
commit;
