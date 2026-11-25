begin;
do $test$
declare producer jsonb; account_service jsonb; marketing jsonb;
begin
  select grants into producer from public.team_profile_presets where lower(name)='producer' and active;
  if producer is distinct from '{
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
  }'::jsonb then
    raise exception 'The Producer preset must use assigned customer access and personal work access only.';
  end if;

  select grants into account_service from public.team_profile_presets where lower(name)='account service' and active;
  if account_service is distinct from '{
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
  }'::jsonb then
    raise exception 'The Account Service preset must use assigned customer access and personal work access only.';
  end if;

  select grants into marketing from public.team_profile_presets where lower(name)='marketing' and active;
  if marketing is distinct from '{
    "dashboard.view":"assigned",
    "content.view":"agency",
    "content.edit":"agency",
    "social.view":"agency",
    "social.edit":"agency"
  }'::jsonb then
    raise exception 'The Marketing preset must allow agency content drafts without customer or publishing access.';
  end if;
end;
$test$;
rollback;
