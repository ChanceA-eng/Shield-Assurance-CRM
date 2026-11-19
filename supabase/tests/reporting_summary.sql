do $$
declare
  v_account uuid := gen_random_uuid();
  v_policy_a uuid := gen_random_uuid();
  v_policy_b uuid := gen_random_uuid();
  v_policy_old uuid := gen_random_uuid();
  v_claim_a uuid := gen_random_uuid();
  v_claim_b uuid := gen_random_uuid();
  v_endorsement_a uuid := gen_random_uuid();
  v_endorsement_b uuid := gen_random_uuid();
  v_summary jsonb;
  v_before_all jsonb;
  v_before_a jsonb;
begin
  v_before_all:=public.crm_reporting_summary(current_date-30,current_date,current_date-30,date_trunc('year',current_date)::date,'all');
  v_before_a:=public.crm_reporting_summary(current_date-30,current_date,current_date-30,date_trunc('year',current_date)::date,'Fixture A');

  insert into public.clients(id,full_name) values(v_account,'Reporting summary fixture');
  insert into public.policies(id,client_id,account_id,insured_name,carrier,line_of_business,premium,effective_date,renewal_date,expiration_date,status)
  values
    (v_policy_a,v_account,v_account,'Reporting A','Fixture A','Commercial',120,current_date,current_date+365,current_date+365,'active'),
    (v_policy_b,v_account,v_account,'Reporting B','Fixture B','Commercial',80,current_date-1,current_date+364,current_date+364,'active'),
    (v_policy_old,v_account,v_account,'Reporting older','Fixture A','Commercial',200,current_date-45,current_date+320,current_date+320,'active');

  insert into public.claims(id,policy_id,client_id,account_id,type,status,date_of_loss)
  values
    (v_claim_a,v_policy_a,v_account,v_account,'Auto','open',current_date),
    (v_claim_b,v_policy_b,v_account,v_account,'Property','open',current_date);
  insert into public.endorsements(id,policy_id,client_id,type,status,effective_date)
  values
    (v_endorsement_a,v_policy_a,v_account,'Vehicle addition','open',current_date),
    (v_endorsement_b,v_policy_b,v_account,'Address change','open',current_date);

  v_summary:=public.crm_reporting_summary(current_date-30,current_date,current_date-30,date_trunc('year',current_date)::date,'all');
  if (v_summary#>>'{metrics,mtd_written_premium}')::numeric-(v_before_all#>>'{metrics,mtd_written_premium}')::numeric<>200
    or (v_summary#>>'{metrics,ytd_written_premium}')::numeric-(v_before_all#>>'{metrics,ytd_written_premium}')::numeric<>400 then
    raise exception 'Date-window and YTD written premium must include the complete effective-date ranges';
  end if;
  if jsonb_array_length(v_summary->'premiumTrend')=0
    or not (v_summary->'carrierOptions' ? 'Fixture A')
    or not (v_summary->'carrierOptions' ? 'Fixture B') then
    raise exception 'Trend and carrier options must reflect the selected period and all configured carriers';
  end if;

  v_summary:=public.crm_reporting_summary(current_date-30,current_date,current_date-30,date_trunc('year',current_date)::date,'Fixture A');
  if (v_summary#>>'{metrics,mtd_written_premium}')::numeric-(v_before_a#>>'{metrics,mtd_written_premium}')::numeric<>120
    or (v_summary#>>'{metrics,ytd_written_premium}')::numeric-(v_before_a#>>'{metrics,ytd_written_premium}')::numeric<>320
    or (v_summary#>>'{metrics,open_claims}')::integer-(v_before_a#>>'{metrics,open_claims}')::integer<>1
    or (v_summary#>>'{metrics,open_endorsements}')::integer-(v_before_a#>>'{metrics,open_endorsements}')::integer<>1 then
    raise exception 'Carrier selection must consistently filter premium, claims and endorsements';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_summary#>'{drilldowns,policies}') policy
    where policy->>'id'=v_policy_a::text and policy->>'carrier'='Fixture A'
  ) then
    raise exception 'Policy drilldowns must match the selected carrier and effective-date range';
  end if;
end;
$$;
