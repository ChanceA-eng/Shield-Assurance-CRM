begin;

create function public.team_account_document_allowed(p_actor uuid,p_client uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.agency_members m
    join auth.users u on u.id=m.user_id
    join public.clients c on c.id=p_client
    where m.user_id=p_actor and m.active and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
      and public.team_has_permission(p_actor,'accounts.view','assigned')
      and public.team_has_permission(p_actor,'documents.view','assigned')
      and ((public.team_has_permission(p_actor,'accounts.view','agency')
        and public.team_has_permission(p_actor,'documents.view','agency'))
        or c.agent_user_id=p_actor)
  )
$$;

revoke all on function public.team_account_document_allowed(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_account_document_allowed(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
