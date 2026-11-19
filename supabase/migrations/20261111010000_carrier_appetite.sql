begin;

create table public.carrier_appetite_documents (
  id uuid primary key,
  created_by uuid not null references auth.users(id),
  file_name text not null,
  storage_path text not null unique,
  content_type text not null,
  file_size integer not null check(file_size between 1 and 26214400),
  pages jsonb not null default '[]' check(jsonb_typeof(pages)='array'),
  "values" jsonb not null default '{}' check(jsonb_typeof("values")='object'),
  revision integer not null default 0 check(revision>=0),
  state text not null default 'draft' check(state in ('draft','active','withdrawn')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  check(state<>'active' or (approved_by is not null and approved_at is not null and revision>0))
);
create table public.carrier_appetite_revisions (
  document_id uuid not null references public.carrier_appetite_documents(id),
  revision integer not null,
  actor_id uuid not null references auth.users(id),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key(document_id,revision)
);
create index carrier_appetite_recent on public.carrier_appetite_documents(updated_at desc,id) where revision>0;
create index carrier_appetite_active_carrier on public.carrier_appetite_documents(lower(trim("values"->>'carrier'))) where state='active';
alter table public.carrier_appetite_documents enable row level security;
alter table public.carrier_appetite_revisions enable row level security;
revoke all on public.carrier_appetite_documents,public.carrier_appetite_revisions from public,anon,authenticated,service_role;
grant select on public.carrier_appetite_documents,public.carrier_appetite_revisions to service_role;

create function public.save_carrier_appetite(
  p_actor uuid,p_id uuid,p_expected integer,p_action text,p_input jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare saved carrier_appetite_documents; rule jsonb; source_page jsonb; day text;
begin
  perform 1 from agency_members where user_id=p_actor and active and role='owner' for share;
  if not found then raise exception 'Only an active owner can manage carrier appetite' using errcode='42501'; end if;
  if p_id is null or p_expected is null or p_expected<0 or p_action is null
    or p_input is null or jsonb_typeof(p_input)<>'object' then
    raise exception 'Provide an appetite document and saved revision' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext('carrier-appetite:'||p_id::text));
  select * into saved from carrier_appetite_documents where id=p_id for update;
  if p_action='reserve' then
    if saved.id is not null then
      if saved.created_by<>p_actor or saved.file_name is distinct from p_input->>'file_name'
        or saved.file_size is distinct from (p_input->>'file_size')::integer
        or saved.content_type is distinct from p_input->>'content_type' then
        raise exception 'This upload reference is already used' using errcode='PT409'; end if;
      return to_jsonb(saved);
    end if;
    if p_expected<>0 or length(p_input->>'file_name') not between 1 and 255
      or p_input->>'storage_path' not like 'carrier-appetite/'||p_id::text||'/%'
      or p_input->>'content_type' not in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      or (p_input->>'file_size')::integer not between 1 and 26214400 then
      raise exception 'Provide a supported carrier document' using errcode='22023'; end if;
    insert into carrier_appetite_documents(id,created_by,file_name,storage_path,content_type,file_size)
      values(p_id,p_actor,p_input->>'file_name',p_input->>'storage_path',p_input->>'content_type',(p_input->>'file_size')::integer)
      returning * into saved;
    return to_jsonb(saved);
  end if;
  if saved.revision=p_expected+1 and (
    (p_action='save' and saved.state='draft' and saved.values=p_input->'values' and saved.pages=p_input->'pages')
    or (p_action='activate' and saved.state='active' and saved.approved_by=p_actor)
    or (p_action='withdraw' and saved.state='withdrawn')
  ) then return to_jsonb(saved); end if;
  if saved.id is null or saved.revision<>p_expected then
    raise exception 'Document changed. Reload before saving or reviewing.' using errcode='PT409'; end if;
  if p_action='save' then
    if jsonb_typeof(p_input->'values') is distinct from 'object' or jsonb_typeof(p_input->'pages') is distinct from 'array'
      or jsonb_array_length(p_input->'pages')<1 or length((p_input->'pages')::text)>3000000 then
      raise exception 'Provide reviewed rules and their source pages' using errcode='22023'; end if;
    if saved.revision>0 and saved.pages is distinct from p_input->'pages' then
      raise exception 'Source pages cannot change. Upload a new edition instead.' using errcode='PT409'; end if;
    if coalesce(length(trim(p_input->'values'->>'carrier')),0) not between 1 and 150
      or coalesce(length(trim(p_input->'values'->>'title')),0) not between 1 and 200
      or coalesce(length(trim(p_input->'values'->>'rights_reference')),0) not between 1 and 2000
      or p_input->'values'->>'access' is null or p_input->'values'->>'access' not in ('unconfirmed','direct','mga_wholesaler','unavailable')
      or jsonb_typeof(p_input->'values'->'rules') is distinct from 'array' then
      raise exception 'Record the carrier, document rights and agency access' using errcode='22023'; end if;
    if nullif(p_input->'values'->>'expires_on','')::date<nullif(p_input->'values'->>'effective_on','')::date then
      raise exception 'Expiry must not precede the effective date' using errcode='22023'; end if;
    if p_input->'values'->>'access' in ('direct','mga_wholesaler')
      and coalesce(length(trim(p_input->'values'->>'access_reference')),0)=0 then
      raise exception 'Record the appointment or wholesaler reference' using errcode='22023'; end if;
    for day in select value from jsonb_array_elements_text(jsonb_build_array(p_input->'values'->>'effective_on',p_input->'values'->>'expires_on')) loop
      if coalesce(day,'')<>'' and (day!~'^\d{4}-\d{2}-\d{2}$' or to_char(day::date,'YYYY-MM-DD')<>day) then
        raise exception 'Use valid document dates' using errcode='22023'; end if;
    end loop;
    if jsonb_array_length(p_input->'values'->'rules')>1000 then raise exception 'Split this rule review' using errcode='22023'; end if;
    for rule in select value from jsonb_array_elements(p_input->'values'->'rules') loop
      if rule->>'carrier' is not null and lower(trim(rule->>'carrier'))<>lower(trim(p_input->'values'->>'carrier')) then
        raise exception 'Review rules for each carrier separately' using errcode='22023'; end if;
      if rule->>'decision' is null or rule->>'decision' not in ('preferred','eligible','excluded','referral','condition','needs_review')
        or coalesce(length(trim(rule->>'criterion')),0) not between 1 and 2200
        or coalesce(length(trim(rule->>'excerpt')),0) not between 1 and 4000 then
        raise exception 'Review each rule and its source excerpt' using errcode='22023'; end if;
      select value into source_page from jsonb_array_elements(p_input->'pages') where value->>'page'=rule->>'page';
      if source_page is null or coalesce(strpos(source_page->>'text',rule->>'excerpt'),0)=0 then
        raise exception 'Rule excerpt must occur on its source page' using errcode='22023'; end if;
    end loop;
    update carrier_appetite_documents set pages=p_input->'pages',"values"=p_input->'values',state='draft',
      approved_by=null,approved_at=null where id=p_id;
  elsif p_action='activate' then
    if saved.state<>'draft' or saved.revision=0 or coalesce(jsonb_array_length(saved.values->'rules'),0)=0
      or nullif(saved.values->>'effective_on','') is null or nullif(saved.values->>'line','') is null
      or nullif(saved.values->>'states','') is null
      or exists(select 1 from jsonb_array_elements(saved.values->'rules') r where r->>'decision'='needs_review') then
      raise exception 'Review all rules, line, territory and effective date before activation' using errcode='22023'; end if;
    if nullif(saved.values->>'expires_on','')::date<current_date then
      raise exception 'Expired guidance cannot be activated' using errcode='22023'; end if;
    update carrier_appetite_documents set state='active',approved_by=p_actor,approved_at=clock_timestamp() where id=p_id;
  elsif p_action='withdraw' then
    update carrier_appetite_documents set state='withdrawn',approved_by=null,approved_at=null where id=p_id;
  else raise exception 'Choose save, activate or withdraw' using errcode='22023';
  end if;
  update carrier_appetite_documents set revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into saved;
  insert into carrier_appetite_revisions(document_id,revision,actor_id,snapshot) values(p_id,saved.revision,p_actor,to_jsonb(saved));
  return to_jsonb(saved);
end;
$$;
revoke all on function public.save_carrier_appetite(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_carrier_appetite(uuid,uuid,integer,text,jsonb) to service_role;

-- Multiple documents for a carrier must be considered together; never silently choose the newest.
create function public.carrier_appetite_source_overlaps()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(id),'[]'::jsonb) from carrier_appetite_documents d
  where d.state='active' and exists(
    select 1 from carrier_appetite_documents other
    where other.state='active' and other.id<>d.id
      and lower(trim(other.values->>'carrier'))=lower(trim(d.values->>'carrier'))
  );
$$;
revoke all on function public.carrier_appetite_source_overlaps() from public,anon,authenticated;
grant execute on function public.carrier_appetite_source_overlaps() to service_role;
commit;
