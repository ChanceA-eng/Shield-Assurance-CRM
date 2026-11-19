begin;

alter table public.outreach_settings
  add column timezone text not null default 'America/Phoenix'
  check (timezone in (
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Anchorage',
    'Pacific/Honolulu'
  ));

comment on column public.outreach_settings.timezone is
  'Agency time zone used for local outreach send windows and daily send-cap boundaries.';

create or replace function public.automation_settings_snapshot(p_settings public.outreach_settings)
returns jsonb language sql immutable set search_path=public as $$
  select jsonb_build_object('schema_version',1,'automation',p_settings.automation_configuration,
    'outreach',jsonb_build_object('approval_mode',p_settings.approval_mode,'daily_send_cap',p_settings.daily_send_cap,
      'send_window_start',p_settings.send_window_start,'send_window_end',p_settings.send_window_end,
      'timezone',p_settings.timezone,'opt_out_footer',p_settings.opt_out_footer,'sender_profile',p_settings.sender_profile));
$$;

create or replace function public.save_agency_outreach_settings(p_actor uuid,p_update jsonb,p_confirm_automatic boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare current_timezone text;
begin
  perform set_config('crm.settings_actor',coalesce(p_actor::text,''),true);
  if p_update is null or jsonb_typeof(p_update)<>'object' or p_update='{}'::jsonb then
    raise exception 'Provide settings to save' using errcode='22023';
  end if;
  if p_update ? 'timezone' then
    if jsonb_typeof(p_update->'timezone')<>'string' then
      raise exception 'Choose a supported agency time zone' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('agency-membership'));
    if not exists(select 1 from public.agency_members where user_id=p_actor and active and role='owner') then
      raise exception 'Only the agency owner can change agency settings' using errcode='42501';
    end if;
    select timezone into current_timezone from public.outreach_settings where id=1 for update;
    if not found then raise exception 'Agency outreach settings are not initialized' using errcode='P0002'; end if;
    update public.outreach_settings set timezone=p_update->>'timezone',updated_at=clock_timestamp()
      where id=1 and timezone is distinct from p_update->>'timezone';
    if current_timezone is distinct from p_update->>'timezone' then
      insert into public.agency_audit(actor_id,action,details)
      values(p_actor,'agency_timezone_changed',jsonb_build_object('from',current_timezone,'to',p_update->>'timezone'));
    end if;
  end if;
  if p_update-'timezone'<>'{}'::jsonb then
    perform public.save_agency_outreach_settings_internal(p_actor,p_update-'timezone',p_confirm_automatic);
  end if;
  perform set_config('crm.settings_actor','',true);
end;
$$;

revoke all on function public.save_agency_outreach_settings(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_agency_outreach_settings(uuid,jsonb,boolean) to service_role;
notify pgrst,'reload schema';
commit;
