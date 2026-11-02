begin;

create or replace view public.canonical_communications as
select m.*,coalesce('client:'||coalesce(m.client_id,l.account_id)::text,
  'lead:'||l.id::text,'unmatched:'||coalesce(
    nullif(public.crm_normalize_address(case when m.direction='inbound' then m.metadata->>'from' else m.metadata->>'to' end),''),
    nullif(public.crm_normalize_address(case when m.direction='inbound' then m.metadata->>'to' else m.metadata->>'from' end),''),
    'unknown')) as conversation_key,
  coalesce(m.client_id,l.account_id) as canonical_account_id,l.id as canonical_lead_id
from public.communication_log m
left join public.leads l on l.id::text=m.metadata->>'lead_id';
revoke all on public.canonical_communications from public,anon,authenticated;
grant select on public.canonical_communications to service_role;

create or replace view public.conversation_inbox as
with ranked as (
  select c.*,row_number() over(partition by conversation_key order by sent_at desc,id desc) as position,
    count(*) over(partition by conversation_key) as total,
    count(*) filter(where direction='inbound' and read_at is null) over(partition by conversation_key) as unread
  from public.canonical_communications c where channel in ('email','sms')
)
select c.conversation_key as key,
  case when c.canonical_account_id is not null then 'client' when c.canonical_lead_id is not null then 'lead' else 'unmatched' end as kind,
  c.canonical_account_id as client_id,c.canonical_lead_id as lead_id,
  coalesce(a.full_name,l.full_name,substring(c.conversation_key from 11),'Unknown sender') as name,
  coalesce(a.email,l.email,case when position('@' in c.conversation_key)>0 then substring(c.conversation_key from 11) end) as email,
  coalesce(a.phone,l.phone,case when c.conversation_key like 'unmatched:%' and position('@' in c.conversation_key)=0 then substring(c.conversation_key from 11) end) as phone,
  case when c.conversation_key like 'unmatched:%' then substring(c.conversation_key from 11) end as address,
  c.subject as last_subject,left(regexp_replace(coalesce(c.body,''),'\s+',' ','g'),120) as last_snippet,
  c.direction as last_direction,c.channel as last_channel,c.sent_at as last_at,c.unread,c.total
from ranked c left join public.clients a on a.id=c.canonical_account_id
left join public.leads l on l.id=c.canonical_lead_id where c.position=1;
revoke all on public.conversation_inbox from public,anon,authenticated;
grant select on public.conversation_inbox to service_role;

create or replace function public.unread_message_summary()
returns jsonb language sql stable security definer set search_path=public as $$
with unread as (
  select canonical_account_id,canonical_lead_id from public.canonical_communications
  where channel in ('email','sms') and direction='inbound' and read_at is null
), accounts as (
  select canonical_account_id as id,count(*) as amount from unread where canonical_account_id is not null group by canonical_account_id
), lead_counts as (
  select l.id,count(*) as amount from public.leads l join unread u
    on (l.account_id is not null and l.account_id=u.canonical_account_id)
      or (l.account_id is null and l.id=u.canonical_lead_id)
  group by l.id
)
select jsonb_build_object('total',(select count(*) from unread),
  'byClient',coalesce((select jsonb_object_agg(id,amount) from accounts),'{}'::jsonb),
  'byLead',coalesce((select jsonb_object_agg(id,amount) from lead_counts),'{}'::jsonb));
$$;
revoke all on function public.unread_message_summary() from public,anon,authenticated;
grant execute on function public.unread_message_summary() to service_role;

create or replace function public.update_workday_source(p_id text,p_version timestamptz,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare work public.agent_workday%rowtype; prior public.workday_item_state%rowtype; saved public.workday_item_state%rowtype;
begin
  if jsonb_typeof(p_changes)<>'object' or p_changes='{}' or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('assignee','due_date'))
    then raise exception 'Choose an owner or snooze time.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('workday:'||p_id,0));
  select * into work from public.agent_workday where id=p_id;
  if work.id is null then raise exception 'This work has already changed. Refresh the workday.' using errcode='P0002'; end if;
  if work.task_id is not null then raise exception 'Update the linked task instead.' using errcode='23514'; end if;
  select * into prior from public.workday_item_state where work_id=p_id for update;
  if prior.updated_at is distinct from p_version then raise exception 'Another agent changed this work. Refresh before saving.' using errcode='40001'; end if;
  if p_changes ? 'due_date' and (p_changes->>'due_date')::timestamptz<=now() then
    raise exception 'Choose a future snooze time.' using errcode='22023'; end if;
  insert into public.workday_item_state(work_id,assignee,snoozed_until) values(p_id,
    case when p_changes ? 'assignee' then nullif(trim(p_changes->>'assignee'),'') else prior.assignee end,
    case when p_changes ? 'due_date' then (p_changes->>'due_date')::timestamptz else prior.snoozed_until end)
  on conflict(work_id) do update set assignee=excluded.assignee,snoozed_until=excluded.snoozed_until,updated_at=clock_timestamp()
  returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.update_workday_source(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.update_workday_source(text,timestamptz,jsonb) to service_role;

create table public.automation_runs(
  id uuid primary key default gen_random_uuid(),
  job text not null,
  status text not null check(status in ('running','succeeded','partial','failed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}',
  error text
);
create index automation_runs_job_started_idx on public.automation_runs(job,started_at desc);
create unique index automation_runs_running_job_idx on public.automation_runs(job) where status='running';
alter table public.automation_runs enable row level security;
revoke all on public.automation_runs from public,anon,authenticated;
grant all on public.automation_runs to service_role;

create or replace function public.ensure_default_followups()
returns integer language plpgsql security definer set search_path=public as $$
declare created integer; due timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('default-followups',0));
  if extract(isodow from now() at time zone 'America/Phoenix') in (6,7) then return 0; end if;
  due:=(date_trunc('day',now() at time zone 'America/Phoenix')+interval '1 day 9 hours') at time zone 'America/Phoenix';
  while extract(isodow from due at time zone 'America/Phoenix') in (6,7) loop due:=due+interval '1 day'; end loop;
  insert into public.tasks(subject,description,due_date,status,priority,related_type,related_id)
  select case when l.status='quoted' then 'Follow up on '||l.full_name||'''s quote'
    when l.status='contacted' then 'Follow up with '||l.full_name else 'Make first contact with '||l.full_name end,
    'Review the profile and contact the prospect about their next step.',due,'open','medium','lead',l.id
  from public.leads l where l.status in ('new','contacted','quoted')
    and not exists(select 1 from public.tasks t where t.status='open' and t.related_type='lead' and t.related_id=l.id);
  get diagnostics created=row_count;
  return created;
end;
$$;
revoke all on function public.ensure_default_followups() from public,anon,authenticated;
grant execute on function public.ensure_default_followups() to service_role;
notify pgrst,'reload schema';
commit;
