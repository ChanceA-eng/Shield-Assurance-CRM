begin;

do $migration$
declare grants jsonb := '{
  "dashboard.view":"assigned",
  "content.view":"agency",
  "content.edit":"agency",
  "social.view":"agency",
  "social.edit":"agency"
}'::jsonb;
begin
  perform public.team_validate_access(grants);
  insert into public.team_profile_presets(name,grants)
    values('Marketing',grants)
    on conflict do nothing;
end;
$migration$;

notify pgrst,'reload schema';
commit;
