begin;
create table public.opportunity_settings (
  id integer primary key check(id=1),
  revision integer not null default 0,
  config jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.opportunity_settings(id,config) values(1,'{
  "industries":"","states":"","lines":"","excluded_industries":"",
  "revenue_min":null,"revenue_max":null,"renewal_days":90,"agent_capacity":10,
  "recurring_enabled":false,"refresh_days":7,"digest_hour":8
}');
create table public.opportunity_operation_events (
  id uuid primary key,
  entity_id uuid not null,
  scope_key text not null references public.intelligence_dossiers(scope_key),
  actor_id uuid not null references auth.users(id),
  kind text not null check(kind in ('outcome','evidence','relationship','relationship_review','request','answer')),
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index opportunity_events_scope on public.opportunity_operation_events(scope_key,created_at desc);
create table public.opportunity_watches (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  target_type text not null check(target_type in ('lead','client','search')),
  target_id uuid not null,
  scope_key text,
  enabled boolean not null default true,
  next_due_at timestamptz not null default now(),
  last_evaluated_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  error text,
  snapshot jsonb,
  last_digest_fingerprint text,
  unique(actor_id,target_type,target_id)
);
create index opportunity_watch_due on public.opportunity_watches(next_due_at,id) where enabled;
create table public.opportunity_job_history (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references public.opportunity_watches(id),
  lease_token uuid not null unique,
  state text not null check(state in ('claimed','succeeded','failed')),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.opportunity_digests (
  actor_id uuid not null references auth.users(id),
  local_day date not null,
  items jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,local_day)
);
create table public.opportunity_questionnaires (
  token_hash text primary key check(token_hash~'^[a-f0-9]{64}$'),
  request_id uuid not null references public.opportunity_operation_events(id),
  actor_id uuid not null references auth.users(id),
  target_type text not null,
  target_id uuid not null,
  scope_key text not null,
  expires_at timestamptz not null default now()+interval '7 days',
  revoked boolean not null default false,
  response_id uuid unique
);
alter table public.opportunity_settings enable row level security;
alter table public.opportunity_operation_events enable row level security;
alter table public.opportunity_watches enable row level security;
alter table public.opportunity_job_history enable row level security;
alter table public.opportunity_digests enable row level security;
alter table public.opportunity_questionnaires enable row level security;
revoke all on public.opportunity_settings,public.opportunity_operation_events,public.opportunity_watches,public.opportunity_job_history,public.opportunity_digests from public,anon,authenticated,service_role;
grant select on public.opportunity_settings,public.opportunity_operation_events,public.opportunity_watches,public.opportunity_job_history,public.opportunity_digests to service_role;
revoke all on public.opportunity_questionnaires from public,anon,authenticated,service_role;

create function public.save_opportunity_settings(p_actor uuid,p_expected integer,p_config jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved opportunity_settings; field text; n numeric;
begin
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the owner can change OIP settings' using errcode='42501'; end if;
  if jsonb_typeof(p_config) is distinct from 'object' or p_config-array['industries','states','lines','excluded_industries','revenue_min','revenue_max','renewal_days','agent_capacity','recurring_enabled','refresh_days','digest_hour']<>'{}'::jsonb then
    raise exception 'Provide supported OIP settings' using errcode='22023'; end if;
  foreach field in array array['industries','states','lines','excluded_industries'] loop
    if jsonb_typeof(p_config->field) is distinct from 'string' or length(p_config->>field)>1000 then raise exception 'Provide valid targeting lists' using errcode='22023'; end if;
  end loop;
  foreach field in array array['renewal_days','agent_capacity','refresh_days','digest_hour'] loop
    if jsonb_typeof(p_config->field) is distinct from 'number' or (p_config->>field)!~'^\d+$' then raise exception 'Use whole-number scheduling limits' using errcode='22023'; end if;
    n:=(p_config->>field)::numeric;
    if n < (case when field='digest_hour' then 0 else 1 end) or n > (case when field='digest_hour' then 23 when field='agent_capacity' then 100 else 365 end) then raise exception 'Scheduling limit out of range' using errcode='22023'; end if;
  end loop;
  foreach field in array array['revenue_min','revenue_max'] loop
    if p_config->field is null or (jsonb_typeof(p_config->field) not in ('number','null'))
      or (jsonb_typeof(p_config->field)='number' and ((p_config->>field)::numeric<0 or (p_config->>field)::numeric>1e15)) then raise exception 'Invalid revenue range' using errcode='22023'; end if;
  end loop;
  if (p_config->>'revenue_min')::numeric>(p_config->>'revenue_max')::numeric or jsonb_typeof(p_config->'recurring_enabled') is distinct from 'boolean' then raise exception 'Invalid revenue range or recurrence choice' using errcode='22023'; end if;
  select * into saved from opportunity_settings where id=1 for update;
  if saved.revision=p_expected+1 and saved.config=p_config then return to_jsonb(saved); end if;
  if saved.revision is distinct from p_expected then raise exception 'OIP settings changed. Reload before saving' using errcode='PT409'; end if;
  if (p_config->>'recurring_enabled')::boolean and not (crm_scheduler_status()->>'configured')::boolean then
    raise exception 'Configure authenticated CRM heartbeat scheduling before enabling recurring OIP evaluation' using errcode='22023'; end if;
  perform cron.alter_job((select jobid from cron.job where jobname='crm-opportunity-intelligence'),active:=(p_config->>'recurring_enabled')::boolean);
  update opportunity_settings set config=p_config,revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() where id=1 returning * into saved;
  insert into agency_audit(actor_id,action,details) values(p_actor,'opportunity_settings',to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;

create function public.opportunity_operation(p_actor uuid,p_type text,p_id uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb; saved opportunity_operation_events; original opportunity_operation_events; entity uuid; file client_files;
begin
  perform pg_advisory_xact_lock(hashtextextended('intelligence-dossier-write',0));
  scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
  if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Provide an operation identity and reviewed values' using errcode='22023'; end if;
  insert into intelligence_dossiers(scope_key,lead_id,client_id) values(scope->>'scope_key',(scope->>'lead_id')::uuid,(scope->>'client_id')::uuid) on conflict do nothing;
  select * into saved from opportunity_operation_events where id=p_request;
  if found then
    if saved.actor_id=p_actor and saved.scope_key=scope->>'scope_key' and saved.kind=p_action and saved.payload=p_payload then return to_jsonb(saved); end if;
    raise exception 'This request identity belongs to different values' using errcode='PT409'; end if;
  entity:=p_request;
  if p_action='outcome' then
    if coalesce(p_payload->>'stage','') not in ('discovered','contact_verified','qualified','meeting','submission','quote','bound','declined','lost')
      or coalesce(length(trim(p_payload->>'source')),0) not between 1 and 500
      or coalesce(length(p_payload->>'reason'),1001)>1000
      or (p_payload->>'occurred_on')::date>current_date or p_payload->>'occurred_on' is null
      or jsonb_typeof(p_payload->'cost') is distinct from 'number' or (p_payload->>'cost')::numeric not between 0 and 1e9
      or (p_payload->>'premium')::numeric<0
      or (p_payload->>'premium' is not null and p_payload->>'stage' not in ('quote','bound'))
      or (p_payload->>'stage' in ('declined','lost') and coalesce(length(trim(p_payload->>'reason')),0)=0) then
      raise exception 'Provide a valid dated outcome, attribution, cost and decline reason when applicable' using errcode='22023'; end if;
    if p_payload->>'supersedes' is not null then
      select * into original from opportunity_operation_events where id=(p_payload->>'supersedes')::uuid and scope_key=scope->>'scope_key' and kind='outcome';
      if not found or exists(select 1 from opportunity_operation_events where kind='outcome' and payload->>'supersedes'=original.id::text) then
        raise exception 'This outcome changed. Reload before correcting it' using errcode='PT409'; end if;
    end if;
  elsif p_action='evidence' then
    if coalesce(p_payload->>'kind','') not in ('authority','location','document','held_line','contact_role','cross_sell')
      or coalesce(length(trim(p_payload->>'value')),0) not between 1 and 1000
      or coalesce(length(trim(p_payload->>'reference')),0) not between 1 and 1000
      or p_payload->>'source_as_of' is null or (p_payload->>'source_as_of')::date>current_date
      or p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'Review the business fact and its source date/reference' using errcode='22023'; end if;
    if p_payload->>'kind' in ('authority','location') and
      (coalesce(length(trim(p_payload->>'previous_value')),0)=0 or p_payload->>'previous_as_of' is null
       or (p_payload->>'previous_as_of')::date>=(p_payload->>'source_as_of')::date
       or p_payload->>'previous_value'=p_payload->>'value') then
      raise exception 'Dated change evidence needs different earlier and current values, not merely a new source' using errcode='22023'; end if;
    if p_payload->>'kind'='document' then
      select * into file from client_files where id=(p_payload->>'document_id')::uuid and client_id=(scope->>'client_id')::uuid;
      if not found or file.status<>'uploaded' then raise exception 'Choose an existing private uploaded document on this account' using errcode='42501'; end if;
    end if;
  elsif p_action='request' then
    if coalesce(length(trim(p_payload->>'questions')),0) not between 1 and 3000 then raise exception 'Provide specific discovery questions or requested documents' using errcode='22023'; end if;
  elsif p_action='answer' then
    entity:=(p_payload->>'request_id')::uuid;
    select * into original from opportunity_operation_events where id=entity and scope_key=scope->>'scope_key' and kind='request';
    if not found or coalesce(length(trim(p_payload->>'response')),0) not between 1 and 3000
      or coalesce(length(trim(p_payload->>'reference')),0) not between 1 and 1000
      or p_payload->>'source_as_of' is null or (p_payload->>'source_as_of')::date>current_date then
      raise exception 'Record a dated, sourced response to this account request' using errcode='22023'; end if;
  elsif p_action='relationship' then
    if p_payload->'opt_in' is distinct from 'true'::jsonb or coalesce(length(trim(p_payload->>'name')),0) not between 1 and 120
      or coalesce(length(trim(p_payload->>'reference')),0) not between 1 and 1000 then
      raise exception 'Explicitly opt in and record permitted introduction evidence' using errcode='22023'; end if;
  elsif p_action='relationship_review' then
    entity:=(p_payload->>'relationship_id')::uuid;
    select * into original from opportunity_operation_events where id=entity and scope_key=scope->>'scope_key' and kind='relationship' and actor_id=p_actor;
    if not found or coalesce(p_payload->>'state','') not in ('approved','dismissed') then raise exception 'Review your own relationship suggestion' using errcode='42501'; end if;
  else raise exception 'Unsupported opportunity action' using errcode='22023'; end if;
  insert into opportunity_operation_events(id,entity_id,scope_key,actor_id,kind,payload)
    values(p_request,entity,scope->>'scope_key',p_actor,p_action,p_payload) returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.get_opportunity_operations(p_actor uuid,p_type text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb; result jsonb;
begin
  scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
  select jsonb_build_object(
    'watch',(select jsonb_build_object('enabled',enabled,'last_evaluated_at',last_evaluated_at,'next_due_at',next_due_at,'error',error)
      from opportunity_watches where actor_id=p_actor and target_type=p_type and target_id=p_id and scope_key=scope->>'scope_key'),
    'outcomes',coalesce((select jsonb_agg(payload||jsonb_build_object('id',id,'actor_id',actor_id) order by created_at desc,id)
      from opportunity_operation_events e where scope_key=scope->>'scope_key' and kind='outcome'
        and not exists(select 1 from opportunity_operation_events c where c.kind='outcome' and c.payload->>'supersedes'=e.id::text)),'[]'),
    'evidence',coalesce((select jsonb_agg(payload||jsonb_build_object('id',id) order by created_at desc,id)
      from opportunity_operation_events e where scope_key=scope->>'scope_key' and kind='evidence'
        and (payload->>'kind'<>'document' or exists(select 1 from client_files f where f.id=(e.payload->>'document_id')::uuid and f.client_id=(scope->>'client_id')::uuid and f.status='uploaded'))),'[]'),
    'held_lines',coalesce((select jsonb_agg(distinct line order by line) from (
      select payload->>'value' as line from opportunity_operation_events where scope_key=scope->>'scope_key' and kind='evidence'
        and payload->>'kind'='held_line' and (payload->>'source_as_of')::date>=current_date-90
      union select line_of_business from policies where client_id=(scope->>'client_id')::uuid and effective_date<=current_date
        and coalesce(expiration_date,renewal_date)>=current_date and status in ('issued','active','bound')
    ) held where line is not null),'[]'),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',id,'file_name',file_name,'review_summary',concat_ws(' | ',
      case when metadata->'intake_review'->>'carrier' is not null then 'Carrier: '||(metadata->'intake_review'->>'carrier') end,
      case when metadata->'intake_review'->>'line_of_business' is not null then 'Line: '||(metadata->'intake_review'->>'line_of_business') end,
      case when metadata->'intake_review'->>'effective_date' is not null then 'Effective: '||(metadata->'intake_review'->>'effective_date') end,
      case when metadata->'intake_review'->>'expiration_date' is not null then 'Expires: '||(metadata->'intake_review'->>'expiration_date') end
      )) order by uploaded_at desc,id)
      from client_files where client_id=(scope->>'client_id')::uuid and status='uploaded'),'[]'),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'questions',e.payload->>'questions',
      'state',case when a.id is null then 'requested' when a.payload->'confirmed'='false'::jsonb then 'responded' else 'answered' end,'response',coalesce(a.payload->>'response',''),'source_as_of',a.payload->>'source_as_of') order by e.created_at,e.id)
      from opportunity_operation_events e left join lateral(select * from opportunity_operation_events
        where entity_id=e.id and kind='answer' order by created_at desc,id limit 1) a on true
      where e.scope_key=scope->>'scope_key' and e.kind='request'),'[]'),
    'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.payload->>'name','reference',e.payload->>'reference','state',coalesce(r.payload->>'state','suggested')) order by e.created_at,e.id)
      from opportunity_operation_events e left join lateral(select * from opportunity_operation_events
        where entity_id=e.id and kind='relationship_review' order by created_at desc,id limit 1) r on true
      where e.scope_key=scope->>'scope_key' and e.kind='relationship' and e.actor_id=p_actor),'[]')
  ) into result;
  return result;
end;
$$;

create function public.share_opportunity_questionnaire(p_actor uuid,p_type text,p_id uuid,p_request uuid,p_hash text,p_revoke boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb;
begin
  scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
  if not exists(select 1 from opportunity_operation_events where id=p_request and scope_key=scope->>'scope_key' and kind='request') then
    raise exception 'Choose a saved request on this business' using errcode='42501'; end if;
  if p_revoke then
    update opportunity_questionnaires set revoked=true where request_id=p_request and scope_key=scope->>'scope_key';
    return jsonb_build_object('revoked',true);
  end if;
  if p_hash is null or p_hash!~'^[a-f0-9]{64}$' then raise exception 'Provide a secure questionnaire token' using errcode='22023'; end if;
  insert into opportunity_questionnaires(token_hash,request_id,actor_id,target_type,target_id,scope_key)
    values(p_hash,p_request,p_actor,p_type,p_id,scope->>'scope_key');
  return jsonb_build_object('expires_at',now()+interval '7 days');
end;
$$;
create function public.public_opportunity_questionnaire(p_hash text,p_response text default null,p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link opportunity_questionnaires; scope jsonb; request opportunity_operation_events; new_response uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('intelligence-dossier-write',0));
  select * into link from opportunity_questionnaires where token_hash=p_hash for update;
  if not found or link.revoked or link.expires_at<=clock_timestamp() then raise exception 'This questionnaire link has expired or was withdrawn. Contact your agent.' using errcode='P0002'; end if;
  scope:=intelligence_dossier_scope(link.actor_id,link.target_type,link.target_id);
  if scope->>'scope_key' is distinct from link.scope_key then raise exception 'The account changed. Ask your agent for a new questionnaire.' using errcode='PT409'; end if;
  select * into request from opportunity_operation_events where id=link.request_id;
  if p_response is not null then
    if p_consent is distinct from true or length(trim(p_response)) not between 1 and 3000 then raise exception 'Consent and a business-only response are required' using errcode='22023'; end if;
    if link.response_id is not null then
      if not exists(select 1 from opportunity_operation_events where id=link.response_id and payload->>'response'=trim(p_response)) then raise exception 'A response was already submitted. Contact your agent to correct it.' using errcode='PT409'; end if;
      return jsonb_build_object('submitted',true);
    end if;
    new_response:=gen_random_uuid();
    insert into opportunity_operation_events(id,entity_id,scope_key,actor_id,kind,payload) values(new_response,link.request_id,link.scope_key,link.actor_id,'answer',
      jsonb_build_object('request_id',link.request_id,'response',trim(p_response),'reference','Prospect-submitted questionnaire; identity and facts require agent review',
        'source_as_of',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD'),'confirmed',false,'consent',true));
    update opportunity_questionnaires set response_id=new_response where token_hash=p_hash;
    return jsonb_build_object('submitted',true);
  end if;
  return jsonb_build_object('questions',request.payload->>'questions','submitted',link.response_id is not null,'expires_at',link.expires_at);
end;
$$;

create function public.set_opportunity_watch(p_actor uuid,p_type text,p_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb; saved opportunity_watches;
begin
  if p_enabled is null then raise exception 'Choose a watch status' using errcode='22023'; end if;
  if not exists(select 1 from agency_members where user_id=p_actor and active) then raise exception 'Active agency access is required' using errcode='42501'; end if;
  if not p_enabled then
    update opportunity_watches set enabled=false,lease_token=null,lease_until=null,snapshot=null where actor_id=p_actor and target_type=p_type and target_id=p_id returning * into saved;
    if not found then raise exception 'Watch not found' using errcode='P0002'; end if;
    return to_jsonb(saved);
  end if;
  if p_type='search' then
    if not exists(select 1 from discovery_saved_searches s join agency_members m on m.user_id=s.user_id and m.active
      where s.id=p_id and s.user_id=p_actor) then raise exception 'Choose your own saved search' using errcode='42501'; end if;
  else
    scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
    if not exists(select 1 from opportunity_profiles where scope_key=scope->>'scope_key') then raise exception 'Save reviewed business facts before watching this record' using errcode='22023'; end if;
  end if;
  insert into opportunity_watches(actor_id,target_type,target_id,scope_key,enabled) values(p_actor,p_type,p_id,scope->>'scope_key',p_enabled)
    on conflict(actor_id,target_type,target_id) do update set enabled=p_enabled,scope_key=excluded.scope_key,
      next_due_at=clock_timestamp(),lease_token=null,lease_until=null,error=null,attempts=0,snapshot=null,last_digest_fingerprint=null
    returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.claim_opportunity_jobs(p_limit integer default 4)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ids uuid[]; result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 10 then raise exception 'Choose 1 to 10 jobs' using errcode='22023'; end if;
  if not (select (config->>'recurring_enabled')::boolean from opportunity_settings where id=1) then return '[]'::jsonb; end if;
  update opportunity_job_history h set state='failed',error='Worker lease expired before completion',finished_at=clock_timestamp()
    from opportunity_watches w where w.lease_token=h.lease_token and w.lease_until<clock_timestamp() and h.state='claimed';
  update opportunity_watches set error='Worker lease expired before completion. Re-enable the watch after five attempts to retry.'
    where lease_until<clock_timestamp() and lease_token is not null;
  select array_agg(id) into ids from (select w.id from opportunity_watches w join agency_members m on m.user_id=w.actor_id and m.active
    where w.enabled and w.attempts<5 and w.next_due_at<=clock_timestamp() and (w.lease_until is null or w.lease_until<clock_timestamp())
    order by w.next_due_at,w.id limit p_limit for update of w skip locked) due;
  with updated as (update opportunity_watches set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1
    where id=any(ids) returning *)
    select coalesce(jsonb_agg(to_jsonb(updated)),'[]') into result from updated;
  insert into opportunity_job_history(watch_id,lease_token,state)
    select (e->>'id')::uuid,(e->>'lease_token')::uuid,'claimed' from jsonb_array_elements(result) e;
  return result;
end;
$$;

create function public.finish_opportunity_job(p_watch uuid,p_lease uuid,p_snapshot jsonb,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
declare saved opportunity_watches; context jsonb; days integer;
begin
  select * into saved from opportunity_watches where id=p_watch for update;
  if saved.id is null or p_lease is null or saved.lease_token is distinct from p_lease or saved.lease_until<=clock_timestamp() or not saved.enabled then
    raise exception 'Job lease expired or watch changed. Its result was not saved' using errcode='PT409'; end if;
  if p_error is null then
    if not (select (config->>'recurring_enabled')::boolean from opportunity_settings where id=1) then raise exception 'Recurring OIP evaluation was paused' using errcode='PT409'; end if;
    if not exists(select 1 from agency_members where user_id=saved.actor_id and active) then raise exception 'Actor access was revoked' using errcode='42501'; end if;
    if saved.target_type='search' then
      if not exists(select 1 from discovery_saved_searches where id=saved.target_id and user_id=saved.actor_id) then raise exception 'Search was removed' using errcode='42501'; end if;
    else
      context:=get_opportunity_context(saved.actor_id,saved.target_type,saved.target_id);
      if saved.scope_key is distinct from context->'dossier'->>'scope_key' or p_snapshot->>'evidence_token' is distinct from context->>'evidence_token' then
        raise exception 'Evidence or account linkage changed during evaluation' using errcode='PT409'; end if;
    end if;
    if jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'Provide a verified evaluation result' using errcode='22023'; end if;
  end if;
  select (config->>'refresh_days')::integer into days from opportunity_settings where id=1;
  update opportunity_watches set snapshot=case when p_error is null then p_snapshot else snapshot end,
    last_evaluated_at=case when p_error is null then clock_timestamp() else last_evaluated_at end,
    next_due_at=clock_timestamp()+case when p_error is null then make_interval(days=>days) else make_interval(mins=>least(60,attempts*5)) end,
    lease_token=null,lease_until=null,error=left(p_error,1000),attempts=case when p_error is null then 0 else attempts end where id=p_watch;
  update opportunity_job_history set state=case when p_error is null then 'succeeded' else 'failed' end,error=left(p_error,1000),finished_at=clock_timestamp() where lease_token=p_lease;
  return true;
end;
$$;

create function public.build_opportunity_digests()
returns integer language plpgsql security definer set search_path=public as $$
declare member agency_members; local_now timestamp; config jsonb; chosen jsonb; n integer:=0; timezone text;
begin
  perform pg_advisory_xact_lock(hashtextextended('opportunity-digests',0));
  select s.config into config from opportunity_settings s where id=1;
  if not (config->>'recurring_enabled')::boolean then return 0; end if;
  select s.timezone into timezone from outreach_settings s where id=1;
  if timezone is null or not exists(select 1 from pg_timezone_names where name=timezone) then raise exception 'Configure a valid agency time zone' using errcode='22023'; end if;
  local_now:=clock_timestamp() at time zone timezone;
  if extract(isodow from local_now)>5 or extract(hour from local_now)<(config->>'digest_hour')::integer then return 0; end if;
  for member in select * from agency_members where active loop
    if exists(select 1 from opportunity_digests where actor_id=member.user_id and local_day=local_now::date) then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object('watch_id',id,'type',target_type,'id',target_id,'snapshot',snapshot)
      order by (case snapshot->>'target_status' when 'targeted' then 0 when 'outside_target' then 2 else 1 end),
        (case snapshot->'assessment'->>'status' when 'possible_fit' then 0 when 'needs_review' then 1 else 2 end),score desc,id),'[]') into chosen from (
      select w.*,coalesce((snapshot->'assessment'->'score'->>'total')::integer,0) as score
      from opportunity_watches w where actor_id=member.user_id and enabled and error is null and snapshot is not null
        and last_evaluated_at>=clock_timestamp()-interval '1 day'
        and (snapshot->'profile'->'profile'->>'permission' is distinct from 'do_not_contact')
        and (snapshot->'assessment'->>'status' is distinct from 'excluded')
        and last_digest_fingerprint is distinct from md5((snapshot-'evidence_token'-'evaluated_on')::text)
        and (target_type='search' or exists(select 1 from opportunity_profiles p join intelligence_dossiers d on d.scope_key=p.scope_key
          left join leads l on l.id=d.lead_id left join clients c on c.id=d.client_id where p.scope_key=w.scope_key
          and (member.role<>'agent' or coalesce(c.agent_user_id,l.agent_user_id) is null or coalesce(c.agent_user_id,l.agent_user_id)=member.user_id)
          and (d.lead_id is null or l.account_id is null)))
        and (case when target_type='search' then exists(select 1 from discovery_saved_searches s where s.id=w.target_id and s.user_id=member.user_id and s.filters=w.snapshot->'filters')
          when exists(select 1 from intelligence_dossiers d left join leads l on l.id=d.lead_id left join clients c on c.id=d.client_id
            where d.scope_key=w.scope_key and (d.lead_id is null or l.account_id is null)
            and (member.role<>'agent' or coalesce(c.agent_user_id,l.agent_user_id) is null or coalesce(c.agent_user_id,l.agent_user_id)=member.user_id))
          then w.snapshot->>'evidence_token'=get_opportunity_context(member.user_id,w.target_type,w.target_id)->>'evidence_token' else false end)
      order by (case snapshot->>'target_status' when 'targeted' then 0 when 'outside_target' then 2 else 1 end),
        (case snapshot->'assessment'->>'status' when 'possible_fit' then 0 when 'needs_review' then 1 else 2 end),score desc,w.id limit (config->>'agent_capacity')::integer
    ) ranked;
    if jsonb_array_length(chosen)>0 then
      insert into opportunity_digests(actor_id,local_day,items) values(member.user_id,local_now::date,chosen);
      update opportunity_watches set last_digest_fingerprint=md5((snapshot-'evidence_token'-'evaluated_on')::text)
        where id in (select (item->>'watch_id')::uuid from jsonb_array_elements(chosen) item);
      n:=n+1;
    end if;
  end loop;
  return n;
end;
$$;

create function public.get_opportunity_dashboard(p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare member agency_members; result jsonb;
begin
  select * into member from agency_members where user_id=p_actor and active;
  if not found then raise exception 'Active agency access is required' using errcode='42501'; end if;
  select jsonb_build_object(
    'settings',(select to_jsonb(s) from opportunity_settings s where id=1),
    'watches',coalesce((select jsonb_agg(to_jsonb(w)-'snapshot'-'lease_token'-'lease_until' order by next_due_at) from opportunity_watches w where actor_id=p_actor),'[]'),
    'digests',coalesce((select jsonb_agg(jsonb_build_object('local_day',local_day,'items',coalesce((
      select jsonb_agg(jsonb_build_object('type',i->>'type','id',i->>'id','name',i->'snapshot'->>'record_name')) from jsonb_array_elements(d.items) i
        join opportunity_watches w on w.id=(i->>'watch_id')::uuid where w.actor_id=p_actor and w.enabled and (
          (w.target_type='search' and exists(select 1 from discovery_saved_searches where id=w.target_id and user_id=p_actor))
          or exists(select 1 from intelligence_dossiers ds left join leads l on l.id=ds.lead_id left join clients c on c.id=ds.client_id
            where ds.scope_key=w.scope_key and (ds.lead_id is null or l.account_id is null)
            and (member.role<>'agent' or coalesce(c.agent_user_id,l.agent_user_id) is null or coalesce(c.agent_user_id,l.agent_user_id)=p_actor))
        )),'[]'),'created_at',created_at) order by local_day desc)
      from (select * from opportunity_digests where actor_id=p_actor order by local_day desc limit 20) d),'[]'),
    'searches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from discovery_saved_searches where user_id=p_actor),'[]'),
    'outcomes',coalesce((select jsonb_agg(jsonb_build_object('scope_key',e.scope_key,'payload',e.payload,'created_at',e.created_at))
      from opportunity_operation_events e join intelligence_dossiers d on d.scope_key=e.scope_key
      left join leads l on l.id=d.lead_id left join clients c on c.id=d.client_id where e.kind='outcome'
      and not exists(select 1 from opportunity_operation_events correction where correction.kind='outcome' and correction.payload->>'supersedes'=e.id::text)
      and (member.role<>'agent' or coalesce(c.agent_user_id,l.agent_user_id) is null or coalesce(c.agent_user_id,l.agent_user_id)=p_actor)
      and (d.lead_id is null or l.account_id is null)),'[]'),
    'can_manage',member.role='owner'
    ,'scheduler',jsonb_build_object('configured',(crm_scheduler_status()->>'configured')::boolean,
      'active',coalesce((select active from cron.job where jobname='crm-opportunity-intelligence'),false),
      'last_job_at',(select max(h.started_at) from opportunity_job_history h join opportunity_watches w on w.id=h.watch_id where w.actor_id=p_actor))
  ) into result;
  return result;
end;
$$;

create function public.queue_opportunity_intelligence()
returns bigint language plpgsql security definer set search_path=public as $$
declare endpoint text; secret text; request_id bigint;
begin
  if not (select (config->>'recurring_enabled')::boolean from opportunity_settings where id=1) then return null; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='crm_heartbeat_endpoint';
  select decrypted_secret into secret from vault.decrypted_secrets where name='crm_heartbeat_authorization';
  if endpoint!~'^https://[^/]+/api/cron/heartbeat$' or endpoint is null or nullif(secret,'') is null then
    raise exception 'OIP heartbeat credentials are not configured' using errcode='22023'; end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
    body:=jsonb_build_object('job','opportunity-intelligence'),timeout_milliseconds:=65000) into request_id;
  return request_id;
end;
$$;
do $$
declare job bigint;
begin
  job:=cron.schedule('crm-opportunity-intelligence','*/5 * * * *','select public.queue_opportunity_intelligence()');
  perform cron.alter_job(job,active:=false);
end;
$$;
revoke all on function public.queue_opportunity_intelligence() from public,anon,authenticated,service_role;

create function public.refresh_opportunity_watches()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update opportunity_watches set next_due_at=least(next_due_at,clock_timestamp()) where enabled and attempts<5;
  return null;
end;
$$;
revoke all on function public.refresh_opportunity_watches() from public,anon,authenticated,service_role;
do $$
declare tab text;
begin
  foreach tab in array array['opportunity_profiles','opportunity_operation_events','opportunity_settings','intelligence_dossier_confirmations',
    'intelligence_enrichment_observations','intelligence_import_evidence','carrier_appetite_documents','agency_members','outreach_settings','communication_log',
    'clients','leads','policies','client_files','discovery_saved_searches'] loop
    execute format('create trigger opportunity_evidence_changed after insert or update or delete on public.%I for each statement execute function public.refresh_opportunity_watches()',tab);
  end loop;
end;
$$;

alter function public.get_opportunity_context(uuid,text,uuid) rename to get_opportunity_core_context;
revoke all on function public.get_opportunity_core_context(uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.get_opportunity_context(p_actor uuid,p_type text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare value jsonb; operations jsonb; conversations text; consent jsonb;
begin
  value:=get_opportunity_core_context(p_actor,p_type,p_id)-'evidence_token';
  operations:=get_opportunity_operations(p_actor,p_type,p_id);
  select md5(coalesce(string_agg(to_jsonb(c)::text,'|' order by c.id),'')) into conversations
    from (select id,direction,subject,body,sent_at,metadata from canonical_communications
      where conversation_key=value->'dossier'->>'scope_key' order by sent_at desc,id desc limit 12) c;
  select jsonb_agg(jsonb_build_object('id',user_id,'active',active,'opt_in',gmail_ai_opt_in) order by user_id) into consent from agency_members;
  value:=value||jsonb_build_object('operations',operations-'watch'-'outcomes',
    'conversation_fingerprint',conversations,'conversation_permissions',consent,
    'settings',(select config from opportunity_settings where id=1));
  return value||jsonb_build_object('evidence_token',md5(value::text));
end;
$$;

revoke all on function public.save_opportunity_settings(uuid,integer,jsonb),public.opportunity_operation(uuid,text,uuid,uuid,text,jsonb),
  public.get_opportunity_operations(uuid,text,uuid),public.set_opportunity_watch(uuid,text,uuid,boolean),
  public.claim_opportunity_jobs(integer),public.finish_opportunity_job(uuid,uuid,jsonb,text),public.build_opportunity_digests(),
  public.get_opportunity_dashboard(uuid),public.get_opportunity_context(uuid,text,uuid),
  public.share_opportunity_questionnaire(uuid,text,uuid,uuid,text,boolean),public.public_opportunity_questionnaire(text,text,boolean) from public,anon,authenticated;
grant execute on function public.save_opportunity_settings(uuid,integer,jsonb),public.opportunity_operation(uuid,text,uuid,uuid,text,jsonb),
  public.get_opportunity_operations(uuid,text,uuid),public.set_opportunity_watch(uuid,text,uuid,boolean),
  public.claim_opportunity_jobs(integer),public.finish_opportunity_job(uuid,uuid,jsonb,text),public.build_opportunity_digests(),
  public.get_opportunity_dashboard(uuid),public.get_opportunity_context(uuid,text,uuid),
  public.share_opportunity_questionnaire(uuid,text,uuid,uuid,text,boolean),public.public_opportunity_questionnaire(text,text,boolean) to service_role;
commit;
