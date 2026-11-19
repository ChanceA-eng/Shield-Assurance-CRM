begin;
create table public.intelligence_dossiers (
  scope_key text primary key,
  lead_id uuid unique references public.leads(id) on delete cascade,
  client_id uuid unique references public.clients(id) on delete cascade,
  version integer not null default 0,
  findings jsonb not null default '{}' check(jsonb_typeof(findings)='object'),
  check ((lead_id is not null)::integer+(client_id is not null)::integer=1)
);
create table public.intelligence_dossier_confirmations (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null references public.intelligence_dossiers(scope_key) on delete cascade,
  version integer not null,
  request_id uuid not null unique,
  actor_id uuid not null,
  observed_at timestamptz not null default clock_timestamp(),
  source_as_of date not null,
  reference text not null check(length(btrim(reference)) between 1 and 1000),
  findings jsonb not null check(jsonb_typeof(findings)='object'),
  unique(scope_key,version)
);
create index intelligence_dossier_history_idx on public.intelligence_dossier_confirmations(scope_key,version desc);
alter table public.intelligence_dossiers enable row level security;
alter table public.intelligence_dossier_confirmations enable row level security;
revoke all on public.intelligence_dossiers,public.intelligence_dossier_confirmations from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.intelligence_dossiers to service_role;
grant select on public.intelligence_dossier_confirmations to service_role;

create function public.intelligence_dossier_scope(p_actor uuid,p_type text,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare member agency_members; client clients; lead leads; key text; name text;
begin
  select * into member from agency_members where user_id=p_actor and active;
  if not found then raise exception 'Active agency access is required for intelligence dossiers.' using errcode='42501'; end if;
  if p_type='lead' then
    select * into lead from leads where id=p_id for share;
    if not found then raise exception 'Lead not found.' using errcode='P0002'; end if;
    if member.role='agent' and lead.agent_user_id is not null and lead.agent_user_id<>p_actor then
      raise exception 'This dossier is assigned to another agent.' using errcode='42501';
    end if;
    if lead.account_id is not null then
      select * into client from clients where id=lead.account_id for share;
      if not found then raise exception 'Linked account not found.' using errcode='P0002'; end if;
    end if;
  elsif p_type='client' then
    select * into client from clients where id=p_id for share;
    if not found then raise exception 'Account not found.' using errcode='P0002'; end if;
  else raise exception 'Choose a lead or account dossier.' using errcode='22023'; end if;
  if client.id is not null then
    if member.role='agent' and client.agent_user_id is not null and client.agent_user_id<>p_actor then
      raise exception 'This dossier is assigned to another agent.' using errcode='42501';
    end if;
    key:='client:'||client.id; name:=client.full_name;
  else key:='lead:'||lead.id; name:=lead.full_name; end if;
  return jsonb_build_object('scope_key',key,'record_name',name,'lead_id',case when client.id is null then lead.id end,'client_id',client.id);
end;
$$;

create function public.get_intelligence_dossier(p_actor uuid,p_type text,p_id uuid,p_page integer default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb; dossier intelligence_dossiers; observations jsonb; history jsonb; current_confirmation jsonb; observation_count bigint; history_count bigint;
begin
  scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
  if p_page is null or p_page not between 0 and 10000 then raise exception 'Choose a valid history page.' using errcode='22023'; end if;
  select * into dossier from intelligence_dossiers where scope_key=scope->>'scope_key';
  select jsonb_build_object('id',c.id,'scope_key',c.scope_key,'version',c.version,'actor_id',c.actor_id,
    'observed_at',c.observed_at,'source_as_of',c.source_as_of,'reference',c.reference,'findings',c.findings)
    into current_confirmation from intelligence_dossier_confirmations c where c.scope_key=scope->>'scope_key' and c.version=dossier.version;
  with permitted_keys as (
    select scope->>'scope_key' as key
    union all select 'lead:'||l.id from leads l where l.account_id=(scope->>'client_id')::uuid
      and (l.agent_user_id is null or l.agent_user_id=p_actor or exists(select 1 from agency_members where user_id=p_actor and role in ('owner','admin') and active))
  ), confirmation_rows as (
    select c.id,c.scope_key,c.version,c.actor_id,c.observed_at,c.source_as_of,c.reference,c.findings
      from intelligence_dossier_confirmations c join permitted_keys k on k.key=c.scope_key
  ) select (select count(*) from confirmation_rows),coalesce((select jsonb_agg(to_jsonb(items) order by observed_at desc,id desc) from (
    select * from confirmation_rows order by observed_at desc,id desc limit 25 offset p_page*25
  ) items),'[]') into history_count,history;
  with permitted_leads as (
    select l.id from leads l where
      ((scope->>'client_id' is not null and l.account_id=(scope->>'client_id')::uuid) or l.id=(scope->>'lead_id')::uuid)
      and (l.agent_user_id is null or l.agent_user_id=p_actor or exists(select 1 from agency_members where user_id=p_actor and role in ('owner','admin') and active))
  ), source_rows as (
    select e.id,e.lead_id,e.source_file as source,e.observed_at,e.source_as_of,'vendor_file' as match_method,e.snapshot
      from intelligence_import_evidence e join permitted_leads l on l.id=e.lead_id
    union all
    select e.id,e.lead_id,e.source,e.observed_at,null::timestamptz,e.match_method,e.snapshot
      from intelligence_enrichment_observations e join permitted_leads l on l.id=e.lead_id
  ) select (select count(*) from source_rows),coalesce((select jsonb_agg(to_jsonb(rows) order by observed_at desc,id desc) from (
    select * from source_rows order by observed_at desc,id desc limit 25 offset p_page*25
  ) rows),'[]') into observation_count,observations;
  return scope||jsonb_build_object('version',coalesce(dossier.version,0),'findings',coalesce(dossier.findings,'{}'),
    'current_confirmation',current_confirmation,'confirmations',history,'observations',observations,'observations_total',observation_count,'history_total',history_count,'page',p_page);
end;
$$;

create function public.save_intelligence_dossier(p_actor uuid,p_type text,p_id uuid,p_scope text,p_expected integer,
  p_request uuid,p_findings jsonb,p_reference text,p_source_as_of date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare scope jsonb; current_record intelligence_dossiers; replay intelligence_dossier_confirmations; field text; field_value text;
begin
  -- Linking and confirmation writes are serialized before resolving canonical scope.
  perform pg_advisory_xact_lock(hashtextextended('intelligence-dossier-write',0));
  scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
  if p_scope is distinct from scope->>'scope_key' then
    raise sqlstate 'PT409' using message='The record was linked to a different account. Reload its dossier before saving.';
  end if;
  if p_request is null or jsonb_typeof(p_findings) is distinct from 'object'
    or p_reference is null or length(btrim(p_reference)) not between 1 and 1000
    or p_source_as_of is null or p_source_as_of>current_date then
    raise exception 'Provide findings, an evidence reference and a non-future confirmation date.' using errcode='22023';
  end if;
  for field,field_value in select entries.key,entries.value #>> '{}' from jsonb_each(p_findings) entries loop
    if field not in ('business_identity','decision_maker','buying_process','stated_priorities','required_lines','renewal_line','renewal_date','next_step')
      or jsonb_typeof(p_findings->field)<>'string' or length(field_value)>1000 then
      raise exception 'Findings must use supported fields with text of up to 1000 characters.' using errcode='22023';
    end if;
  end loop;
  if coalesce(p_findings->>'renewal_date','')<>'' and
    (coalesce(p_findings->>'renewal_line','')='' or p_findings->>'renewal_date' !~ '^\d{4}-\d{2}-\d{2}$'
      or to_char((p_findings->>'renewal_date')::date,'YYYY-MM-DD')<>p_findings->>'renewal_date') then
    raise exception 'Provide a valid confirmed renewal date and line.' using errcode='22023';
  end if;
  select * into replay from intelligence_dossier_confirmations where request_id=p_request;
  if found then
    if replay.scope_key<>p_scope or replay.actor_id<>p_actor or replay.findings<>p_findings
      or replay.reference<>btrim(p_reference) or replay.source_as_of<>p_source_as_of then
      raise sqlstate 'PT409' using message='This confirmation request belongs to different findings. Reload before saving.';
    end if;
    return jsonb_build_object('version',replay.version,'already_saved',true);
  end if;
  insert into intelligence_dossiers(scope_key,lead_id,client_id) values(p_scope,(scope->>'lead_id')::uuid,(scope->>'client_id')::uuid)
    on conflict(scope_key) do nothing;
  select * into current_record from intelligence_dossiers where scope_key=p_scope for update;
  if current_record.version is distinct from p_expected then
    raise sqlstate 'PT409' using message='Dossier findings changed. Reload and review the latest findings before saving.';
  end if;
  update intelligence_dossiers set findings=p_findings,version=version+1 where scope_key=p_scope returning * into current_record;
  insert into intelligence_dossier_confirmations(scope_key,version,request_id,actor_id,source_as_of,reference,findings)
    values(p_scope,current_record.version,p_request,p_actor,p_source_as_of,btrim(p_reference),p_findings);
  insert into agency_audit(actor_id,action,details) values(p_actor,'intelligence_findings_confirmed',
    jsonb_build_object('scope_key',p_scope,'version',current_record.version));
  return jsonb_build_object('version',current_record.version,'already_saved',false);
end;
$$;

revoke all on function public.intelligence_dossier_scope(uuid,text,uuid),
  public.get_intelligence_dossier(uuid,text,uuid,integer),
  public.save_intelligence_dossier(uuid,text,uuid,text,integer,uuid,jsonb,text,date) from public,anon,authenticated;
grant execute on function public.get_intelligence_dossier(uuid,text,uuid,integer),
  public.save_intelligence_dossier(uuid,text,uuid,text,integer,uuid,jsonb,text,date) to service_role;
notify pgrst,'reload schema';
commit;
