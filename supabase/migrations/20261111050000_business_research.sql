begin;

create table public.business_research_sources (
  provider text primary key check(provider in ('fmcsa_census','osm','irs')),
  enabled boolean not null default false,
  retained_rights boolean not null default true,
  reference text not null,
  revision integer not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  last_request_at timestamptz
);
insert into public.business_research_sources(provider,reference) values
 ('fmcsa_census','https://catalog.data.gov/dataset/company-census-file'),
 ('osm','https://www.openstreetmap.org/copyright'),
 ('irs','https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf');
create table public.business_research_entities (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,
  name text not null check(length(name) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.business_research_keys (
  provider text not null references public.business_research_sources(provider),
  record_id text not null,
  business_id uuid not null references public.business_research_entities(id) on delete cascade,
  primary key(provider,record_id)
);
create table public.business_research_observations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_research_entities(id) on delete cascade,
  provider text not null references public.business_research_sources(provider),
  record_id text not null,
  fingerprint text not null,
  observation jsonb not null check(jsonb_typeof(observation)='object'),
  fetched_at timestamptz not null default now(),
  unique(business_id,provider,record_id,fingerprint)
);
create index business_research_observation_history on public.business_research_observations(business_id,provider,record_id,fetched_at desc,id);
create table public.business_research_links (
  business_id uuid primary key references public.business_research_entities(id) on delete cascade,
  lead_id uuid unique references public.leads(id) on delete cascade,
  client_id uuid unique references public.clients(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  check(num_nonnulls(lead_id,client_id)=1)
);
create table public.business_research_runs (
  id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  query_hash text not null,
  filters jsonb not null,
  page integer not null check(page between 0 and 1000),
  business_ids uuid[] not null,
  coverage jsonb not null,
  has_more boolean not null default false,
  created_at timestamptz not null default now()
);
create index business_research_run_cache on public.business_research_runs(query_hash,created_at desc);
create table public.business_research_jobs (
  business_id uuid primary key references public.business_research_entities(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','processing','complete','failed')),
  lease uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  error text,
  result jsonb,
  due_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.business_research_territories (
  query_hash text primary key,
  bounds jsonb not null,
  fetched_at timestamptz not null default now()
);
create table public.business_research_settings (
  id integer primary key check(id=1),
  enabled boolean not null default false,
  tasks_enabled boolean not null default false,
  task_capacity integer not null default 10 check(task_capacity between 1 and 100),
  task_due_days integer not null default 1 check(task_due_days between 1 and 30),
  refresh_days integer not null default 7 check(refresh_days between 1 and 365),
  revision integer not null default 0,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.business_research_settings(id) values(1);
create table public.business_research_task_receipts (
  business_id uuid not null references public.business_research_entities(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  scope_key text not null,
  kind text not null check(kind in ('contact_research','business_review')),
  task_id uuid unique references public.tasks(id) on delete set null,
  assignee_id uuid not null,
  created_at timestamptz not null default now(),
  check(num_nonnulls(lead_id,client_id)=1),
  primary key(business_id,scope_key,kind)
);
create index business_research_task_budget on public.business_research_task_receipts(assignee_id,created_at);
create table public.business_research_request_slots (
 name text primary key,
 requested_at timestamptz not null
);
create table public.business_research_setting_events (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references auth.users(id),
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
do $$
declare tab text;
begin
 foreach tab in array array['business_research_sources','business_research_entities','business_research_keys',
 'business_research_observations','business_research_links','business_research_runs','business_research_jobs',
 'business_research_territories','business_research_settings','business_research_task_receipts',
 'business_research_request_slots','business_research_setting_events'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
 end loop;
end $$;

create function public.research_request_slot(p_name text,p_seconds integer)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_name not in ('nominatim','overpass','census_geocoder','nws','fema','irs_990','directory:irs','directory:dol_5500','directory:osm') or p_seconds<1 or p_seconds>3600 then
  raise exception 'Invalid public request budget' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('research-request:'||p_name,0));
 if exists(select 1 from business_research_request_slots where name=p_name and requested_at>clock_timestamp()-make_interval(secs=>p_seconds)) then return false; end if;
 insert into business_research_request_slots(name,requested_at) values(p_name,clock_timestamp())
  on conflict(name) do update set requested_at=excluded.requested_at;
 return true;
end $$;

create function public.research_source_slot(p_provider text)
returns boolean language plpgsql security definer set search_path=public as $$
declare saved business_research_sources;
begin
 select * into saved from business_research_sources where provider=p_provider for update;
 if not found or not saved.enabled or not saved.retained_rights then return false; end if;
 if saved.last_request_at>clock_timestamp()-interval '3 seconds' then return false; end if;
 update business_research_sources set last_request_at=clock_timestamp() where provider=p_provider;
 return true;
end $$;

create function public.retain_research_observation(p_actor uuid,p_identity text,p_observation jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare business uuid; v_provider text:=p_observation->>'source'; v_record text:=p_observation->>'record_id'; incoming_dot text; existing_dot text; changed boolean;
 incoming_ein text; existing_ein text;
begin
 if not exists(select 1 from agency_members where user_id=p_actor and active) then raise exception 'Active agency access required' using errcode='42501'; end if;
 if not(select enabled from business_research_settings where id=1) then raise exception 'Business research is paused' using errcode='PT409'; end if;
 if not exists(select 1 from business_research_sources s where s.provider=v_provider and s.enabled and s.retained_rights) then
  raise exception 'Research source is not enabled for retained use' using errcode='42501'; end if;
 if p_identity is null or p_identity!~'^[a-f0-9]{64}$' or nullif(v_record,'') is null or length(v_record)>200 or
   nullif(p_observation->'values'->>'name','') is null or length(p_observation->'values'->>'name')>300 or
   jsonb_typeof(p_observation->'values') is distinct from 'object' then raise exception 'Invalid business observation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('research-identity',0));
 select k.business_id into business from business_research_keys k where k.provider=v_provider and k.record_id=v_record;
 if business is null then
  select id into business from business_research_entities where identity_key=p_identity;
  incoming_dot:=p_observation->'values'->>'dot';
  incoming_ein:=p_observation->'values'->>'ein';
  if business is not null and incoming_dot is not null then
   select observation->'values'->>'dot' into existing_dot from business_research_observations
    where business_id=business and observation->'values'->>'dot' is not null limit 1;
   if existing_dot is not null and existing_dot<>incoming_dot then business:=null; p_identity:=md5(v_provider||':'||v_record)||md5(v_record||':'||v_provider); end if;
  end if;
  if business is not null and incoming_ein is not null then
   select observation->'values'->>'ein' into existing_ein from business_research_observations
    where business_id=business and observation->'values'->>'ein' is not null limit 1;
   if existing_ein is not null and existing_ein<>incoming_ein then business:=null; p_identity:=md5(v_provider||':'||v_record)||md5(v_record||':'||v_provider); end if;
  end if;
  if business is null then
   insert into business_research_entities(identity_key,name) values(p_identity,p_observation->'values'->>'name')
    on conflict(identity_key) do update set updated_at=clock_timestamp() returning id into business;
  end if;
  insert into business_research_keys(provider,record_id,business_id) values(v_provider,v_record,business);
 end if;
 select not exists(select 1 from business_research_observations where business_id=business and provider=v_provider and record_id=v_record
  and fingerprint=md5((p_observation-'fetched_at')::text)) into changed;
 insert into business_research_observations(business_id,provider,record_id,fingerprint,observation)
  values(business,v_provider,v_record,md5((p_observation-'fetched_at')::text),p_observation)
  on conflict(business_id,provider,record_id,fingerprint) do update set observation=excluded.observation,fetched_at=clock_timestamp();
 update business_research_entities set updated_at=clock_timestamp() where id=business;
 insert into business_research_jobs(business_id,actor_id) values(business,p_actor) on conflict do nothing;
 if changed then
  update business_research_jobs set result=null where business_id=business;
  update business_research_jobs set state='pending',attempts=0,error=null,due_at=clock_timestamp(),updated_at=clock_timestamp()
   where business_id=business and state<>'processing';
 end if;
 return business;
end $$;

create function public.refresh_business_research_appetite()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='INSERT' and NEW.state<>'active' then return null; end if;
 if TG_OP='DELETE' and OLD.state<>'active' then return null; end if;
 if TG_OP='UPDATE' then
  if NEW.state<>'active' and OLD.state<>'active' then return null; end if;
  if (NEW.state,NEW.revision,NEW."values",NEW.approved_by,NEW.approved_at) is not distinct from
   (OLD.state,OLD.revision,OLD."values",OLD.approved_by,OLD.approved_at) then return null; end if;
 end if;
 update business_research_entities set updated_at=clock_timestamp() where id in (
  select j.business_id from business_research_jobs j where j.state='processing' or j.updated_at>clock_timestamp()-interval '1 day'
   or exists(select 1 from business_research_links l where l.business_id=j.business_id)
 );
 update business_research_jobs j set result=null,due_at=clock_timestamp(),updated_at=clock_timestamp(),
  state=case when state='processing' then state else 'pending' end,attempts=case when state='processing' then attempts else 0 end
  where j.state='processing' or j.updated_at>clock_timestamp()-interval '1 day'
   or exists(select 1 from business_research_links l where l.business_id=j.business_id);
 return null;
end $$;
create trigger business_research_appetite_changed after insert or update or delete on public.carrier_appetite_documents
 for each row execute function public.refresh_business_research_appetite();
revoke all on function public.refresh_business_research_appetite() from public,anon,authenticated,service_role;

create function public.get_business_research(p_actor uuid,p_business uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare entity business_research_entities; observations jsonb; member agency_members; link business_research_links; related jsonb; lead leads; client clients; job business_research_jobs;
begin
 select * into member from agency_members where user_id=p_actor and active;
 if not found then raise exception 'Active agency access required' using errcode='42501'; end if;
 select * into entity from business_research_entities where id=p_business;
 if not found then raise exception 'Research business not found' using errcode='P0002'; end if;
 select coalesce(jsonb_agg(observation order by fetched_at desc),'[]') into observations from
  (select distinct on(o.provider,o.record_id) o.observation,o.fetched_at from business_research_observations o
   join business_research_sources s on s.provider=o.provider and s.retained_rights
   where o.business_id=p_business order by o.provider,o.record_id,o.fetched_at desc,o.id desc) latest;
 if jsonb_array_length(observations)=0 then raise exception 'No permitted source observations remain' using errcode='42501'; end if;
 select * into link from business_research_links where business_id=p_business;
 if link.lead_id is not null then select * into lead from leads where id=link.lead_id; end if;
 if coalesce(link.client_id,lead.account_id) is not null then select * into client from clients where id=coalesce(link.client_id,lead.account_id); end if;
 if link.business_id is not null and (member.role<>'agent' or
    (lead.agent_user_id is null or lead.agent_user_id=p_actor) and (client.agent_user_id is null or client.agent_user_id=p_actor)) then
  related:=case when client.id is not null then jsonb_build_object('type','client','id',client.id) else jsonb_build_object('type','lead','id',lead.id) end;
 end if;
 select * into job from business_research_jobs where business_id=p_business;
 return jsonb_build_object('business',jsonb_build_object('id',entity.id,'name',entity.name,'observations',observations,
  'updated_at',entity.updated_at,'status',case when job.state='complete' and job.due_at>clock_timestamp() and not exists(select 1 from jsonb_array_elements(job.result->'coverage') c where c->>'state'='unavailable') then 'ready' else 'partial' end),
  'linked_record',related,'job',case when job.business_id is null then null else jsonb_build_object(
   'state',case when job.state='complete' and job.due_at<=clock_timestamp() then 'pending' else job.state end,
   'paused',not(select enabled from business_research_settings where id=1),'error',job.error,
   'result',case when job.state='complete' and job.due_at>clock_timestamp() and not exists(select 1 from business_research_sources where not retained_rights) then job.result else null end) end);
end $$;

create function public.research_match_context(p_actor uuid,p_business uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare profile jsonb; entity business_research_entities; contact jsonb; matches jsonb; full_address text;
begin
 profile:=get_business_research(p_actor,p_business);
 select * into entity from business_research_entities where id=p_business;
 select jsonb_object_agg(key,value) into contact from (
  select distinct on(e.key) e.key,e.value from jsonb_array_elements(profile->'business'->'observations') with ordinality o(observation,position)
   cross join lateral jsonb_each(o.observation->'values') e where e.value<>'null'::jsonb order by e.key,o.position
 ) fields;
 if (select count(distinct regexp_replace(regexp_replace(o->'values'->>'phone','[^0-9]','','g'),'^1([0-9]{10})$','\1')) from jsonb_array_elements(profile->'business'->'observations') o)>1 then
  contact:=contact||'{"phone":null}'::jsonb; end if;
 if (select count(distinct lower(o->'values'->>'email')) from jsonb_array_elements(profile->'business'->'observations') o)>1 then
  contact:=contact||'{"email":null}'::jsonb; end if;
 full_address:=nullif(concat_ws(', ',nullif(contact->>'street',''),nullif(contact->>'city',''),nullif(contact->>'state',''),nullif(contact->>'zip','')),'');
 select coalesce(jsonb_agg(candidate),'[]') into matches from (
  select case when account_id is null then 'lead' else 'client' end as type,coalesce(account_id,id) as id from leads where (
   (nullif(contact->>'dot','') is not null and (form_payload#>>'{profile,dot,number}'=contact->>'dot' or form_payload#>>'{profile,enrichment,fmcsa,dot_number}'=contact->>'dot'))
   or (nullif(contact->>'street','') is not null and nullif(contact->>'zip','') is not null
    and lower(regexp_replace(full_name,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(entity.name,'[^a-zA-Z0-9]','','g'))
    and lower(regexp_replace(address,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(full_address,'[^a-zA-Z0-9]','','g'))))
   and not exists(select 1 from unnest(array[form_payload#>>'{profile,dot,number}',form_payload#>>'{profile,enrichment,fmcsa,dot_number}']) known(dot)
    where nullif(known.dot,'') is not null and known.dot<>contact->>'dot')
  union all
  select 'client',id from clients where nullif(contact->>'street','') is not null and nullif(contact->>'zip','') is not null
    and lower(regexp_replace(full_name,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(entity.name,'[^a-zA-Z0-9]','','g'))
    and lower(regexp_replace(address,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(full_address,'[^a-zA-Z0-9]','','g'))
    and not exists(select 1 from leads l cross join lateral unnest(array[l.form_payload#>>'{profile,dot,number}',l.form_payload#>>'{profile,enrichment,fmcsa,dot_number}']) known(dot)
     where l.account_id=clients.id and nullif(known.dot,'') is not null and known.dot<>contact->>'dot')
 ) candidate;
 select coalesce(jsonb_agg(distinct value),'[]') into matches from jsonb_array_elements(matches);
 return jsonb_build_object('matches',matches,'contact',contact,'address',full_address);
end $$;
revoke all on function public.research_match_context(uuid,uuid) from public,anon,authenticated,service_role;

create function public.save_research_business(p_actor uuid,p_business uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare context jsonb; link business_research_links; entity business_research_entities; contact jsonb; actor agency_members; saved leads;
 matches jsonb; matched jsonb; full_address text; match_count integer;
begin
 select * into actor from agency_members where user_id=p_actor and active;
 if not found then raise exception 'Active agency access required' using errcode='42501'; end if;
 select * into entity from business_research_entities where id=p_business for update;
 if not found then raise exception 'Research business not found' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended('intelligence-import-promotion',0));
 select * into link from business_research_links where business_id=p_business;
 if found then
  perform intelligence_dossier_scope(p_actor,case when link.client_id is null then 'lead' else 'client' end,coalesce(link.client_id,link.lead_id));
  return jsonb_build_object('type',case when link.client_id is null then 'lead' else 'client' end,'id',coalesce(link.client_id,link.lead_id),'already_saved',true);
 end if;
 context:=research_match_context(p_actor,p_business);
 contact:=context->'contact'; full_address:=context->>'address'; matches:=context->'matches';
 match_count:=jsonb_array_length(matches);
 if match_count>1 then raise exception 'Multiple existing identities need reconciliation. No duplicate lead was created.' using errcode='PT409'; end if;
 if match_count=1 then
  matched:=matches->0;
  perform intelligence_dossier_scope(p_actor,matched->>'type',(matched->>'id')::uuid);
  insert into business_research_links(business_id,lead_id,client_id,actor_id)
   values(p_business,case when matched->>'type'='lead' then (matched->>'id')::uuid end,
    case when matched->>'type'='client' then (matched->>'id')::uuid end,p_actor);
  update business_research_jobs set actor_id=p_actor,state='pending',attempts=0,due_at=clock_timestamp()
   where business_id=p_business and state<>'processing';
  return matched||jsonb_build_object('already_saved',true);
 end if;
 insert into leads(id,full_name,email,phone,address,business,state,status,source,agent_user_id,form_payload)
  values(gen_random_uuid(),entity.name,nullif(contact->>'email',''),nullif(contact->>'phone',''),
   full_address,
   contact->>'industry',contact->>'state','New','public_business_discovery',p_actor,
   jsonb_build_object('business_research',jsonb_build_object('business_id',p_business),'profile',
    jsonb_build_object('kind','commercial','dot',jsonb_build_object('number',contact->>'dot'),
     'company',jsonb_build_object('industry',contact->>'industry'))))
  returning * into saved;
 insert into business_research_links(business_id,lead_id,actor_id) values(p_business,saved.id,p_actor);
 update business_research_jobs set actor_id=p_actor,state='pending',attempts=0,due_at=clock_timestamp(),updated_at=clock_timestamp() where business_id=p_business and state<>'processing';
 return jsonb_build_object('type','lead','id',saved.id,'already_saved',false);
end $$;

create function public.expire_business_research_jobs()
returns void language sql security definer set search_path=public as $$
 update business_research_jobs set state='failed',lease=null,lease_until=null,
  error='Research repeatedly timed out. Review source availability before retrying.',updated_at=clock_timestamp()
  where state='processing' and lease_until<clock_timestamp() and attempts>=5;
$$;
revoke all on function public.expire_business_research_jobs() from public,anon,authenticated,service_role;

create function public.claim_business_research_jobs(p_business uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform expire_business_research_jobs();
 if not(select enabled from business_research_settings where id=1) then return '[]'; end if;
 with selected as (
  select j.business_id,m.user_id as actor_id from business_research_jobs j
   left join business_research_links link on link.business_id=j.business_id
   left join leads lead on lead.id=link.lead_id
   left join clients client on client.id=coalesce(link.client_id,lead.account_id)
   join agency_members m on m.user_id=coalesce(client.agent_user_id,lead.agent_user_id,j.actor_id) and m.active
  where (p_business is null or j.business_id=p_business) and j.attempts<5 and j.due_at<=clock_timestamp() and
    (j.state in ('pending','failed') or j.state='processing' and j.lease_until<clock_timestamp()
     or j.state='complete' and (p_business is not null or exists(select 1 from business_research_links l where l.business_id=j.business_id)))
  order by (link.business_id is not null) desc,j.due_at,j.business_id for update of j skip locked limit 1
 ), claimed as (
  update business_research_jobs j set state='processing',actor_id=s.actor_id,lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',
   attempts=attempts+1,updated_at=clock_timestamp() from selected s where j.business_id=s.business_id returning j.*
 ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
 return result;
end $$;

create function public.retain_research_search(p_actor uuid,p_run uuid,p_hash text,p_filters jsonb,p_page integer,p_items jsonb,p_coverage jsonb,p_more boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; ids uuid[]:='{}'; business uuid; saved business_research_runs; context jsonb; matched jsonb;
begin
 if not exists(select 1 from agency_members where user_id=p_actor and active) then raise exception 'Active agency access required' using errcode='42501'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>75 then raise exception 'Invalid search window' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('research-run:'||p_run,0));
 select * into saved from business_research_runs where id=p_run;
 if found then
  if saved.actor_id<>p_actor or saved.query_hash<>p_hash or saved.page<>p_page then raise exception 'Search request changed' using errcode='PT409'; end if;
  return to_jsonb(saved);
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  business:=retain_research_observation(p_actor,item->>'identity',item->'observation');
  if not business=any(ids) then ids:=array_append(ids,business); end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('intelligence-import-promotion',0));
 foreach business in array ids loop
  if not exists(select 1 from business_research_links where business_id=business) then
   context:=research_match_context(p_actor,business);
   if jsonb_array_length(context->'matches')=1 then
    matched:=context->'matches'->0;
    if not exists(select 1 from business_research_links where lead_id=(matched->>'id')::uuid or client_id=(matched->>'id')::uuid) then
     insert into business_research_links(business_id,lead_id,client_id,actor_id)
      values(business,case when matched->>'type'='lead' then (matched->>'id')::uuid end,
       case when matched->>'type'='client' then (matched->>'id')::uuid end,p_actor);
    end if;
   end if;
  end if;
 end loop;
 insert into business_research_runs(id,actor_id,query_hash,filters,page,business_ids,coverage,has_more)
  values(p_run,p_actor,p_hash,p_filters,p_page,ids,p_coverage,p_more) returning * into saved;
 return to_jsonb(saved);
end $$;

create function public.save_business_research_settings(p_actor uuid,p_expected integer,p_config jsonb,p_sources jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved business_research_settings; item jsonb;
begin
 if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then raise exception 'Owner access required' using errcode='42501'; end if;
 select * into saved from business_research_settings where id=1 for update;
 if saved.revision<>p_expected then raise exception 'Research settings changed. Reload before saving.' using errcode='PT409'; end if;
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources)<>3
  or (select count(distinct value->>'provider') from jsonb_array_elements(p_sources))<>3 then raise exception 'Provide all source controls' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_sources) loop
  if not exists(select 1 from business_research_sources where provider=item->>'provider')
   or jsonb_typeof(item->'enabled') is distinct from 'boolean' or jsonb_typeof(item->'retained_rights') is distinct from 'boolean'
   or item->>'enabled'='true' and item->>'retained_rights'<>'true' then raise exception 'Source rights must allow retained use' using errcode='22023'; end if;
  update business_research_sources set enabled=(item->>'enabled')::boolean,retained_rights=(item->>'retained_rights')::boolean,
   revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() where provider=item->>'provider';
 end loop;
 if jsonb_typeof(p_config->'enabled') is distinct from 'boolean' or jsonb_typeof(p_config->'tasks_enabled') is distinct from 'boolean' then
  raise exception 'Provide research and task controls' using errcode='22023'; end if;
 update business_research_settings set enabled=(p_config->>'enabled')::boolean,tasks_enabled=(p_config->>'tasks_enabled')::boolean,
  task_capacity=(p_config->>'task_capacity')::integer,task_due_days=(p_config->>'task_due_days')::integer,
  refresh_days=(p_config->>'refresh_days')::integer,revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() where id=1 returning * into saved;
 if saved.enabled and (not exists(select 1 from vault.decrypted_secrets where name='crm_heartbeat_endpoint' and decrypted_secret~'^https://[^/]+/api/cron/heartbeat$')
  or not exists(select 1 from vault.decrypted_secrets where name='crm_heartbeat_authorization' and nullif(decrypted_secret,'') is not null)) then
  raise exception 'Configure the existing authenticated CRM heartbeat before enabling research' using errcode='22023'; end if;
 perform cron.alter_job((select jobid from cron.job where jobname='crm-business-research'),active:=saved.enabled);
 insert into business_research_setting_events(actor_id,snapshot) values(p_actor,jsonb_build_object('settings',to_jsonb(saved),'sources',p_sources));
 return to_jsonb(saved);
end $$;

create function public.retry_business_research_job(p_actor uuid,p_business uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then raise exception 'Owner access required' using errcode='42501'; end if;
 update business_research_jobs set state='pending',attempts=0,error=null,result=null,lease=null,lease_until=null,due_at=clock_timestamp(),updated_at=clock_timestamp()
  where business_id=p_business and (state='failed' or state='complete' and exists(
   select 1 from jsonb_array_elements(result->'coverage') c where c->>'state'='unavailable'));
 if not found then raise exception 'This research job is not incomplete. Reload its status.' using errcode='PT409'; end if;
 insert into business_research_setting_events(actor_id,snapshot) values(p_actor,jsonb_build_object('retry_business',p_business));
end $$;

create function public.finish_business_research_job(p_business uuid,p_lease uuid,p_observed timestamptz,p_result jsonb,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
declare job business_research_jobs; config business_research_settings;
begin
 select * into job from business_research_jobs where business_id=p_business for update;
 if job.state<>'processing' or job.lease is distinct from p_lease or job.lease_until<clock_timestamp() then raise exception 'Research lease expired' using errcode='PT409'; end if;
 select * into config from business_research_settings where id=1;
 if not config.enabled then
  update business_research_jobs set state='pending',lease=null,lease_until=null where business_id=p_business; return false;
 end if;
 if p_error is not null then
  update business_research_jobs set state='failed',error=left(p_error,1000),lease=null,lease_until=null,
   due_at=clock_timestamp()+make_interval(mins=>least(60,attempts*attempts)),updated_at=clock_timestamp() where business_id=p_business;
  return false;
 end if;
 if exists(select 1 from business_research_entities where id=p_business and updated_at<>p_observed)
  or (job.updated_at at time zone 'UTC')::date<>(clock_timestamp() at time zone 'UTC')::date then
  update business_research_jobs set state='pending',lease=null,lease_until=null,attempts=0,due_at=clock_timestamp() where business_id=p_business;
  return false;
 end if;
 if jsonb_typeof(p_result) is distinct from 'object' then raise exception 'Research result required' using errcode='22023'; end if;
 update business_research_jobs set state='complete',result=p_result,error=null,attempts=0,lease=null,lease_until=null,
  due_at=least(clock_timestamp()+make_interval(days=>config.refresh_days),
   (date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC'),
  updated_at=clock_timestamp() where business_id=p_business;
 return true;
end $$;

create function public.create_business_research_task(p_business uuid,p_lease uuid,p_kind text)
returns uuid language plpgsql security definer set search_path=public as $$
declare job business_research_jobs; config business_research_settings; link business_research_links; related leads; account clients;
 assignee agency_members; target uuid; target_type text; scope text; existing uuid; saved uuid; name text; actor agency_members; zone text; day_start timestamptz;
begin
 if p_kind not in ('contact_research','business_review') then raise exception 'Invalid research task kind' using errcode='22023'; end if;
 select * into job from business_research_jobs where business_id=p_business for update;
 if job.state<>'processing' or job.lease is distinct from p_lease or job.lease_until<clock_timestamp() then raise exception 'Research lease expired' using errcode='PT409'; end if;
 select * into config from business_research_settings where id=1;
 if not config.enabled or not config.tasks_enabled then return null; end if;
 select * into link from business_research_links where business_id=p_business;
 if not found then return null; end if;
 if link.lead_id is not null then select * into related from leads where id=link.lead_id; end if;
 if coalesce(link.client_id,related.account_id) is not null then select * into account from clients where id=coalesce(link.client_id,related.account_id); end if;
 target:=coalesce(account.id,related.id); target_type:=case when account.id is null then 'lead' else 'client' end;
 name:=coalesce(account.full_name,related.full_name);
 select * into actor from agency_members where user_id=job.actor_id and active;
 select * into assignee from agency_members where user_id=coalesce(account.agent_user_id,related.agent_user_id,actor.user_id) and active;
 if actor.user_id is null or assignee.user_id is null then raise exception 'Research task assignment needs an active agent' using errcode='42501'; end if;
 perform intelligence_dossier_scope(actor.user_id,target_type,target);
 perform intelligence_dossier_scope(assignee.user_id,target_type,target);
 scope:=target_type||':'||target;
 select task_id into existing from business_research_task_receipts where business_id=p_business and scope_key=scope and kind=p_kind;
 if found then return existing; end if;
 perform pg_advisory_xact_lock(hashtextextended('research-tasks:'||assignee.user_id,0));
 select timezone into zone from outreach_settings where id=1;
 if zone is null then raise exception 'Configure the agency time zone before creating research tasks' using errcode='22023'; end if;
 day_start:=date_trunc('day',clock_timestamp() at time zone zone) at time zone zone;
 if (select count(*) from business_research_task_receipts r where r.assignee_id=assignee.user_id and r.created_at>=day_start)>=config.task_capacity then return null; end if;
 saved:=gen_random_uuid();
 insert into tasks(id,subject,description,due_date,status,priority,related_type,related_id,account_id,created_by,assignee,action_href,action_category)
  values(saved,left(name||case when p_kind='contact_research' then ': Find a current business contact' else ': Review business research and coverage needs' end,240),
   'Review sourced business research in the existing profile. Public records do not establish current coverage, renewal dates, consent or eligibility.',
   clock_timestamp()+make_interval(days=>config.task_due_days),'open','medium',target_type,target,account.id,
   actor.user_id::text,assignee.email,case when account.id is null then '/leads?lead='||target||'&intelligence=1' else '/clients/'||target||'?intelligence=1' end,'opportunity');
 insert into business_research_task_receipts(business_id,lead_id,client_id,scope_key,kind,task_id,assignee_id)
  values(p_business,case when account.id is null then related.id end,account.id,scope,p_kind,saved,assignee.user_id);
 return saved;
end $$;

create function public.queue_business_research()
returns bigint language plpgsql security definer set search_path=public as $$
declare endpoint text; secret text; request_id bigint;
begin
 perform expire_business_research_jobs();
 if not(select enabled from business_research_settings where id=1) then return null; end if;
 if not exists(select 1 from business_research_jobs where due_at<=clock_timestamp() and attempts<5 and
  (state in ('pending','failed','processing') or exists(select 1 from business_research_links l where l.business_id=business_research_jobs.business_id))) then return null; end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='crm_heartbeat_endpoint';
 select decrypted_secret into secret from vault.decrypted_secrets where name='crm_heartbeat_authorization';
 if endpoint is null or endpoint!~'^https://[^/]+/api/cron/heartbeat$' or nullif(secret,'') is null then
  raise exception 'Research heartbeat credentials are not configured' using errcode='22023'; end if;
 select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),
  body:=jsonb_build_object('job','business-research'),timeout_milliseconds:=65000) into request_id;
 return request_id;
end $$;
do $$
declare job bigint;
begin
 job:=cron.schedule('crm-business-research','* * * * *','select public.queue_business_research()');
 perform cron.alter_job(job,active:=false);
end $$;
revoke all on function public.queue_business_research() from public,anon,authenticated,service_role;

create function public.get_record_business_research(p_actor uuid,p_type text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb; business uuid; branches jsonb;
begin
 scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
 if p_type='lead' then
  select business_id into business from business_research_links where lead_id=p_id;
  if business is not null then return get_business_research(p_actor,business); end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.name,e.id),'[]') into branches from business_research_links l
  left join leads lead on lead.id=l.lead_id
  join business_research_entities e on e.id=l.business_id
  where ((scope->>'client_id' is not null and (l.client_id=(scope->>'client_id')::uuid or lead.account_id=(scope->>'client_id')::uuid))
   or (scope->>'lead_id' is not null and l.lead_id=(scope->>'lead_id')::uuid))
   and (lead.agent_user_id is null or lead.agent_user_id=p_actor or exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin')));
 business:=(branches->0->>'id')::uuid;
 if business is null then return jsonb_build_object('business',null,'linked_record',null,'job',null); end if;
 return get_business_research(p_actor,business)||jsonb_build_object('branches',branches);
end $$;

revoke all on function public.research_source_slot(text),public.retain_research_observation(uuid,text,jsonb),
 public.get_business_research(uuid,uuid),public.save_research_business(uuid,uuid),public.claim_business_research_jobs(uuid),
 public.research_request_slot(text,integer),public.retain_research_search(uuid,uuid,text,jsonb,integer,jsonb,jsonb,boolean),
 public.save_business_research_settings(uuid,integer,jsonb,jsonb),public.finish_business_research_job(uuid,uuid,timestamptz,jsonb,text),
 public.create_business_research_task(uuid,uuid,text),public.retry_business_research_job(uuid,uuid),
 public.get_record_business_research(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.research_source_slot(text),public.retain_research_observation(uuid,text,jsonb),
 public.get_business_research(uuid,uuid),public.save_research_business(uuid,uuid),public.claim_business_research_jobs(uuid),
 public.research_request_slot(text,integer),public.retain_research_search(uuid,uuid,text,jsonb,integer,jsonb,jsonb,boolean),
 public.save_business_research_settings(uuid,integer,jsonb,jsonb),public.finish_business_research_job(uuid,uuid,timestamptz,jsonb,text),
 public.create_business_research_task(uuid,uuid,text),public.retry_business_research_job(uuid,uuid),
 public.get_record_business_research(uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
