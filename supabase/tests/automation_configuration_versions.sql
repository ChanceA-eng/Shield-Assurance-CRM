begin;
do $test$
declare owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid(); revision integer; next_revision integer; old_cap integer;
  snapshots bigint; writes_before jsonb; writes_after jsonb; snapshot jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'automation-owner-'||owner_id||'@example.invalid',now()),
    (agent_id,'automation-agent-'||agent_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
    from auth.users where id in (owner_id,agent_id);
  select configuration_revision,daily_send_cap into revision,old_cap from outreach_settings where id=1;
  select count(*) into snapshots from automation_configuration_versions;
  select jsonb_build_object('leads',(select count(*) from leads),'tasks',(select count(*) from tasks),
    'enrollments',(select count(*) from sequence_enrollments),'outbox',(select count(*) from outreach_outbox),
    'messages',(select count(*) from communication_log),'notifications',(select count(*) from notifications)) into writes_before;
  begin
    perform save_agency_outreach_settings_versioned(agent_id,'{"daily_send_cap":30}',revision);
    raise exception 'An agent changed versioned settings';
  exception when insufficient_privilege then null; end;
  next_revision:=save_agency_outreach_settings_versioned(owner_id,jsonb_build_object('daily_send_cap',case when old_cap=30 then 31 else 30 end),revision);
  if next_revision<>revision+1 then raise exception 'Settings revision did not advance'; end if;
  if (select count(*) from automation_configuration_versions)<>snapshots+1 then raise exception 'Settings snapshot not captured exactly once'; end if;
  select configuration into snapshot from automation_configuration_versions where automation_configuration_versions.revision=next_revision and actor_id=owner_id;
  if snapshot is null or (snapshot#>>'{outreach,daily_send_cap}')::integer<>(case when old_cap=30 then 31 else 30 end)
    or snapshot->'automation'<>default_automation_configuration() then raise exception 'Snapshot is not the saved configuration'; end if;
  begin
    perform save_agency_outreach_settings_versioned(owner_id,'{"daily_send_cap":40}',revision);
    raise exception 'Stale save overwrote newer settings';
  exception when sqlstate 'PT409' then null; end;
  perform save_agency_outreach_settings_versioned(owner_id,jsonb_build_object('daily_send_cap',case when old_cap=30 then 31 else 30 end),next_revision);
  if (select configuration_revision from outreach_settings where id=1)<>next_revision
    or (select count(*) from automation_configuration_versions)<>snapshots+1 then raise exception 'No-op changed revision history'; end if;
  perform save_agency_outreach_settings(owner_id,jsonb_build_object('daily_send_cap',old_cap));
  if (select configuration_revision from outreach_settings where id=1)<>next_revision+1 then raise exception 'Legacy save bypassed versioning'; end if;
  if not exists(select 1 from automation_configuration_versions where automation_configuration_versions.revision=next_revision+1 and actor_id=owner_id) then
    raise exception 'Legacy save lost audit actor'; end if;
  begin
    update outreach_settings set automation_configuration=jsonb_set(automation_configuration,'{reply}','{"enabled":false}') where id=1;
    raise exception 'An unwired automation policy was enabled for editing';
  exception when check_violation or invalid_parameter_value then null; end;
  select jsonb_build_object('leads',(select count(*) from leads),'tasks',(select count(*) from tasks),
    'enrollments',(select count(*) from sequence_enrollments),'outbox',(select count(*) from outreach_outbox),
    'messages',(select count(*) from communication_log),'notifications',(select count(*) from notifications)) into writes_after;
  if writes_after<>writes_before then raise exception 'Saving configuration executed business work'; end if;
  if has_function_privilege('authenticated','public.save_agency_outreach_settings_versioned(uuid,jsonb,integer,boolean)','execute')
    or has_function_privilege('service_role','public.save_agency_outreach_settings_internal(uuid,jsonb,boolean)','execute')
    or has_table_privilege('authenticated','public.automation_configuration_versions','select')
    or has_table_privilege('service_role','public.automation_configuration_versions','update') then
    raise exception 'Configuration history or internal command grants are unsafe'; end if;
end;
$test$;
rollback;
