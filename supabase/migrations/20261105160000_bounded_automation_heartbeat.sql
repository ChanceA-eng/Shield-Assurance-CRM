begin;
-- Separate authenticated requests prevent sequential AI batches from exceeding the host's request budget.
create or replace function public.queue_crm_heartbeat()
returns bigint language plpgsql security definer set search_path=public as $$
declare endpoint text; bearer_secret text; request_id bigint; job text;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='crm_heartbeat_endpoint';
  select decrypted_secret into bearer_secret from vault.decrypted_secrets where name='crm_heartbeat_authorization';
  if endpoint is distinct from 'https://shield-assurance-crm.vercel.app/api/cron/heartbeat' or nullif(bearer_secret,'') is null then
    raise exception 'CRM heartbeat credentials are not configured' using errcode='P0002';
  end if;
  foreach job in array array['scheduled-messages','follow-up-routine','outreach','renewal-radar','website-intake','internal-actions'] loop
    select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer_secret),
      body:=jsonb_build_object('job',job),timeout_milliseconds:=65000) into request_id;
  end loop;
  return request_id;
end;
$$;

create or replace function public.crm_scheduler_status()
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'configured',exists(select 1 from vault.secrets where name='crm_heartbeat_endpoint')
    and exists(select 1 from vault.secrets where name='crm_heartbeat_authorization'),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active))
    from cron.job where jobname in ('crm-due-reminders','crm-web-heartbeat')),'[]'::jsonb),
  'last_dispatch',(select jsonb_build_object('status',d.status,'started_at',d.start_time,'finished_at',d.end_time,
    'error',case when d.status='failed' then left(d.return_message,240) else null end)
    from cron.job_run_details d join cron.job j using(jobid) where j.jobname='crm-web-heartbeat' order by d.start_time desc limit 1),
  'last_heartbeat',(select jsonb_build_object('status',status,'started_at',started_at,'finished_at',finished_at,'error',error)
    from automation_runs where job like 'server-heartbeat:%' order by started_at desc limit 1));
$$;
notify pgrst,'reload schema';
commit;
