begin;

-- This adapter accepts only files with retained CRM display/storage/AI rights.
-- Restricted datasets need a separate field-level permission implementation.
create table public.discovery_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 120),
  permission_reference text not null check(length(btrim(permission_reference)) between 1 and 1000),
  approved_by uuid not null,
  active boolean not null default true,
  acquisition_until date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.discovery_saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null check(length(btrim(name)) between 1 and 80),
  filters jsonb not null check(jsonb_typeof(filters)='object'),
  updated_at timestamptz not null default clock_timestamp()
);
create index discovery_saved_search_user_idx on public.discovery_saved_searches(user_id,updated_at desc);
alter table public.discovery_sources enable row level security;
alter table public.discovery_saved_searches enable row level security;
revoke all on public.discovery_sources,public.discovery_saved_searches from public,anon,authenticated;
grant all on public.discovery_sources,public.discovery_saved_searches to service_role;

alter table public.import_batches add column discovery_source_id uuid references public.discovery_sources(id);
alter table public.import_batches add column discovery_request_id uuid unique;
alter table public.import_batches add column discovery_fingerprint text;
alter table public.import_prospects add column discovery_review text not null default 'discovered'
  check(discovery_review in ('discovered','needs_verification','reviewed','dismissed'));
alter table public.import_prospects add column discovery_note text not null default '' check(length(discovery_note)<=1000);
alter table public.import_prospects add column discovery_reviewer uuid;
alter table public.import_prospects add column discovery_updated_at timestamptz not null default clock_timestamp();
create index discovery_batch_source_idx on public.import_batches(discovery_source_id,created_at desc);
create index discovery_candidate_review_idx on public.import_prospects(batch_id,discovery_review,id);
create policy discovery_batches_server_only on public.import_batches as restrictive for all to authenticated
  using(discovery_source_id is null) with check(discovery_source_id is null);
create policy discovery_candidates_server_only on public.import_prospects as restrictive for all to authenticated
  using(exists(select 1 from public.import_batches where id=batch_id and discovery_source_id is null))
  with check(exists(select 1 from public.import_batches where id=batch_id and discovery_source_id is null));

create function public.save_discovery_source(p_actor uuid,p_config jsonb,p_id uuid default null,p_expected timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item discovery_sources;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can approve data sources.' using errcode='42501';
  end if;
  if jsonb_typeof(p_config) is distinct from 'object' then raise exception 'Provide source settings.' using errcode='22023'; end if;
  if p_id is not null then
    if p_config - 'active'<>'{}'::jsonb or jsonb_typeof(p_config->'active') is distinct from 'boolean' then
      raise exception 'Existing source approvals can only be activated or paused. Create a new approval for different rights.' using errcode='22023';
    end if;
    select * into item from discovery_sources where id=p_id for update;
    if not found then raise exception 'Source not found.' using errcode='P0002'; end if;
    if item.updated_at is distinct from p_expected then raise sqlstate 'PT409' using message='Source approval changed. Refresh before saving.'; end if;
    update discovery_sources set active=(p_config->>'active')::boolean,updated_at=clock_timestamp() where id=p_id returning * into item;
  else
    if p_config - array['name','permission_reference','acquisition_until','retained_crm_rights'] <> '{}'::jsonb then
      raise exception 'An unsupported source setting was supplied.' using errcode='22023';
    end if;
    if p_config->'retained_crm_rights' is distinct from 'true'::jsonb
      or jsonb_typeof(p_config->'name') is distinct from 'string'
      or jsonb_typeof(p_config->'permission_reference') is distinct from 'string'
      or jsonb_typeof(p_config->'acquisition_until') is distinct from 'string'
      or not (p_config->>'acquisition_until' ~ '^\d{4}-\d{2}-\d{2}$')
      or to_char((p_config->>'acquisition_until')::date,'YYYY-MM-DD')<>p_config->>'acquisition_until'
      or (p_config->>'acquisition_until')::date<current_date then
      raise exception 'Approve retained CRM storage, display and AI rights, and provide a valid acquisition end date.' using errcode='22023';
    end if;
    insert into discovery_sources(name,permission_reference,approved_by,acquisition_until)
      values(btrim(p_config->>'name'),btrim(p_config->>'permission_reference'),p_actor,(p_config->>'acquisition_until')::date)
      returning * into item;
  end if;
  insert into agency_audit(actor_id,action,details) values(p_actor,'discovery_source_approved',
    jsonb_build_object('source_id',item.id,'active',item.active,'retained_crm_rights',true));
  return to_jsonb(item);
end;
$$;

create function public.acquire_discovery_file(p_actor uuid,p_source uuid,p_request uuid,p_fingerprint text,
  p_file text,p_vendor text,p_row_count integer,p_prospects jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare source discovery_sources; batch import_batches; item jsonb; duplicates integer:=0; count_items integer;
begin
  if not exists(select 1 from agency_members where user_id=p_actor and active) then
    raise exception 'Active agency access is required for discovery.' using errcode='42501';
  end if;
  if p_request is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Provide a valid file request identity.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select * into batch from import_batches where discovery_request_id=p_request;
  if found then
    if batch.discovery_source_id is distinct from p_source or batch.discovery_fingerprint is distinct from p_fingerprint then
      raise sqlstate 'PT409' using message='This upload request belongs to a different file or source. Start a new upload.';
    end if;
    return jsonb_build_object('batch_id',batch.id,'prospect_count',batch.prospect_count,'already_acquired',true);
  end if;
  select * into source from discovery_sources where id=p_source for share;
  if not found or not source.active or source.acquisition_until<current_date then
    raise exception 'Choose an active owner-approved file source before acquisition.' using errcode='42501';
  end if;
  if jsonb_typeof(p_prospects) is distinct from 'array' then raise exception 'Provide parsed prospects.' using errcode='22023'; end if;
  count_items:=jsonb_array_length(p_prospects);
  if count_items not between 1 and 5000 or coalesce(p_row_count,0)<count_items
    or p_vendor not in ('commercial','personal_auto','generic') or p_vendor is null
    or coalesce(length(btrim(p_file)),0) not between 1 and 255 then
    raise exception 'Review a file with between one and 5000 prospects.' using errcode='22023';
  end if;
  insert into import_batches(file_name,vendor_profile,row_count,prospect_count,discovery_source_id,discovery_request_id,discovery_fingerprint)
    values(p_file,p_vendor,p_row_count,count_items,p_source,p_request,p_fingerprint) returning * into batch;
  for item in select value from jsonb_array_elements(p_prospects) loop
    if coalesce(length(btrim(item->>'full_name')),0)=0 or jsonb_typeof(item->'payload') is distinct from 'object'
      or item->>'disposition' not in ('pending','duplicate') or item->>'disposition' is null then
      raise exception 'A parsed prospect needs review before acquisition.' using errcode='22023';
    end if;
    insert into import_prospects(batch_id,full_name,email,phone,address,line_of_business,disposition,duplicate_of,payload,discovery_review)
      values(batch.id,item->>'full_name',item->>'email',item->>'phone',item->>'address',item->>'line_of_business',
        item->>'disposition',item->>'duplicate_of',item->'payload',
        case when coalesce(nullif(btrim(item->>'email'),''),nullif(btrim(item->>'phone'),'')) is null
          or item->>'disposition'='duplicate' then 'needs_verification' else 'discovered' end);
    if item->>'disposition'='duplicate' then duplicates:=duplicates+1; end if;
  end loop;
  update import_batches set duplicate_count=duplicates where id=batch.id;
  insert into agency_audit(actor_id,action,details) values(p_actor,'discovery_file_acquired',
    jsonb_build_object('batch_id',batch.id,'source_id',p_source,'prospects',count_items));
  return jsonb_build_object('batch_id',batch.id,'prospect_count',count_items,'already_acquired',false);
end;
$$;

create function public.discovery_candidate_changed() returns trigger language plpgsql set search_path=public as $$
begin
  if new.disposition<>'committed' and exists(select 1 from import_batches where id=new.batch_id and discovery_source_id is not null)
    and (new.full_name,new.email,new.phone,new.address,new.line_of_business,new.payload)
      is distinct from (old.full_name,old.email,old.phone,old.address,old.line_of_business,old.payload) then
    new.discovery_review:='needs_verification';
    new.discovery_reviewer:=null;
    new.discovery_updated_at:=clock_timestamp();
  end if;
  return new;
end;
$$;
create trigger discovery_candidate_changed before update on public.import_prospects
  for each row execute function public.discovery_candidate_changed();

create function public.search_discovery_candidates(p_actor uuid,p_filters jsonb,p_page integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not exists(select 1 from agency_members where user_id=p_actor and active) then
    raise exception 'Active agency access is required for discovery.' using errcode='42501';
  end if;
  if jsonb_typeof(p_filters) is distinct from 'object' or p_page is null or p_page not between 0 and 100000 then
    raise exception 'Choose valid targeting filters and a results page.' using errcode='22023';
  end if;
  with candidates as (
    select p.*,b.file_name,b.created_at as acquired_at,s.name as source_name,
      (s.active and s.acquisition_until>=current_date) as source_active,
      case when p.payload #>> '{profile,company,employees}' ~ '^\d{1,8}$'
        then (p.payload #>> '{profile,company,employees}')::integer end as employees,
      coalesce(p.payload->'profile','{}') as profile
    from import_prospects p join import_batches b on b.id=p.batch_id
      join discovery_sources s on s.id=b.discovery_source_id
    where b.status<>'discarded'
      and (coalesce(p_filters->>'source_id','')='' or s.id::text=p_filters->>'source_id')
      and (coalesce(p_filters->>'query','')='' or position(lower(p_filters->>'query') in lower(p.full_name))>0)
      and (coalesce(p_filters->>'industry','')='' or position(lower(p_filters->>'industry') in lower(coalesce(p.payload #>> '{profile,company,industry}','')))>0)
      and (coalesce(p_filters->>'state','')='' or upper(p.address) ~ (',\s*'||(p_filters->>'state')||'(\s*,|\s|$)'))
      and (coalesce(p_filters->>'review','all')='all'
        or (p_filters->>'review'='promoted' and p.disposition='committed')
        or (p_filters->>'review'=p.discovery_review and p.disposition<>'committed'))
  ), filtered as (
    select * from candidates c where
      (p_filters->>'employees_min' is null or employees>=(p_filters->>'employees_min')::integer)
      and (p_filters->>'employees_max' is null or employees<=(p_filters->>'employees_max')::integer)
      and ((coalesce(p_filters->>'line','')='' and coalesce(p_filters->>'renewal_from','')='' and coalesce(p_filters->>'renewal_to','')='')
        or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(profile->'renewals')='array' then profile->'renewals' else '[]' end) r
          where (coalesce(p_filters->>'line','')='' or position(lower(p_filters->>'line') in lower(r->>'type'))>0)
            and (coalesce(p_filters->>'renewal_from','')='' or left(r->>'date',7)>=p_filters->>'renewal_from')
            and (coalesce(p_filters->>'renewal_to','')='' or left(r->>'date',7)<=p_filters->>'renewal_to')
            and coalesce(r->>'evidence_class','vendor_reported')<>'unknown'))
  )
  select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'page_size',50,
    'candidates',coalesce((select jsonb_agg(to_jsonb(page_rows)-'payload'-'discovery_reviewer'-'employees'-'created_at') from
      (select * from filtered order by acquired_at desc,batch_id,id limit 50 offset p_page*50) page_rows),'[]'::jsonb)) into result;
  return result;
end;
$$;

create function public.review_discovery_candidate(p_actor uuid,p_candidate uuid,p_expected timestamptz,p_review text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item import_prospects;
begin
  if not exists(select 1 from agency_members where user_id=p_actor and active) then
    raise exception 'Active agency access is required for discovery.' using errcode='42501';
  end if;
  if p_review is null or p_review not in ('discovered','needs_verification','reviewed','dismissed')
    or p_note is null or length(p_note)>1000 then raise exception 'Choose a review state and a note of up to 1000 characters.' using errcode='22023'; end if;
  -- Match promotion's lock order so review cannot race promotion.
  perform pg_advisory_xact_lock(hashtextextended('intelligence-import-promotion',0));
  select p.* into item from import_prospects p join import_batches b on b.id=p.batch_id
    where p.id=p_candidate and b.discovery_source_id is not null for update of p;
  if not found then raise exception 'Discovery candidate not found.' using errcode='P0002'; end if;
  if item.disposition='committed' or item.discovery_updated_at is distinct from p_expected then
    raise sqlstate 'PT409' using message='Candidate changed or was promoted. Refresh before reviewing.';
  end if;
  update import_prospects set discovery_review=p_review,discovery_note=p_note,discovery_reviewer=p_actor,
    discovery_updated_at=clock_timestamp() where id=p_candidate returning * into item;
  insert into agency_audit(actor_id,action,details) values(p_actor,'discovery_candidate_reviewed',
    jsonb_build_object('candidate_id',p_candidate,'review',p_review));
  return jsonb_build_object('id',item.id,'discovery_review',item.discovery_review,'discovery_updated_at',item.discovery_updated_at);
end;
$$;

-- Preserve legacy imports; approved-file candidates require a deliberate review.
alter function public.promote_import_prospect(uuid,uuid,uuid,jsonb,jsonb,jsonb) rename to promote_import_prospect_core;
revoke all on function public.promote_import_prospect_core(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.promote_import_prospect(p_prospect uuid,p_batch uuid,p_actor uuid,p_expected jsonb,p_profile jsonb,p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare source_id uuid; source discovery_sources; item import_prospects; result jsonb;
begin
  if p_actor is null or (exists(select 1 from agency_members)
    and not exists(select 1 from agency_members where user_id=p_actor and active)) then
    raise exception 'Active agency access is required.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('intelligence-import-promotion',0));
  select discovery_source_id into source_id from import_batches where id=p_batch;
  if source_id is not null then
    select * into source from discovery_sources where id=source_id for share;
    select * into item from import_prospects where id=p_prospect and batch_id=p_batch for update;
    if item.disposition is distinct from 'committed' then
      if not source.active or source.acquisition_until<current_date then
        raise exception 'Source acquisition approval is paused or expired. Ask the owner before promoting.' using errcode='42501';
      end if;
      if item.discovery_review is distinct from 'reviewed' then
        raise sqlstate 'PT409' using message='Review this discovery candidate before promotion.';
      end if;
    end if;
  end if;
  result:=promote_import_prospect_core(p_prospect,p_batch,p_actor,p_expected,p_profile,p_tasks);
  if result->>'disposition'='committed' and source_id is not null then
    update leads set form_payload=jsonb_set(form_payload,'{import}',(form_payload->'import')||
      jsonb_build_object('discovery_source_id',source_id,'source_name',source.name,'retained_crm_rights',true))
      where id=(result->>'lead_id')::uuid;
    insert into agency_audit(actor_id,action,details) values(p_actor,'discovery_candidate_promoted',
      jsonb_build_object('candidate_id',p_prospect,'lead_id',result->>'lead_id'));
  end if;
  return result;
end;
$$;

revoke all on function public.save_discovery_source(uuid,jsonb,uuid,timestamptz),
  public.search_discovery_candidates(uuid,jsonb,integer),
  public.acquire_discovery_file(uuid,uuid,uuid,text,text,text,integer,jsonb),
  public.review_discovery_candidate(uuid,uuid,timestamptz,text,text),
  public.promote_import_prospect(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_discovery_source(uuid,jsonb,uuid,timestamptz),
  public.search_discovery_candidates(uuid,jsonb,integer),
  public.acquire_discovery_file(uuid,uuid,uuid,text,text,text,integer,jsonb),
  public.review_discovery_candidate(uuid,uuid,timestamptz,text,text),
  public.promote_import_prospect(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
