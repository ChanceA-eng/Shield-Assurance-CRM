begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid();
  previous_settings jsonb; after_settings jsonb; audit_count bigint; sender jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'settings-owner-'||owner_id||'@example.invalid',now()),
    (admin_id,'settings-admin-'||admin_id||'@example.invalid',now()),
    (agent_id,'settings-agent-'||agent_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role)
    select id,email,case when id=owner_id then 'owner' when id=admin_id then 'admin' else 'agent' end
    from auth.users where id in (owner_id,admin_id,agent_id);
  select to_jsonb(s) into previous_settings from outreach_settings s where id=1;
  select count(*) into audit_count from agency_audit where actor_id=owner_id;
  begin
    perform save_agency_outreach_settings(admin_id,'{"daily_send_cap":25}');
    raise exception 'An admin changed agency settings without delegation';
  exception when insufficient_privilege then null; end;
  begin
    perform save_agency_outreach_settings(agent_id,'{"approval_mode":false}',true);
    raise exception 'An agent changed the agency approval policy';
  exception when insufficient_privilege then null; end;
  begin
    perform manage_agency_member(admin_id,agent_id,'agent',false);
    raise exception 'An admin deactivated a member without delegation';
  exception when insufficient_privilege then null; end;
  begin
    perform save_agency_outreach_settings(owner_id,'{"daily_send_cap":201}');
    raise exception 'An invalid send cap was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_agency_outreach_settings(owner_id,'{"send_window_start":20,"send_window_end":10}');
    raise exception 'An invalid send window was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_agency_outreach_settings(owner_id,'{"daily_send_cap":1.5}');
    raise exception 'A fractional cap was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_agency_outreach_settings(owner_id,'{"api_key":"not-a-real-key"}');
    raise exception 'An infrastructure credential setting was accepted';
  exception when invalid_parameter_value then null; end;
  if previous_settings->>'approval_mode'='true' then
    begin
      perform save_agency_outreach_settings(owner_id,'{"approval_mode":false}');
      raise exception 'Approval was disabled without explicit confirmation';
    exception when invalid_parameter_value then null; end;
  end if;
  select to_jsonb(s) into after_settings from outreach_settings s where id=1;
  if after_settings is distinct from previous_settings then raise exception 'A failed update changed persisted settings'; end if;
  sender:=previous_settings->'sender_profile';
  perform save_agency_outreach_settings(owner_id,jsonb_build_object('daily_send_cap',25,'sender_profile',sender));
  if (select daily_send_cap from outreach_settings where id=1)<>25 then raise exception 'Owner settings were not persisted'; end if;
  if (select count(*) from agency_audit where actor_id=owner_id)<>audit_count+1 then raise exception 'Owner settings change was not audited exactly once'; end if;
  if not exists(select 1 from agency_audit where actor_id=owner_id and action='outreach_settings_changed' and details->'fields'='["daily_send_cap","sender_profile"]'::jsonb) then
    raise exception 'The audit did not record the changed fields';
  end if;
  if has_function_privilege('authenticated','public.save_agency_outreach_settings(uuid,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.save_agency_outreach_settings(uuid,jsonb,boolean)','EXECUTE')
    or has_table_privilege('authenticated','public.outreach_settings','UPDATE') then
    raise exception 'A direct client can bypass the authenticated settings API';
  end if;
  perform manage_agency_member(owner_id,agent_id,'agent',false);
  if (select active from agency_members where user_id=agent_id) then raise exception 'Owner deactivation failed'; end if;
end;
$test$;
rollback;
