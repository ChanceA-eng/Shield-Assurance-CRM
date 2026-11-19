begin;
do $test$
declare actor uuid:=gen_random_uuid(); agent uuid:=gen_random_uuid(); info jsonb; job_count integer;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'heartbeat-owner-'||actor||'@example.invalid',now()),
    (agent,'heartbeat-agent-'||agent||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=actor then 'owner' else 'agent' end from auth.users where id in(actor,agent);
  info:=crm_scheduler_status();
  if info::text like '%decrypted_secret%' or info::text like '%Authorization%' then raise exception 'Scheduler status leaked credential fields'; end if;
  select count(*) into job_count from cron.job where jobname in ('crm-due-reminders','crm-web-heartbeat');
  if job_count<>2 then raise exception 'Expected exactly two background jobs'; end if;
  if not exists(select 1 from cron.job where jobname='crm-due-reminders' and schedule='* * * * *')
    or not exists(select 1 from cron.job where jobname='crm-web-heartbeat' and schedule='*/5 * * * *') then raise exception 'Heartbeat schedules incorrect'; end if;
  begin perform configure_crm_scheduler(agent,false); raise exception 'Agent changed scheduler'; exception when insufficient_privilege then null; end;
  info:=configure_crm_scheduler(actor,false);
  if exists(select 1 from cron.job where jobname in ('crm-due-reminders','crm-web-heartbeat') and active) then raise exception 'Scheduler pause failed'; end if;
  if has_function_privilege('service_role','public.queue_crm_heartbeat()','execute')
    or has_function_privilege('authenticated','public.configure_crm_scheduler(uuid,boolean)','execute') then raise exception 'Scheduler execution grants unsafe'; end if;
  -- No queue function is called: fixtures never contact the live website or run due sends.
end;
$test$;
rollback;
