begin;

create function public.intelligence_phone(p_value text) returns text
language sql immutable parallel safe set search_path=public as $$
  select regexp_replace(regexp_replace(coalesce(p_value,''),'\D','','g'),'^1(?=\d{10}$)','','g')
$$;
create function public.intelligence_name(p_value text) returns text
language sql immutable parallel safe set search_path=public as $$
  select lower(regexp_replace(btrim(coalesce(p_value,'')),'\s+',' ','g'))
$$;

create index intelligence_lead_email_idx on public.leads(lower(btrim(email)));
create index intelligence_client_email_idx on public.clients(lower(btrim(email)));
create index intelligence_lead_phone_idx on public.leads(public.intelligence_phone(phone));
create index intelligence_client_phone_idx on public.clients(public.intelligence_phone(phone));
create index intelligence_lead_business_idx on public.leads(public.intelligence_name(full_name),public.intelligence_name(address));
create index intelligence_client_business_idx on public.clients(public.intelligence_name(full_name),public.intelligence_name(address));
create index intelligence_lead_dot_idx on public.leads((form_payload #>> '{profile,dot,number}'));
create index intelligence_lead_verified_dot_idx on public.leads((form_payload #>> '{profile,enrichment,fmcsa,dot_number}'));
create unique index intelligence_import_prospect_idx on public.leads((form_payload #>> '{import,prospect_id}'))
  where form_payload #>> '{import,prospect_id}' is not null;

create table public.intelligence_import_evidence (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  prospect_id uuid not null unique,
  batch_id uuid not null,
  source_file text not null,
  source_as_of timestamptz,
  observed_at timestamptz not null default now(),
  actor_id uuid not null,
  evidence_class text not null default 'vendor_reported' check(evidence_class='vendor_reported'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object')
);
alter table public.intelligence_import_evidence enable row level security;
revoke all on public.intelligence_import_evidence from public,anon,authenticated;
grant all on public.intelligence_import_evidence to service_role;

create table public.intelligence_enrichment_observations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  source text not null check(source in ('fmcsa','osha')),
  observed_at timestamptz not null default now(),
  actor_id uuid not null,
  match_method text not null check(match_method in ('name_search','agent_selected_dot','legacy')),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object')
);
create index intelligence_enrichment_history_idx on public.intelligence_enrichment_observations(lead_id,source,observed_at desc);
alter table public.intelligence_enrichment_observations enable row level security;
revoke all on public.intelligence_enrichment_observations from public,anon,authenticated;
grant all on public.intelligence_enrichment_observations to service_role;

create function public.record_intelligence_enrichment(
  p_lead uuid,p_actor uuid,p_source text,p_record jsonb,p_expected jsonb,p_match_method text
) returns boolean language plpgsql security definer set search_path=public as $$
declare item leads; old_record jsonb; enrichment jsonb; profile jsonb;
begin
  if p_actor is null or (exists(select 1 from agency_members)
    and not exists(select 1 from agency_members where user_id=p_actor and active)) then
    raise exception 'Active agency access is required.' using errcode='42501';
  end if;
  if p_source not in ('fmcsa','osha') or p_source is null or jsonb_typeof(p_record) is distinct from 'object'
    or p_match_method not in ('name_search','agent_selected_dot') or p_match_method is null then
    raise exception 'The source observation is not valid.' using errcode='22023';
  end if;
  select * into item from leads where id=p_lead for update;
  if item.id is null then raise exception 'Lead not found.' using errcode='P0002'; end if;
  if p_expected is distinct from jsonb_build_object('full_name',item.full_name,'address',item.address) then
    raise sqlstate 'PT409' using message='Lead identity changed during lookup. Refresh before saving evidence.';
  end if;
  if (item.form_payload is not null and jsonb_typeof(item.form_payload)<>'object')
    or (item.form_payload->'profile' is not null and jsonb_typeof(item.form_payload->'profile') not in ('object','null'))
    or (item.form_payload #> '{profile,enrichment}' is not null and jsonb_typeof(item.form_payload #> '{profile,enrichment}') not in ('object','null')) then
    raise exception 'The existing lead profile needs review before saving evidence.' using errcode='22023';
  end if;
  profile:=case when jsonb_typeof(item.form_payload->'profile')='object' then item.form_payload->'profile' else '{}'::jsonb end;
  enrichment:=case when jsonb_typeof(profile->'enrichment')='object' then profile->'enrichment' else '{}'::jsonb end;
  old_record:=enrichment->p_source;
  if jsonb_typeof(old_record)='object' and not exists(select 1 from intelligence_enrichment_observations where lead_id=p_lead and source=p_source) then
    insert into intelligence_enrichment_observations(lead_id,source,actor_id,match_method,snapshot)
      values(p_lead,p_source,p_actor,'legacy',old_record);
  end if;
  if old_record->>'fetched_at' is not null and p_record->>'fetched_at' is not null
    and (old_record->>'fetched_at')::timestamptz>(p_record->>'fetched_at')::timestamptz then
    raise sqlstate 'PT409' using message='A newer source observation was saved. Refresh before retrying.';
  end if;
  insert into intelligence_enrichment_observations(lead_id,source,actor_id,match_method,snapshot)
    values(p_lead,p_source,p_actor,p_match_method,p_record);
  update leads set form_payload=coalesce(item.form_payload,'{}')||jsonb_build_object('profile',
    profile||jsonb_build_object('enrichment',enrichment||jsonb_build_object(p_source,p_record))) where id=p_lead;
  return true;
end;
$$;

create function public.intelligence_import_matches(p_candidates jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  candidate jsonb; matches jsonb; result jsonb:='[]';
  normalized_email text; normalized_phone text; normalized_name text; normalized_address text;
  dot_number text;
begin
  if p_actor is null or (exists(select 1 from agency_members)
    and not exists(select 1 from agency_members where user_id=p_actor and active)) then
    raise exception 'Active agency access is required.' using errcode='42501';
  end if;
  if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates)>200 then
    raise exception 'Review at most 200 prospects at once.' using errcode='22023';
  end if;
  for candidate in select value from jsonb_array_elements(p_candidates) loop
    normalized_email:=lower(btrim(coalesce(candidate->>'email','')));
    normalized_phone:=intelligence_phone(candidate->>'phone');
    normalized_name:=intelligence_name(candidate->>'full_name');
    normalized_address:=intelligence_name(candidate->>'address');
    dot_number:=nullif(btrim(candidate->>'dot_number'),'');
    select coalesce(jsonb_agg(ref order by ref),'[]') into matches from (
      select 'lead:'||id::text as ref from leads where
        (dot_number ~ '^\d+$' and (form_payload #>> '{profile,dot,number}'=dot_number or form_payload #>> '{profile,enrichment,fmcsa,dot_number}'=dot_number))
        or
        (normalized_email<>'' and lower(btrim(email))=normalized_email)
        or (length(normalized_phone)>=10 and intelligence_phone(phone)=normalized_phone)
        or (normalized_name<>'' and normalized_address<>'' and intelligence_name(full_name)=normalized_name and intelligence_name(address)=normalized_address)
      union
      select 'client:'||id::text from clients where
        (normalized_email<>'' and lower(btrim(email))=normalized_email)
        or (length(normalized_phone)>=10 and intelligence_phone(phone)=normalized_phone)
        or (normalized_name<>'' and normalized_address<>'' and intelligence_name(full_name)=normalized_name and intelligence_name(address)=normalized_address)
    ) records;
    result:=result||jsonb_build_array(jsonb_build_object('index',candidate->'index','matches',matches));
  end loop;
  return result;
end;
$$;

create function public.promote_import_prospect(
  p_prospect uuid,p_batch uuid,p_actor uuid,p_expected jsonb,p_profile jsonb,p_tasks jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  item import_prospects; batch import_batches; lead uuid; match_data jsonb;
  renewal jsonb; task jsonb; task_count integer:=0; contact_count integer:=0;
  tomorrow date; contact_due timestamptz;
begin
  if p_actor is null or (exists(select 1 from agency_members)
    and not exists(select 1 from agency_members where user_id=p_actor and active)) then
    raise exception 'Active agency access is required.' using errcode='42501';
  end if;
  -- Serialize competing imports before matching; each prospect is an independent transaction.
  perform pg_advisory_xact_lock(hashtextextended('intelligence-import-promotion',0));
  select * into batch from import_batches where id=p_batch for update;
  select * into item from import_prospects where id=p_prospect and batch_id=p_batch for update;
  if item.id is null or batch.id is null then raise exception 'The selected prospect no longer exists.' using errcode='P0002'; end if;
  if item.disposition='committed' and item.lead_id is not null then
    return jsonb_build_object('disposition','already_committed','lead_id',item.lead_id,'tasks_created',0,'contact_tasks_created',0);
  end if;
  if batch.status='discarded' or item.disposition not in ('pending','duplicate') then
    raise sqlstate 'PT409' using message='This prospect is no longer available for import. Refresh the batch.';
  end if;
  if p_expected is distinct from jsonb_build_object('full_name',item.full_name,'email',item.email,'phone',item.phone,
    'address',item.address,'line_of_business',item.line_of_business,'payload',item.payload) then
    raise sqlstate 'PT409' using message='This prospect changed during review. Refresh before importing.';
  end if;
  if coalesce(nullif(btrim(item.email),''),nullif(btrim(item.phone),'')) is null then
    return jsonb_build_object('disposition','blocked_no_contact','tasks_created',0,'contact_tasks_created',0);
  end if;
  match_data:=intelligence_import_matches(jsonb_build_array(jsonb_build_object('index',0,'full_name',item.full_name,
    'email',item.email,'phone',item.phone,'address',item.address,'dot_number',p_profile #>> '{dot,number}')),p_actor)->0->'matches';
  if jsonb_array_length(match_data)>0 then
    update import_prospects set disposition='duplicate',duplicate_of=match_data->>0 where id=item.id;
    update import_batches set duplicate_count=(select count(*) from import_prospects where batch_id=p_batch and disposition='duplicate') where id=p_batch;
    return jsonb_build_object('disposition','duplicate','matches',match_data,'tasks_created',0,'contact_tasks_created',0);
  end if;
  if jsonb_typeof(p_profile) is distinct from 'object' or jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks)>100 then
    raise exception 'The reviewed profile or renewal tasks are not valid.' using errcode='22023';
  end if;
  -- Provider imports cannot establish customer confirmation.
  if jsonb_typeof(p_profile->'renewals')='array' then
    for renewal in select value from jsonb_array_elements(p_profile->'renewals') loop
      if renewal->>'evidence_class' not in ('predicted','vendor_reported','unknown') or renewal->>'evidence_class' is null then
        raise exception 'Imported renewal evidence must be classified before promotion.' using errcode='22023';
      end if;
    end loop;
  end if;
  insert into leads(full_name,email,phone,address,line_of_business,source,status,business,industry,website,
    est_employees,est_revenue,details,form_payload)
  values(item.full_name,item.email,item.phone,item.address,coalesce(item.line_of_business,'General'),'prospect_import','new',
    case when p_profile->>'kind'='commercial' then item.full_name end,p_profile #>> '{company,industry}',
    p_profile #>> '{company,website}',p_profile #>> '{company,employees}',p_profile #>> '{company,sales_range}',
    'Imported from '||batch.file_name,jsonb_build_object('profile',p_profile,'import',
      jsonb_build_object('batch_id',p_batch,'prospect_id',item.id,'file_name',batch.file_name,'observed_at',now()))) returning id into lead;
  insert into intelligence_import_evidence(lead_id,prospect_id,batch_id,source_file,actor_id,snapshot)
    values(lead,item.id,p_batch,batch.file_name,p_actor,p_profile);
  for task in select value from jsonb_array_elements(p_tasks) loop
    if nullif(btrim(task->>'subject'),'') is null or nullif(btrim(task->>'description'),'') is null or task->>'due_date' is null then
      raise exception 'A renewal follow-up is incomplete.' using errcode='22023';
    end if;
    insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
      values(task->>'subject',task->>'description',(task->>'due_date')::timestamptz,'open','medium','lead',lead);
    task_count:=task_count+1;
  end loop;
  if not exists(select 1 from tasks where related_type='lead' and related_id=lead and status='open' and due_date<=now()+interval '7 days') then
    tomorrow:=(now() at time zone 'America/Phoenix')::date+1;
    while extract(isodow from tomorrow) in (6,7) loop tomorrow:=tomorrow+1; end loop;
    contact_due:=(tomorrow+time '16:00') at time zone 'America/Phoenix';
    insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
      values('Contact new lead: '||item.full_name,'New prospect added to your pipeline - make the first touch.',
        contact_due,'open','medium','lead',lead);
    contact_count:=1;
  end if;
  update import_prospects set disposition='committed',lead_id=lead,duplicate_of=null where id=item.id;
  update import_batches set committed_count=(select count(*) from import_prospects where batch_id=p_batch and disposition='committed'),
    status=case when exists(select 1 from import_prospects where batch_id=p_batch and disposition='pending') then 'review' else 'committed' end where id=p_batch;
  return jsonb_build_object('disposition','committed','lead_id',lead,'tasks_created',task_count,'contact_tasks_created',contact_count);
end;
$$;

revoke all on function public.intelligence_import_matches(jsonb,uuid) from public,anon,authenticated;
revoke all on function public.promote_import_prospect(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.intelligence_import_matches(jsonb,uuid) to service_role;
grant execute on function public.promote_import_prospect(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.record_intelligence_enrichment(uuid,uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_intelligence_enrichment(uuid,uuid,text,jsonb,jsonb,text) to service_role;
commit;
