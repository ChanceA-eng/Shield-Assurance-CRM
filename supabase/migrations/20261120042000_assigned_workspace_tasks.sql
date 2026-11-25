begin;

create or replace view public.active_workspace_tasks
with (security_invoker = true) as
select t.* from public.tasks t
where not exists (
  select 1 from public.leads l
  where t.related_type='lead' and l.id=t.related_id and l.archived_at is not null
);

create function public.team_assigned_workspace_tasks(p_actor uuid,p_include_archived boolean default false)
returns setof public.tasks
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.team_has_permission(p_actor,'tasks.view','assigned') then
    raise exception 'Assigned task access is required.' using errcode='42501';
  end if;
  return query
    select t.* from public.tasks t
    where (p_include_archived or not exists(select 1 from public.leads archived
      where t.related_type='lead' and archived.id=t.related_id and archived.archived_at is not null))
      and ((t.created_by_user_id=p_actor and t.related_id is null and t.account_id is null)
        or exists(select 1 from public.clients c where c.id=t.account_id and c.agent_user_id=p_actor)
        or (t.related_type='client' and exists(
          select 1 from public.clients c where c.id=t.related_id and c.agent_user_id=p_actor))
        or (t.related_type='lead' and exists(
          select 1 from public.leads l where l.id=t.related_id and l.agent_user_id=p_actor)));
end;
$$;
revoke all on function public.team_assigned_workspace_tasks(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.team_assigned_workspace_tasks(uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
