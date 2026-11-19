begin;
do $test$
declare
  actor uuid;
  original_timezone text;
  changed_timezone text;
  original_revision integer;
begin
  select user_id into actor from agency_members where active and role='owner' order by user_id limit 1;
  if actor is null then raise exception 'An active owner is required for the agency timezone fixture'; end if;
  select timezone,configuration_revision into original_timezone,original_revision from outreach_settings where id=1;
  changed_timezone:=case when original_timezone='America/Los_Angeles' then 'America/Phoenix' else 'America/Los_Angeles' end;

  perform save_agency_outreach_settings_versioned(actor,jsonb_build_object('timezone',changed_timezone),original_revision);
  if not exists(select 1 from outreach_settings where id=1 and timezone=changed_timezone
    and configuration_revision=original_revision+1) then
    raise exception 'Agency timezone was not saved as a versioned settings change';
  end if;
  if not exists(select 1 from automation_configuration_versions where revision=original_revision+1
    and configuration->'outreach'->>'timezone'=changed_timezone) then
    raise exception 'Agency timezone is missing from its settings history';
  end if;
  if not exists(select 1 from agency_audit where actor_id=actor and action='agency_timezone_changed'
    and details->>'to'=changed_timezone) then
    raise exception 'Agency timezone change was not audited';
  end if;
  begin
    perform save_agency_outreach_settings_versioned(actor,jsonb_build_object('timezone','Mars/Phobos'),original_revision+1);
    raise exception 'Unsupported agency timezone was accepted';
  exception when check_violation then null; end;
end;
$test$;
rollback;
