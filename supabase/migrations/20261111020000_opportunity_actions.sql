begin;
create table public.opportunity_profiles (
  scope_key text primary key references public.intelligence_dossiers(scope_key),
  revision integer not null check(revision>0),
  profile jsonb not null check(jsonb_typeof(profile)='object'),
  verified_recipient text,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.opportunity_profile_history (
  scope_key text not null references public.opportunity_profiles(scope_key),
  revision integer not null,
  profile jsonb not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(scope_key,revision)
);
create table public.opportunity_drafts (
  id uuid primary key,
  scope_key text not null references public.intelligence_dossiers(scope_key),
  actor_id uuid not null references auth.users(id),
  revision integer not null check(revision>0),
  state text not null default 'draft' check(state in ('draft','approved','dispatching','sent','uncertain')),
  evidence_token text not null,
  subject text not null check(length(subject) between 1 and 200),
  body text not null check(length(body) between 1 and 6000),
  request_id uuid not null unique,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.opportunity_action_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.opportunity_drafts(id),
  scope_key text not null references public.intelligence_dossiers(scope_key),
  actor_id uuid not null references auth.users(id),
  action text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index opportunity_latest_drafts on public.opportunity_drafts(actor_id,scope_key,updated_at desc,id);
alter table public.opportunity_profiles enable row level security;
alter table public.opportunity_profile_history enable row level security;
alter table public.opportunity_drafts enable row level security;
alter table public.opportunity_action_events enable row level security;
revoke all on public.opportunity_profiles,public.opportunity_profile_history,public.opportunity_drafts,public.opportunity_action_events from public,anon,authenticated,service_role;
grant select on public.opportunity_profiles,public.opportunity_profile_history,public.opportunity_drafts,public.opportunity_action_events to service_role;

create function public.get_opportunity_context(p_actor uuid,p_type text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare dossier jsonb; profile opportunity_profiles; carriers jsonb; recipient text; value jsonb;
begin
  dossier:=get_intelligence_dossier(p_actor,p_type,p_id,0);
  select * into profile from opportunity_profiles where scope_key=dossier->>'scope_key';
  if dossier->>'client_id' is not null then select email into recipient from clients where id=(dossier->>'client_id')::uuid;
  else select email into recipient from leads where id=p_id; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'state',state,'values',"values",
    'file_name',file_name,'storage_path','','pages','[]'::jsonb,'approved_by',approved_by,'approved_at',approved_at) order by id),'[]')
    into carriers from carrier_appetite_documents where state='active';
  if jsonb_array_length(carriers)>1000 then raise exception 'More than 1000 active carrier documents need a scoped evaluation before matching' using errcode='22023'; end if;
  value:=jsonb_build_object('dossier',dossier,'profile',jsonb_build_object('scope_key',dossier->>'scope_key',
    'revision',coalesce(profile.revision,0),'profile',case when profile.profile->>'contactability'='verified_email'
      and (profile.verified_recipient is distinct from recipient or nullif(recipient,'') is null)
      then jsonb_set(profile.profile,'{contactability}','"unknown"') else profile.profile end),'carriers',carriers,'recipient',recipient,
    'sending_identity',(select jsonb_build_object('agent',sender_profile,'agency',(select sender_profile from outreach_settings where id=1))
      from agency_members where user_id=p_actor),
    'evaluated_on',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD'),'algorithm','market-fit-v1');
  return value||jsonb_build_object('evidence_token',md5(value::text));
end;
$$;
create function public.save_opportunity_profile(p_actor uuid,p_type text,p_id uuid,p_scope text,p_expected integer,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb; saved opportunity_profiles; field text; fact jsonb; day date; recipient text;
begin
  perform pg_advisory_xact_lock(hashtextextended('intelligence-dossier-write',0));
  scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
  if p_scope is distinct from scope->>'scope_key' then raise exception 'Record linkage changed. Reload this opportunity.' using errcode='PT409'; end if;
  if p_expected is null or p_expected<0 or jsonb_typeof(p_profile) is distinct from 'object'
    or jsonb_typeof(p_profile->'facts') is distinct from 'object'
    or coalesce(length(trim(p_profile->>'source_reference')),0) not between 1 and 1000
    or p_profile->>'confirmed_on' is null or p_profile->>'confirmed_on'!~'^\d{4}-\d{2}-\d{2}$'
    or p_profile->>'permission' is null or p_profile->>'permission' not in ('unknown','permitted','do_not_contact')
    or p_profile->>'contactability' is null or p_profile->>'contactability' not in ('unknown','verified_email','verified_phone')
    or p_profile->>'relationship' is null or p_profile->>'relationship' not in ('unknown','new','referred','existing_client') then
    raise exception 'Record permissioned business facts and their source date' using errcode='22023'; end if;
  day:=(p_profile->>'confirmed_on')::date;
  if day>current_date or to_char(day,'YYYY-MM-DD')<>p_profile->>'confirmed_on' then raise exception 'Use a valid non-future confirmation date' using errcode='22023'; end if;
  for field,fact in select key,value from jsonb_each(p_profile->'facts') loop
    if field not in ('state','line','class_code','industry','years_in_business','annual_revenue','power_units','operating_radius_miles','has_delivery','has_prior_losses')
      or jsonb_typeof(fact)<>'string' or length(fact#>>'{}')>200 then
      raise exception 'Only supported business facts can be matched' using errcode='22023'; end if;
  end loop;
  insert into intelligence_dossiers(scope_key,lead_id,client_id) values(p_scope,(scope->>'lead_id')::uuid,(scope->>'client_id')::uuid) on conflict do nothing;
  if scope->>'client_id' is not null then select email into recipient from clients where id=(scope->>'client_id')::uuid;
  else select email into recipient from leads where id=p_id; end if;
  if p_profile->>'contactability'<>'verified_email' then recipient:=null; end if;
  if p_profile->>'contactability'='verified_email' and nullif(recipient,'') is null then raise exception 'Record an email on this business before verifying its email route' using errcode='22023'; end if;
  select * into saved from opportunity_profiles where scope_key=p_scope for update;
  if saved.revision=p_expected+1 and saved.profile=p_profile and saved.verified_recipient is not distinct from recipient then return to_jsonb(saved); end if;
  if coalesce(saved.revision,0)<>p_expected then raise exception 'Business facts changed. Reload before saving.' using errcode='PT409'; end if;
  insert into opportunity_profiles(scope_key,revision,profile,verified_recipient,updated_by) values(p_scope,1,p_profile,recipient,p_actor)
    on conflict(scope_key) do update set profile=excluded.profile,revision=opportunity_profiles.revision+1,updated_by=p_actor,updated_at=clock_timestamp()
      ,verified_recipient=excluded.verified_recipient
    returning * into saved;
  insert into opportunity_profile_history(scope_key,revision,profile,actor_id) values(saved.scope_key,saved.revision,saved.profile,p_actor);
  return to_jsonb(saved);
end;
$$;

create function public.opportunity_queue(p_actor uuid,p_page integer default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare member agency_members; items jsonb;
begin
  select * into member from agency_members where user_id=p_actor and active;
  if not found then raise exception 'Active agency access is required' using errcode='42501'; end if;
  if p_page is null or p_page not between 0 and 10000 then raise exception 'Choose a valid queue page' using errcode='22023'; end if;
  with permitted as (
    select p.scope_key,p.updated_at,'lead'::text as type,l.id,l.full_name as name from opportunity_profiles p
      join intelligence_dossiers d on d.scope_key=p.scope_key join leads l on l.id=d.lead_id
      where l.account_id is null and (member.role<>'agent' or l.agent_user_id is null or l.agent_user_id=p_actor)
    union all
    select p.scope_key,p.updated_at,'client',c.id,c.full_name from opportunity_profiles p
      join intelligence_dossiers d on d.scope_key=p.scope_key join clients c on c.id=d.client_id
      where member.role<>'agent' or c.agent_user_id is null or c.agent_user_id=p_actor
  ) select coalesce(jsonb_agg(to_jsonb(rows) order by scope_key),'[]') into items from (
    select * from permitted
  ) rows;
  return jsonb_build_object('items',items);
end;
$$;

create function public.save_opportunity_draft(p_actor uuid,p_type text,p_id uuid,p_draft uuid,p_expected integer,
  p_action text,p_token text,p_subject text,p_body text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare context jsonb; saved opportunity_drafts; profile jsonb; permission_date date;
begin
  perform pg_advisory_xact_lock(hashtextextended('intelligence-dossier-write',0));
  context:=get_opportunity_context(p_actor,p_type,p_id);
  if p_token is distinct from context->>'evidence_token' then raise exception 'Evidence changed or expired. Reload the opportunity and prepare a new draft.' using errcode='PT409'; end if;
  perform pg_advisory_xact_lock(hashtextextended('opportunity-draft:'||p_draft::text,0));
  select * into saved from opportunity_drafts where id=p_draft for update;
  if saved.id is not null and (saved.actor_id<>p_actor or saved.scope_key<>context->'dossier'->>'scope_key') then
    raise exception 'This draft belongs to another agent or opportunity' using errcode='42501'; end if;
  if p_draft is null or p_expected is null or p_expected<0 then raise exception 'Provide a draft ID and revision' using errcode='22023'; end if;
  if saved.state in ('dispatching','sent','uncertain') then
    raise exception 'Delivery was started. Check conversation history; do not retry as a new send.' using errcode='PT409'; end if;
  if p_action='save' then
    if length(trim(p_subject)) not between 1 and 200 or length(trim(p_body)) not between 1 and 6000 then
      raise exception 'Provide a subject and reviewed message' using errcode='22023'; end if;
    if saved.revision=p_expected+1 and saved.subject=p_subject and saved.body=p_body and saved.evidence_token=p_token and saved.state='draft' then return to_jsonb(saved); end if;
    if coalesce(saved.revision,0)<>p_expected then raise exception 'Draft changed. Reload before editing.' using errcode='PT409'; end if;
    if not exists(select 1 from opportunity_profiles where scope_key=context->'dossier'->>'scope_key') then
      raise exception 'Save the reviewed business facts first' using errcode='22023'; end if;
    insert into opportunity_drafts(id,scope_key,actor_id,revision,evidence_token,subject,body,request_id)
      values(p_draft,context->'dossier'->>'scope_key',p_actor,1,p_token,p_subject,p_body,gen_random_uuid())
      on conflict(id) do update set subject=p_subject,body=p_body,evidence_token=p_token,state='draft',
        revision=opportunity_drafts.revision+1,approved_at=null,request_id=gen_random_uuid(),updated_at=clock_timestamp()
      returning * into saved;
  elsif p_action='approve' then
    if saved.id is null or saved.revision<>p_expected or saved.evidence_token<>p_token then raise exception 'Draft changed. Reload before approval.' using errcode='PT409'; end if;
    if saved.subject is distinct from p_subject or saved.body is distinct from p_body then raise exception 'Save the exact outgoing text before approval' using errcode='PT409'; end if;
    profile:=context->'profile'->'profile';
    permission_date:=nullif(profile->>'confirmed_on','')::date;
    if profile->>'permission' is distinct from 'permitted' or profile->>'contactability' is distinct from 'verified_email'
      or permission_date is null or permission_date<(context->>'evaluated_on')::date-90 or permission_date>(context->>'evaluated_on')::date
      or nullif(context->>'recipient','') is null then
      raise exception 'Confirm a current permitted email route before approval. This does not enroll a campaign.' using errcode='22023'; end if;
    update opportunity_drafts set state='approved',approved_at=clock_timestamp() where id=p_draft returning * into saved;
  else raise exception 'Choose save or approve' using errcode='22023'; end if;
  insert into opportunity_action_events(draft_id,scope_key,actor_id,action,snapshot)
    values(saved.id,saved.scope_key,p_actor,p_action,to_jsonb(saved)||jsonb_build_object('context',context));
  return to_jsonb(saved);
end;
$$;

create function public.claim_opportunity_send(p_actor uuid,p_type text,p_id uuid,p_draft uuid,p_request uuid,p_subject text,p_body text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare context jsonb; saved opportunity_drafts;
begin
  perform pg_advisory_xact_lock(hashtextextended('intelligence-dossier-write',0));
  context:=get_opportunity_context(p_actor,p_type,p_id);
  select * into saved from opportunity_drafts where id=p_draft for update;
  if saved.id is null or saved.actor_id<>p_actor or saved.scope_key<>context->'dossier'->>'scope_key'
    or saved.request_id is distinct from p_request or saved.subject is distinct from p_subject or saved.body is distinct from p_body then
    raise exception 'Use the exact reviewed draft and its send reference' using errcode='42501'; end if;
  if saved.state<>'approved' then raise exception 'This draft is not approved or delivery already started. Check history before any retry.' using errcode='PT409'; end if;
  if saved.evidence_token<>context->>'evidence_token' then raise exception 'Evidence changed or expired. Rebuild and review the draft before sending.' using errcode='PT409'; end if;
  if context->'profile'->'profile'->>'permission' is distinct from 'permitted'
    or context->'profile'->'profile'->>'contactability' is distinct from 'verified_email'
    or nullif(context->'profile'->'profile'->>'confirmed_on','')::date<(context->>'evaluated_on')::date-90
    or nullif(context->>'recipient','') is null then raise exception 'Contact permission needs reconfirmation' using errcode='42501'; end if;
  update opportunity_drafts set state='dispatching',updated_at=clock_timestamp() where id=p_draft returning * into saved;
  insert into opportunity_action_events(draft_id,scope_key,actor_id,action,snapshot) values(saved.id,saved.scope_key,p_actor,'dispatching',to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;
create function public.finish_opportunity_send(p_actor uuid,p_draft uuid,p_state text)
returns void language plpgsql security definer set search_path=public as $$
declare saved opportunity_drafts;
begin
  if p_state not in ('sent','uncertain') then raise exception 'Choose a delivery outcome' using errcode='22023'; end if;
  update opportunity_drafts set state=p_state,updated_at=clock_timestamp() where id=p_draft and actor_id=p_actor and state='dispatching' returning * into saved;
  if saved.id is null then raise exception 'Delivery claim not found. Check conversation history.' using errcode='PT409'; end if;
  insert into opportunity_action_events(draft_id,scope_key,actor_id,action,snapshot) values(saved.id,saved.scope_key,p_actor,p_state,to_jsonb(saved));
end;
$$;
create function public.create_opportunity_task(p_actor uuid,p_type text,p_id uuid,p_token text,p_task uuid,p_due timestamptz,p_assignee uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare context jsonb; member agency_members; assignee agency_members; saved tasks; scope jsonb; href text;
begin
  perform pg_advisory_xact_lock(hashtextextended('intelligence-dossier-write',0));
  context:=get_opportunity_context(p_actor,p_type,p_id);
  if context->>'evidence_token' is distinct from p_token then raise exception 'Evidence changed. Reload before assigning a task.' using errcode='PT409'; end if;
  if context->'profile'->>'revision'='0' then raise exception 'Save the reviewed business facts before creating an opportunity task' using errcode='22023'; end if;
  select * into member from agency_members where user_id=p_actor and active;
  select * into assignee from agency_members where user_id=p_assignee and active;
  if assignee.user_id is null or (member.role='agent' and p_assignee<>p_actor) then raise exception 'Choose an active agent you may assign' using errcode='42501'; end if;
  perform intelligence_dossier_scope(p_assignee,p_type,p_id);
  if p_task is null or p_due is null then raise exception 'Choose a task ID and due time' using errcode='22023'; end if;
  scope:=context->'dossier';
  href:='/leads/opportunities?type='||p_type||'&id='||p_id;
  select * into saved from tasks where id=p_task for update;
  if saved.id is not null then
    if saved.created_by=p_actor::text and saved.action_href=href and saved.due_date=p_due and saved.assignee=assignee.email then return to_jsonb(saved); end if;
    raise exception 'This task reference is already used' using errcode='PT409'; end if;
  insert into tasks(id,subject,description,due_date,status,priority,related_type,related_id,account_id,created_by,assignee,action_href,action_category)
    values(p_task,left((scope->>'record_name')||': Review market fit and missing evidence',240),
      'Review the current opportunity evidence before contacting the business. Evidence snapshot: '||p_token,p_due,'open','medium',
      p_type,p_id,(scope->>'client_id')::uuid,p_actor::text,assignee.email,href,'opportunity')
    returning * into saved;
  insert into opportunity_action_events(scope_key,actor_id,action,snapshot)
    values(scope->>'scope_key',p_actor,'task',jsonb_build_object('task',to_jsonb(saved),'context',context));
  return to_jsonb(saved);
end;
$$;
revoke all on function public.get_opportunity_context(uuid,text,uuid),public.save_opportunity_profile(uuid,text,uuid,text,integer,jsonb),
  public.opportunity_queue(uuid,integer),public.save_opportunity_draft(uuid,text,uuid,uuid,integer,text,text,text,text),
  public.claim_opportunity_send(uuid,text,uuid,uuid,uuid,text,text),public.finish_opportunity_send(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_opportunity_context(uuid,text,uuid),public.save_opportunity_profile(uuid,text,uuid,text,integer,jsonb),
  public.opportunity_queue(uuid,integer),public.save_opportunity_draft(uuid,text,uuid,uuid,integer,text,text,text,text),
  public.claim_opportunity_send(uuid,text,uuid,uuid,uuid,text,text),public.finish_opportunity_send(uuid,uuid,text) to service_role;
revoke all on function public.create_opportunity_task(uuid,text,uuid,text,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.create_opportunity_task(uuid,text,uuid,text,uuid,timestamptz,uuid) to service_role;
commit;
