begin;

create function public.team_request_access() returns jsonb
language sql stable security definer set search_path=public as $$
  select case
    when actor.role='owner' and actor.active then '{"mode":"legacy"}'::jsonb
    when actor.invitation_id is not null or rollout.enabled then
      jsonb_build_object('mode','restricted','grants',
        case when rollout.enabled then public.team_effective_access(auth.uid()) else '{}'::jsonb end)
    else '{"mode":"legacy"}'::jsonb
  end
  from public.team_access_rollout rollout
  left join public.agency_members actor on actor.user_id=auth.uid()
  where rollout.singleton;
$$;
revoke all on function public.team_request_access() from public,anon,authenticated,service_role;
grant execute on function public.team_request_access() to authenticated;

create function public.team_legacy_database_access() returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((public.team_request_access()->>'mode')='legacy',false);
$$;
revoke all on function public.team_legacy_database_access() from public,anon,authenticated,service_role;
grant execute on function public.team_legacy_database_access() to authenticated;

-- These direct clients must not inherit generic authenticated table or storage
-- access. Restricted workspaces use the checked server APIs instead.
do $$
declare target record;
begin
  for target in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and c.relrowsecurity and (
      (n.nspname='public' and c.relname not in ('agency_members'))
      or (n.nspname='storage' and c.relname='objects')
    )
  loop
    execute format('create policy team_legacy_database_access on %I.%I as restrictive for all to authenticated using ((select public.team_legacy_database_access())) with check ((select public.team_legacy_database_access()))',
      target.nspname,target.relname);
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;
