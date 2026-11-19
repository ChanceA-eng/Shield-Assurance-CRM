begin;

create or replace function public.crm_reporting_summary(
  p_range_start date,
  p_range_end date,
  p_month_start date,
  p_year_start date,
  p_carrier text
)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with filtered_policies as (
  select policy.id,policy.insured_name,policy.carrier,policy.premium,policy.effective_date,
    policy.renewal_date,policy.expiration_date,policy.status,policy.created_at
  from public.policies policy
  where policy.effective_date between p_range_start and p_range_end
    and (p_carrier='all' or policy.carrier=p_carrier)
),
trend as (
  select date_trunc('month',policy.effective_date)::date as month,
    sum(coalesce(policy.premium,0)) as premium
  from filtered_policies policy
  group by date_trunc('month',policy.effective_date)::date
),
carrier_mix as (
  select coalesce(nullif(btrim(policy.carrier),''),'Unknown') as carrier,
    count(*)::integer as count,sum(coalesce(policy.premium,0)) as premium
  from filtered_policies policy
  group by coalesce(nullif(btrim(policy.carrier),''),'Unknown')
  order by count(*) desc,carrier
),
claim_status as (
  select claim.status,count(*)::integer as value
  from public.claims claim
  join public.policies policy on policy.id=claim.policy_id
  where p_carrier='all' or policy.carrier=p_carrier
  group by claim.status
),
lead_pipeline as (
  select lower(coalesce(nullif(lead.status,''),'new')) as stage,count(*)::integer as value
  from public.leads lead
  where lead.archived_at is null
  group by lower(coalesce(nullif(lead.status,''),'new'))
),
carrier_options as (
  select distinct btrim(policy.carrier) as carrier
  from public.policies policy
  where nullif(btrim(policy.carrier),'') is not null
)
select jsonb_build_object(
  'metrics',jsonb_build_object(
    'mtd_written_premium',coalesce((select sum(coalesce(policy.premium,0)) from public.policies policy
      where policy.effective_date between p_month_start and p_range_end
        and (p_carrier='all' or policy.carrier=p_carrier)),0),
    'ytd_written_premium',coalesce((select sum(coalesce(policy.premium,0)) from public.policies policy
      where policy.effective_date between p_year_start and p_range_end
        and (p_carrier='all' or policy.carrier=p_carrier)),0),
    'active_clients',(select count(*)::integer from public.clients),
    'active_policies',(select count(*)::integer from public.policies policy
      where policy.status in ('active','issued') and (p_carrier='all' or policy.carrier=p_carrier)),
    'open_claims',(select count(*)::integer from public.claims claim
      join public.policies policy on policy.id=claim.policy_id
      where claim.status='open' and (p_carrier='all' or policy.carrier=p_carrier)),
    'open_endorsements',(select count(*)::integer from public.endorsements endorsement
      join public.policies policy on policy.id=endorsement.policy_id
      where endorsement.status='open' and (p_carrier='all' or policy.carrier=p_carrier))
  ),
  'premiumTrend',coalesce((select jsonb_agg(jsonb_build_object(
    'month',to_char(trend.month,'Mon YYYY'),'premium',trend.premium) order by trend.month) from trend),'[]'::jsonb),
  'carrierMix',coalesce((select jsonb_agg(jsonb_build_object(
    'carrier',carrier_mix.carrier,'count',carrier_mix.count,'premium',carrier_mix.premium)) from carrier_mix),'[]'::jsonb),
  'claimsStatus',coalesce((select jsonb_agg(jsonb_build_object(
    'status',claim_status.status,'value',claim_status.value) order by claim_status.status) from claim_status),'[]'::jsonb),
  'leadPipeline',coalesce((select jsonb_agg(jsonb_build_object(
    'stage',lead_pipeline.stage,'value',lead_pipeline.value) order by lead_pipeline.stage) from lead_pipeline),'[]'::jsonb),
  'carrierOptions',coalesce((select jsonb_agg(carrier_options.carrier order by carrier_options.carrier) from carrier_options),'[]'::jsonb),
  'drilldowns',jsonb_build_object(
    'policies',coalesce((select jsonb_agg(to_jsonb(items)) from (
      select id,insured_name,carrier,premium,effective_date,renewal_date,status
      from filtered_policies order by effective_date desc,id limit 8
    ) items),'[]'::jsonb),
    'claims',coalesce((select jsonb_agg(to_jsonb(items)) from (
      select claim.id,claim.type,claim.status,claim.date_of_loss,policy.insured_name,policy.carrier
      from public.claims claim join public.policies policy on policy.id=claim.policy_id
      where claim.created_at::date between p_range_start and p_range_end
        and (p_carrier='all' or policy.carrier=p_carrier)
      order by claim.created_at desc,claim.id limit 8
    ) items),'[]'::jsonb),
    'endorsements',coalesce((select jsonb_agg(to_jsonb(items)) from (
      select endorsement.id,endorsement.type,endorsement.status,endorsement.effective_date,policy.insured_name,policy.carrier
      from public.endorsements endorsement join public.policies policy on policy.id=endorsement.policy_id
      where endorsement.created_at::date between p_range_start and p_range_end
        and (p_carrier='all' or policy.carrier=p_carrier)
      order by endorsement.created_at desc,endorsement.id limit 8
    ) items),'[]'::jsonb),
    'leads',coalesce((select jsonb_agg(to_jsonb(items)) from (
      select id,full_name,status,line_of_business,source
      from public.leads where archived_at is null and created_at::date between p_range_start and p_range_end
      order by created_at desc,id limit 8
    ) items),'[]'::jsonb)
  )
);
$$;

revoke all on function public.crm_reporting_summary(date,date,date,date,text) from public, anon, authenticated;
grant execute on function public.crm_reporting_summary(date,date,date,date,text) to service_role;

commit;
