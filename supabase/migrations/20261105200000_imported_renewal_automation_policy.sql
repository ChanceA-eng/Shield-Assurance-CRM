begin;

create or replace function public.default_automation_configuration()
returns jsonb language sql immutable set search_path=public as $$
select $defaults${
  "schema_version":1,
  "intake":{"enabled":true,"warm_priority":"high","cold_priority":"medium","due_hour":16,"cold_next_business_day":true},
  "follow_up":{"enabled":true,"statuses":["new","contacted","quoted"],"due_hour":9,"priority":"medium"},
  "reply":{"enabled":true,"due_minutes":120,"complete_on_successful_send":true},
  "renewal":{"enabled":true,"window_days":45,"grace_days":7,"milestones":[45,30,15,7,0],"task_days_before":30,"urgent_days_before":15},
  "sequence":{"total_steps":3,"step_gap_days":5,"auto_enroll_imports":false,"auto_enroll_website":false},
  "import_renewal":{"tasks_enabled":true,"task_days_before":60},
  "reminders":{"enabled":true},
  "service":{"tasks_enabled":true,"acknowledgment_email_enabled":true}
}$defaults$::jsonb;
$$;

do $patch$
declare validation text:=pg_get_functiondef('public.validate_automation_configuration(jsonb)'::regprocedure);
  allows text:=pg_get_functiondef('public.automation_rule_allows(text,timestamp with time zone)'::regprocedure);
  activation text:=pg_get_functiondef('public.capture_automation_activation()'::regprocedure);
begin
  if strpos(validation,'if previous<>0 then raise exception')=0
    or strpos(allows,'case when p_rule=''service'' then ''tasks_enabled'' else ''enabled'' end')=0
    or strpos(activation,'k=''service'' then ''tasks_enabled'' else ''enabled'' end')=0 then
    raise exception 'Installed automation contract changed; inspect imported-renewal upgrade';
  end if;
  validation:=replace(validation,'  return true;',
    '  if (p_value#>>''{import_renewal,task_days_before}'')::numeric not between 0 and 365 then
    raise exception ''Imported renewal task timing must be between 0 and 365 days'' using errcode=''22023'';
  end if;
  return true;');
  execute validation;
  execute replace(allows,'case when p_rule=''service'' then ''tasks_enabled'' else ''enabled'' end',
    'case when p_rule in (''service'',''import_renewal'') then ''tasks_enabled'' else ''enabled'' end');
  execute replace(activation,'k=''service'' then ''tasks_enabled'' else ''enabled'' end',
    'k in (''service'',''import_renewal'') then ''tasks_enabled'' else ''enabled'' end');
end;
$patch$;

alter table public.automation_rule_activation drop constraint automation_rule_activation_rule_check;
alter table public.automation_rule_activation add constraint automation_rule_activation_rule_check
  check(rule in ('intake','follow_up','reply','renewal','reminders','service','import_renewal'));
insert into public.automation_rule_activation(rule) values('import_renewal');

update public.outreach_settings
  set automation_configuration=automation_configuration||jsonb_build_object('import_renewal',
    public.default_automation_configuration()->'import_renewal')
  where id=1 and not (automation_configuration?'import_renewal');
update public.automation_configuration_versions
  set configuration=jsonb_set(configuration,'{automation,import_renewal}',
    public.default_automation_configuration()->'import_renewal')
  where configuration#>'{automation,import_renewal}' is null;

create function public.import_renewal_due_date(p_renewal_date date,p_precision text,p_now timestamptz default clock_timestamp())
returns timestamptz language plpgsql stable set search_path=public as $$
declare days_before integer; term_start timestamptz; due timestamptz; local_day date;
begin
  if p_renewal_date is null or p_precision not in ('month','date')
    or (p_precision='month' and extract(day from p_renewal_date)<>1) then
    raise exception 'Imported renewal timing evidence is invalid' using errcode='22023';
  end if;
  select (automation_configuration#>>'{import_renewal,task_days_before}')::integer
    into days_before from outreach_settings where id=1;
  if days_before is null then raise exception 'Imported renewal settings are not initialized' using errcode='P0002'; end if;
  term_start:=((case when p_precision='month' then date_trunc('month',p_renewal_date)::date else p_renewal_date end)+time '09:00')
    at time zone 'America/Phoenix';
  due:=term_start-make_interval(days=>days_before);
  if due>p_now then return due; end if;
  local_day:=(p_now at time zone 'America/Phoenix')::date+1;
  while extract(isodow from local_day) in (6,7) loop local_day:=local_day+1; end loop;
  return (local_day+time '09:00') at time zone 'America/Phoenix';
end;
$$;

do $patch$
declare definition text:=pg_get_functiondef('public.promote_import_prospect_core(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
  old_loop text:='  for task in select value from jsonb_array_elements(p_tasks) loop';
  end_loop text:='    task_count:=task_count+1;
  end loop;
  if schedule_lead_intake';
  new_loop text:='  if exists(select 1 from jsonb_array_elements(p_tasks) as candidate(value)
    where nullif(btrim(candidate.value->>''subject''),'''') is null
      or nullif(btrim(candidate.value->>''description''),'''') is null
      or candidate.value->>''renewal_date'' is null
      or candidate.value->>''renewal_precision'' not in (''month'',''date'')) then
    raise exception ''An imported renewal verification task is incomplete'' using errcode=''22023'';
  end if;
  if automation_rule_allows(''import_renewal'',clock_timestamp()) then
  for task in select value from jsonb_array_elements(p_tasks) loop';
  new_end text:='    task_count:=task_count+1;
  end loop;
  end if;
  if schedule_lead_intake';
  begin_block text; end_block text;
begin
  if strpos(definition,old_loop)=0 or strpos(definition,end_loop)=0 then
    raise exception 'Import promotion task loop changed; inspect before configuring imported timing'; end if;
  definition:=replace(definition,old_loop,new_loop);
  definition:=replace(definition,end_loop,new_end);
  begin_block:='    if nullif(btrim(task->>''subject''),'''') is null or nullif(btrim(task->>''description''),'''') is null
      or task->>''renewal_date'' is null or task->>''renewal_precision'' not in (''month'',''date'') then
      raise exception ''An imported renewal verification task is incomplete'' using errcode=''22023'';
    end if;
    insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
      values(task->>''subject'',task->>''description'',
        import_renewal_due_date((task->>''renewal_date'')::date,task->>''renewal_precision''),''open'',''medium'',''lead'',lead);';
  end_block:='    task_count:=task_count+1;';
  definition:=replace(definition,
    '    if nullif(btrim(task->>''subject''),'''') is null or nullif(btrim(task->>''description''),'''') is null or task->>''due_date'' is null then
      raise exception ''A renewal follow-up is incomplete.'' using errcode=''22023'';
    end if;
    insert into tasks(subject,description,due_date,status,priority,related_type,related_id)
      values(task->>''subject'',task->>''description'',(task->>''due_date'')::timestamptz,''open'',''medium'',''lead'',lead);',begin_block);
  if definition=pg_get_functiondef('public.promote_import_prospect_core(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure)
    or strpos(definition,'import_renewal_due_date')=0 then
    raise exception 'Could not safely update imported task schedule'; end if;
  execute definition;
end;
$patch$;

revoke all on function public.import_renewal_due_date(date,text,timestamptz) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
