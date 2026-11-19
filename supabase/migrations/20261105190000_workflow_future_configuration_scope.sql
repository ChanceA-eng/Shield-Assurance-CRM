begin;
do $patch$
declare definition text:=pg_get_functiondef('public.save_workflow_rule(uuid,uuid,integer,jsonb)'::regprocedure);
  previous text:='active_since=case when not active and (p_definition->>''active'')::boolean then clock_timestamp() else active_since end';
begin
  if strpos(definition,previous)=0 then raise exception 'Workflow save contract changed; review the activation scope before patching'; end if;
  execute replace(definition,previous,
    'active_since=case when definition-''name'' is distinct from p_definition-''name'' then clock_timestamp() else active_since end');
end;
$patch$;

create function reset_workflow_renewal_scope()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update workflow_rules set active_since=clock_timestamp() where active and trigger_type='renewal.milestone';
  return null;
end;
$$;
create trigger workflow_renewal_scope after update of automation_configuration on outreach_settings
  for each row when (
    old.automation_configuration#>'{renewal,window_days}' is distinct from new.automation_configuration#>'{renewal,window_days}'
    or old.automation_configuration#>'{renewal,grace_days}' is distinct from new.automation_configuration#>'{renewal,grace_days}'
    or old.automation_configuration#>'{renewal,milestones}' is distinct from new.automation_configuration#>'{renewal,milestones}')
  execute function reset_workflow_renewal_scope();
revoke all on function reset_workflow_renewal_scope() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
