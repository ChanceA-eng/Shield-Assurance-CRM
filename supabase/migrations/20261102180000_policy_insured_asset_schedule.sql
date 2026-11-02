begin;
create table public.policy_insured_assets (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  asset_id uuid references public.client_assets(id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(policy_id, asset_id)
);
create index policy_insured_assets_policy_idx on public.policy_insured_assets(policy_id, created_at, id);
alter table public.policy_insured_assets enable row level security;
revoke all on public.policy_insured_assets from public, anon, authenticated;
grant all on public.policy_insured_assets to service_role;

create table public.policy_insured_asset_requests (
  request_id uuid primary key,
  policy_id uuid not null references public.policies(id) on delete cascade,
  request jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.policy_insured_asset_requests enable row level security;
revoke all on public.policy_insured_asset_requests from public, anon, authenticated;
grant all on public.policy_insured_asset_requests to service_role;

create function public.issue_policy_with_assets_atomic(
  p_request_id uuid, p_account_id uuid, p_lead_id uuid, p_policy jsonb,
  p_asset_ids uuid[] default '{}'::uuid[], p_quote_id uuid default null, p_quote_version timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  prior public.policy_insured_asset_requests%rowtype;
  result jsonb;
  policy_id uuid;
  request_data jsonb;
  found_assets integer;
begin
  if p_request_id is null or p_account_id is null or p_policy is null or p_asset_ids is null
    or cardinality(p_asset_ids)>100 or cardinality(p_asset_ids)<>(select count(distinct x) from unnest(p_asset_ids) x)
    or array_position(p_asset_ids,null) is not null then
    raise exception 'A valid issuance and up to 100 distinct insured assets are required.' using errcode='22023';
  end if;
  if (p_quote_id is null)<>(p_quote_version is null) then
    raise exception 'Quote ID and version must be supplied together.' using errcode='22023';
  end if;
  request_data:=jsonb_build_object('account_id',p_account_id,'lead_id',p_lead_id,'policy',p_policy,
    'asset_ids',to_jsonb(coalesce((select array_agg(x order by x) from unnest(p_asset_ids) x),'{}'::uuid[])),
    'quote_id',p_quote_id,'quote_version',p_quote_version);
  perform pg_advisory_xact_lock(hashtextextended('insured-assets:'||p_request_id::text,0));
  select * into prior from public.policy_insured_asset_requests where request_id=p_request_id for update;
  if found then
    if prior.request is distinct from request_data then raise exception 'Issuance ID reused with different insured assets or policy details.' using errcode='23505'; end if;
    select id into policy_id from public.policies where id=prior.policy_id;
    if not found then raise exception 'Previously issued policy no longer exists.' using errcode='P0002'; end if;
    return jsonb_build_object('policy',(select to_jsonb(p) from public.policies p where p.id=policy_id),'created',false);
  end if;
  perform 1 from public.client_assets
    where id=any(p_asset_ids) and client_id=p_account_id and archived_at is null and asset_type<>'note' for share;
  get diagnostics found_assets=row_count;
  if found_assets<>cardinality(p_asset_ids) then
    raise exception 'Every selected insured asset must be active and belong to this account.' using errcode='23514';
  end if;
  if p_quote_id is null then
    result:=public.issue_policy_atomic(p_request_id,p_account_id,p_lead_id,p_policy);
  else
    result:=public.issue_quote_policy_atomic(p_request_id,p_account_id,p_lead_id,p_policy,p_quote_id,p_quote_version);
  end if;
  policy_id:=(result#>>'{policy,id}')::uuid;
  insert into public.policy_insured_assets(policy_id,asset_id,snapshot)
    select policy_id,a.id,to_jsonb(a) from public.client_assets a
    where a.id=any(p_asset_ids) and a.client_id=p_account_id and a.archived_at is null and a.asset_type<>'note';
  insert into public.policy_insured_asset_requests(request_id,policy_id,request) values(p_request_id,policy_id,request_data);
  return result;
end;
$$;
revoke all on function public.issue_policy_with_assets_atomic(uuid,uuid,uuid,jsonb,uuid[],uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.issue_policy_with_assets_atomic(uuid,uuid,uuid,jsonb,uuid[],uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
