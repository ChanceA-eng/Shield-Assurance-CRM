begin;

create function public.team_can_review_social(p_actor uuid,p_action text)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when p_action in ('submit','withdraw') then public.team_has_permission(p_actor,'social.edit','agency')
    when p_action in ('approve','request_changes') then public.team_has_permission(p_actor,'social.approve','agency')
    else false
  end
$$;
revoke all on function public.team_can_review_social(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.team_can_review_social(uuid,text) to service_role;

do $migration$
declare definition text; anchor text := 'if p_action in (''approve'',''request_changes'') then';
begin
  select pg_get_functiondef('public.review_social_draft(uuid,uuid,text,integer,integer,text)'::regprocedure) into definition;
  if position(anchor in definition)=0 then
    raise exception 'Social review authorization anchor not found';
  end if;
  definition := replace(definition,anchor,
    'if not public.team_can_review_social(p_actor,p_action) then raise exception ''Social review permission is required.'' using errcode=''42501''; end if;'||chr(10)||'  '||anchor);
  execute definition;
end;
$migration$;

notify pgrst,'reload schema';
commit;
