begin;

create function public.default_automation_configuration()
returns jsonb language sql immutable set search_path=public as $$
select $defaults${
  "schema_version":1,
  "intake":{"enabled":true,"warm_priority":"high","cold_priority":"medium","due_hour":16,"cold_next_business_day":true},
  "follow_up":{"enabled":true,"statuses":["new","contacted","quoted"],"due_hour":9,"priority":"medium"},
  "reply":{"enabled":true,"due_minutes":120,"complete_on_successful_send":true},
  "renewal":{"enabled":true,"window_days":45,"grace_days":7,"milestones":[45,30,15,7,0],"task_days_before":30,"urgent_days_before":15},
  "sequence":{"total_steps":3,"step_gap_days":5,"auto_enroll_imports":false,"auto_enroll_website":false},
  "reminders":{"enabled":true},
  "service":{"tasks_enabled":true,"acknowledgment_email_enabled":true}
}$defaults$::jsonb;
$$;

alter table public.outreach_settings
  add column configuration_revision integer not null default 1 check(configuration_revision>0),
  add column automation_configuration jsonb not null default public.default_automation_configuration(),
  -- Editable policies are enabled only by migrations that wire their executors.
  add constraint automation_configuration_runtime_guard check(automation_configuration=public.default_automation_configuration());

create table public.automation_configuration_versions (
  revision integer primary key check(revision>0),
  actor_id uuid references auth.users(id) on delete set null,
  configuration jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.automation_configuration_versions enable row level security;
revoke all on public.automation_configuration_versions from public,anon,authenticated,service_role;
grant select on public.automation_configuration_versions to service_role;

create function public.automation_settings_snapshot(p_settings public.outreach_settings)
returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object('schema_version',1,'automation',p_settings.automation_configuration,
    'outreach',jsonb_build_object('approval_mode',p_settings.approval_mode,'daily_send_cap',p_settings.daily_send_cap,
      'send_window_start',p_settings.send_window_start,'send_window_end',p_settings.send_window_end,
      'opt_out_footer',p_settings.opt_out_footer,'sender_profile',p_settings.sender_profile));
$$;

insert into public.automation_configuration_versions(revision,configuration)
select configuration_revision,public.automation_settings_snapshot(s) from public.outreach_settings s where id=1;

create function public.version_automation_settings()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_when='BEFORE' then
    if public.automation_settings_snapshot(new) is distinct from public.automation_settings_snapshot(old) then
      new.configuration_revision:=old.configuration_revision+1;
    else new.configuration_revision:=old.configuration_revision;
    end if;
    return new;
  end if;
  if new.configuration_revision<>old.configuration_revision then
    insert into public.automation_configuration_versions(revision,actor_id,configuration)
    values(new.configuration_revision,nullif(current_setting('crm.settings_actor',true),'')::uuid,
      public.automation_settings_snapshot(new));
  end if;
  return null;
end;
$$;
create trigger version_automation_settings before update on public.outreach_settings
  for each row execute function public.version_automation_settings();
create trigger record_automation_settings_version after update on public.outreach_settings
  for each row execute function public.version_automation_settings();

alter function public.save_agency_outreach_settings(uuid,jsonb,boolean) rename to save_agency_outreach_settings_internal;
revoke all on function public.save_agency_outreach_settings_internal(uuid,jsonb,boolean) from public,anon,authenticated,service_role;

create function public.save_agency_outreach_settings(p_actor uuid,p_update jsonb,p_confirm_automatic boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform set_config('crm.settings_actor',coalesce(p_actor::text,''),true);
  perform public.save_agency_outreach_settings_internal(p_actor,p_update,p_confirm_automatic);
  perform set_config('crm.settings_actor','',true);
end;
$$;

create function public.save_agency_outreach_settings_versioned(
  p_actor uuid,p_update jsonb,p_expected_revision integer,p_confirm_automatic boolean default false
)
returns integer language plpgsql security definer set search_path=public as $$
declare current_revision integer;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from public.agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can change agency settings' using errcode='42501';
  end if;
  select configuration_revision into current_revision from public.outreach_settings where id=1 for update;
  if not found then raise exception 'Agency settings are not initialized' using errcode='P0002'; end if;
  if p_expected_revision is null or p_expected_revision<>current_revision then
    raise exception 'Settings changed since you opened them. Reload before saving.' using errcode='PT409';
  end if;
  perform public.save_agency_outreach_settings(p_actor,p_update,p_confirm_automatic);
  select configuration_revision into current_revision from public.outreach_settings where id=1;
  return current_revision;
end;
$$;

revoke all on function public.save_agency_outreach_settings(uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.save_agency_outreach_settings_versioned(uuid,jsonb,integer,boolean) from public,anon,authenticated;
revoke all on function public.version_automation_settings() from public,anon,authenticated;
grant execute on function public.save_agency_outreach_settings(uuid,jsonb,boolean) to service_role;
grant execute on function public.save_agency_outreach_settings_versioned(uuid,jsonb,integer,boolean) to service_role;
notify pgrst,'reload schema';
commit;
