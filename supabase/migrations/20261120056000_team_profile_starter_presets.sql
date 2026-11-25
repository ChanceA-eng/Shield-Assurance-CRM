begin;

do $migration$
declare
  producer jsonb := '{
    "leads.view":"assigned",
    "accounts.view":"assigned",
    "documents.view":"assigned",
    "messages.view":"assigned",
    "messages.send":"assigned",
    "tasks.view":"self",
    "tasks.edit":"self",
    "calendar.view":"self",
    "calendar.edit":"self",
    "dashboard.view":"assigned"
  }'::jsonb;
  account_service jsonb := '{
    "accounts.view":"assigned",
    "policies.view":"assigned",
    "documents.view":"assigned",
    "messages.view":"assigned",
    "messages.send":"assigned",
    "tasks.view":"self",
    "tasks.edit":"self",
    "calendar.view":"self",
    "calendar.edit":"self",
    "dashboard.view":"assigned"
  }'::jsonb;
begin
  perform public.team_validate_access(producer);
  perform public.team_validate_access(account_service);

  insert into public.team_profile_presets(name, grants)
  values ('Producer', producer), ('Account Service', account_service)
  on conflict do nothing;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
