begin;

create function public.team_can_archive_template(p_actor uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.team_has_permission(p_actor,'content.delete','agency') and exists(
    select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now()))
$$;
revoke all on function public.team_can_archive_template(uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_can_archive_template(uuid) to service_role;

do $migration$
declare definition text; anchor text := 'insert into sales_templates(id,name,category,subject,email_body,sms_body,email_design,archived,revision,updated_by)';
  edit_guard text := 'not public.team_has_permission(p_actor,''content.edit'',''agency'')';
begin
  select pg_get_functiondef('public.save_sales_template(uuid,text,integer,jsonb)'::regprocedure) into definition;
  if position(anchor in definition)=0 or length(definition)-length(replace(definition,anchor,''))<>length(anchor)
    or position(edit_guard in definition)=0 or length(definition)-length(replace(definition,edit_guard,''))<>length(edit_guard) then
    raise exception 'Template archive authorization anchor not found exactly once';
  end if;
  definition:=replace(definition,edit_guard,edit_guard||' or not exists(select 1 from auth.users u where u.id=p_actor'
    ||' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))');
  definition:=replace(definition,anchor,
    'if p_values->''archived''=''true''::jsonb and not coalesce(saved.archived,false)'||chr(10)||
    '    and not public.team_can_archive_template(p_actor) then'||chr(10)||
    '    raise exception ''Reusable content deletion permission is required to archive templates.'' using errcode=''42501'';'||chr(10)||
    '  end if;'||chr(10)||'  '||anchor);
  execute definition;
end;
$migration$;

notify pgrst,'reload schema';
commit;
