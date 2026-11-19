begin;

alter table public.discovery_sources add column provider text not null default 'file'
  check(provider in ('file','fmcsa'));

alter function public.save_discovery_source(uuid,jsonb,uuid,timestamptz) rename to save_discovery_source_core;
revoke all on function public.save_discovery_source_core(uuid,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;

create function public.save_discovery_source(p_actor uuid,p_config jsonb,p_id uuid default null,p_expected timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; source_provider text;
begin
  if p_id is not null and p_config ? 'provider' then
    raise exception 'Source provider is immutable. Create a new approval for a different source.' using errcode='22023';
  end if;
  source_provider:=coalesce(p_config->>'provider','file');
  if source_provider not in ('file','fmcsa') or (p_config ? 'provider' and jsonb_typeof(p_config->'provider')<>'string') then
    raise exception 'Choose a supported discovery source.' using errcode='22023';
  end if;
  result:=public.save_discovery_source_core(p_actor,p_config-'provider',p_id,p_expected);
  if p_id is null then
    update public.discovery_sources set provider=source_provider where id=(result->>'id')::uuid;
    result:=result||jsonb_build_object('provider',source_provider);
    insert into public.agency_audit(actor_id,action,details)
      values(p_actor,'discovery_provider_approved',jsonb_build_object('source_id',result->>'id','provider',source_provider));
  end if;
  return result;
end;
$$;
revoke all on function public.save_discovery_source(uuid,jsonb,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.save_discovery_source(uuid,jsonb,uuid,timestamptz) to service_role;

notify pgrst,'reload schema';
commit;
