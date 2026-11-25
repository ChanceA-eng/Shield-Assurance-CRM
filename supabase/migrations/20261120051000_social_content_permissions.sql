begin;

create function public.team_can_social_content(p_actor uuid,p_action text)
returns boolean language sql stable security definer set search_path=public as $$
  select case p_action
    when 'view' then public.team_has_permission(p_actor,'social.view','agency')
    when 'edit' then public.team_has_permission(p_actor,'social.edit','agency')
    when 'delete' then public.team_has_permission(p_actor,'social.delete','agency')
    else false
  end
$$;
revoke all on function public.team_can_social_content(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.team_can_social_content(uuid,text) to service_role;

do $migration$
declare patch record; definition text; anchor text := 'workspace:=social_marketing_workspace_for(p_actor);';
begin
  for patch in select * from (values
    ('public.list_social_drafts(uuid,text,integer,uuid)', '''view'''),
    ('public.list_social_media(uuid,integer,uuid)', '''view'''),
    ('public.reserve_social_media(uuid,text,text,text)', '''edit'''),
    ('public.complete_social_media(uuid,uuid,integer,integer,integer)', '''edit'''),
    ('public.save_social_draft(uuid,uuid,text,text,text,integer,uuid[],text)',
      'case when p_action=''archive'' then ''delete'' when p_action in (''create'',''update'') then ''edit'' else null end')
  ) as patches(signature, permission)
  loop
    select pg_get_functiondef(patch.signature::regprocedure) into definition;
    if position(anchor in definition)=0 or
      length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
      raise exception 'Social content authorization anchor not found exactly once: %',patch.signature;
    end if;
    definition:=replace(definition,anchor,anchor||chr(10)||
      '  if ('||patch.permission||') is not null and not public.team_can_social_content(p_actor,'||patch.permission||
      ') then raise exception ''Social content permission is required.'' using errcode=''42501''; end if;');
    execute definition;
  end loop;
end;
$migration$;

notify pgrst,'reload schema';
commit;
