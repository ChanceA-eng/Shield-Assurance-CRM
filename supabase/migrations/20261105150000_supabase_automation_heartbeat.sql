begin;
create extension if not exists pg_net with schema extensions;

create function public.queue_crm_heartbeat()
returns bigint language plpgsql security definer set search_path=public as $$
declare endpoint text; bearer_secret text; request_id bigint;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='crm_heartbeat_endpoint';
  select decrypted_secret into bearer_secret from vault.decrypted_secrets where name='crm_heartbeat_authorization';
  if endpoint is distinct from 'https://shield-assurance-crm.vercel.app/api/cron/heartbeat' or nullif(bearer_secret,'') is null then
    raise exception 'CRM heartbeat credentials are not configured' using errcode='P0002';
  end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer_secret),
    body:='{}'::jsonb,timeout_milliseconds:=65000) into request_id;
  return request_id;
end;
$$;

do $$
declare job bigint;
begin
  job:=cron.schedule('crm-due-reminders','* * * * *','select public.dispatch_due_reminders()');
  perform cron.alter_job(job,active:=false);
  job:=cron.schedule('crm-web-heartbeat','*/5 * * * *','select public.queue_crm_heartbeat()');
  perform cron.alter_job(job,active:=false);
end;
$$;

create function public.crm_scheduler_status()
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
    from automation_runs where job='server-heartbeat' order by started_at desc limit 1));
$$;

create function public.configure_crm_scheduler(p_actor uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job record;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if p_enabled is null or not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can change background scheduling' using errcode='42501';
  end if;
  if p_enabled and not (crm_scheduler_status()->>'configured')::boolean then
    raise exception 'Requires a deployment change: provision and verify the heartbeat credentials.' using errcode='P0002';
  end if;
  for job in select jobid from cron.job where jobname in ('crm-due-reminders','crm-web-heartbeat') loop
    perform cron.alter_job(job.jobid,active:=p_enabled);
  end loop;
  insert into agency_audit(actor_id,action,details) values(p_actor,'automation_scheduler_changed',jsonb_build_object('enabled',p_enabled));
  return crm_scheduler_status();
end;
$$;
revoke all on function public.queue_crm_heartbeat(),public.crm_scheduler_status(),public.configure_crm_scheduler(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.crm_scheduler_status(),public.configure_crm_scheduler(uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
