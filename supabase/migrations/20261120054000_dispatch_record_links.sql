begin;

create function public.team_dispatch_links_match(p_lead uuid,p_client uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select p_lead is null or exists(select 1 from public.leads l where l.id=p_lead
    and (p_client is null or l.account_id=p_client))
$$;
revoke all on function public.team_dispatch_links_match(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_dispatch_links_match(uuid,uuid) to service_role;

do $migration$
declare definition text; anchor text := 'select * into actor from agency_members where user_id=p_actor;';
begin
  select pg_get_functiondef('public.team_record_dispatch_allowed(uuid,uuid,uuid)'::regprocedure) into definition;
  if position(anchor in definition)=0 or length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'Record dispatch authorization anchor not found exactly once';
  end if;
  definition:=replace(definition,anchor,
    'if not public.team_dispatch_links_match(p_lead,p_client) then return false; end if;'||chr(10)||
    '  if p_lead is not null and p_client is null then select account_id into p_client from leads where id=p_lead; end if;'||chr(10)||
    '  '||anchor);
  execute definition;
end;
$migration$;

notify pgrst,'reload schema';
commit;
