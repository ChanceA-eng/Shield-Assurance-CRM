create extension if not exists pgcrypto;

alter table if exists public.clients
  add column if not exists account_type text not null default 'unknown',
  add column if not exists assigned_producer text,
  add column if not exists csr text,
  add column if not exists since_date date;

alter table if exists public.clients
  alter column account_type set default 'unknown';

alter table if exists public.clients
  drop constraint if exists clients_account_type_check;

alter table if exists public.clients
  add constraint clients_account_type_check check (account_type in ('unknown', 'personal', 'commercial')) not valid;

update public.clients
set account_type = 'unknown'
where account_type = 'personal';

drop view if exists public.accounts;

create or replace view public.accounts
with (security_invoker = true) as
select
  id,
  full_name,
  phone,
  email,
  address,
  source,
  account_type,
  assigned_producer,
  csr,
  since_date,
  email_consent,
  sms_consent,
  preferred_channel,
  policy_effective_at,
  last_viewed_at,
  last_activity_at,
  created_at
from public.clients;

alter table if exists public.policies
  add column if not exists account_id uuid references public.clients(id) on delete set null,
  add column if not exists sub_type text,
  add column if not exists expiration_date date,
  add column if not exists billing_type text,
  add column if not exists source text not null default 'manual',
  add column if not exists prior_policy_id uuid references public.policies(id) on delete set null;

update public.policies
set
  account_id = coalesce(account_id, client_id),
  expiration_date = coalesce(expiration_date, renewal_date),
  sub_type = coalesce(sub_type, line_of_business)
where account_id is null
   or expiration_date is null
   or sub_type is null;

create index if not exists policies_account_id_idx on public.policies(account_id);
create index if not exists policies_expiration_date_idx on public.policies(expiration_date);
create index if not exists policies_source_idx on public.policies(source);
create index if not exists policies_prior_policy_id_idx on public.policies(prior_policy_id);

create or replace function public.sync_policy_account_columns()
returns trigger as $$
begin
  new.account_id := coalesce(new.account_id, new.client_id);
  new.client_id := coalesce(new.client_id, new.account_id);
  new.expiration_date := coalesce(new.expiration_date, new.renewal_date);
  new.renewal_date := coalesce(new.renewal_date, new.expiration_date);
  new.sub_type := coalesce(new.sub_type, new.line_of_business);
  return new;
end;
$$ language plpgsql;

drop trigger if exists sync_policy_account_columns_trigger on public.policies;
create trigger sync_policy_account_columns_trigger
  before insert or update on public.policies
  for each row execute function public.sync_policy_account_columns();

create table if not exists public.policy_change_requests (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  requested_at timestamptz not null default now(),
  description text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'processed')),
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists policy_change_requests_policy_id_idx on public.policy_change_requests(policy_id);
create index if not exists policy_change_requests_status_idx on public.policy_change_requests(status);

create table if not exists public.policy_transactions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  transaction_type text not null,
  effective_date date not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists policy_transactions_policy_id_idx on public.policy_transactions(policy_id);
create index if not exists policy_transactions_effective_date_idx on public.policy_transactions(effective_date);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.clients(id) on delete cascade,
  line_of_business text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists applications_account_id_idx on public.applications(account_id);
create index if not exists applications_status_idx on public.applications(status);

drop view if exists public.renewals;

create or replace view public.renewals
with (security_invoker = true) as
select
  p.*,
  case
    when p.expiration_date < current_date then 'overdue'
    when p.expiration_date <= current_date + interval '30 days' then '0-30'
    when p.expiration_date <= current_date + interval '60 days' then '31-60'
    when p.expiration_date <= current_date + interval '90 days' then '61-90'
    else 'future'
  end as renewal_bucket
from public.policies p
where p.status = 'active'
  and p.expiration_date is not null
  and p.expiration_date <= current_date + interval '90 days';

alter table if exists public.claims
  add column if not exists account_id uuid references public.clients(id) on delete cascade,
  add column if not exists claim_number text,
  add column if not exists adjuster_name text,
  add column if not exists adjuster_contact text,
  add column if not exists reserve_amount numeric(12,2),
  add column if not exists payout_amount numeric(12,2);

update public.claims
set account_id = coalesce(account_id, client_id)
where account_id is null;

create index if not exists claims_account_id_idx on public.claims(account_id);
create index if not exists claims_claim_number_idx on public.claims(claim_number);

create or replace function public.sync_claim_account_columns()
returns trigger as $$
begin
  new.account_id := coalesce(new.account_id, new.client_id);
  new.client_id := coalesce(new.client_id, new.account_id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists sync_claim_account_columns_trigger on public.claims;
create trigger sync_claim_account_columns_trigger
  before insert or update on public.claims
  for each row execute function public.sync_claim_account_columns();

alter table if exists public.certificates
  alter column policy_id drop not null,
  add column if not exists account_id uuid references public.clients(id) on delete cascade,
  add column if not exists holder_name text,
  add column if not exists holder_address text,
  add column if not exists issued_date date,
  add column if not exists expiration_date date,
  add column if not exists coverage_summary text,
  add column if not exists file_path text,
  add column if not exists is_master boolean not null default false,
  add column if not exists master_template_id uuid references public.certificates(id) on delete set null;

update public.certificates
set
  account_id = coalesce(account_id, client_id),
  holder_name = coalesce(holder_name, certificate_holder),
  issued_date = coalesce(issued_date, issue_date),
  coverage_summary = coalesce(coverage_summary, description)
where account_id is null
   or holder_name is null
   or issued_date is null
   or coverage_summary is null;

create index if not exists certificates_account_id_idx on public.certificates(account_id);
create index if not exists certificates_expiration_date_idx on public.certificates(expiration_date);
create index if not exists certificates_master_template_id_idx on public.certificates(master_template_id);

create or replace function public.sync_certificate_account_columns()
returns trigger as $$
begin
  new.account_id := coalesce(new.account_id, new.client_id);
  new.client_id := coalesce(new.client_id, new.account_id);
  new.holder_name := coalesce(new.holder_name, new.certificate_holder);
  new.certificate_holder := coalesce(new.certificate_holder, new.holder_name);
  new.issued_date := coalesce(new.issued_date, new.issue_date);
  new.issue_date := coalesce(new.issue_date, new.issued_date);
  new.coverage_summary := coalesce(new.coverage_summary, new.description);
  return new;
end;
$$ language plpgsql;

drop trigger if exists sync_certificate_account_columns_trigger on public.certificates;
create trigger sync_certificate_account_columns_trigger
  before insert or update on public.certificates
  for each row execute function public.sync_certificate_account_columns();

create table if not exists public.billing_records (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  account_id uuid not null references public.clients(id) on delete cascade,
  invoice_date date not null,
  due_date date not null,
  amount numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('paid', 'pending', 'overdue', 'returned')),
  payment_method text,
  commission_percent numeric(6,3) not null default 0,
  commission_amount numeric(12,2) generated always as (round(amount * commission_percent / 100, 2)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_records_policy_id_idx on public.billing_records(policy_id);
create index if not exists billing_records_account_id_idx on public.billing_records(account_id);
create index if not exists billing_records_due_date_status_idx on public.billing_records(due_date, status);

alter table if exists public.tasks
  add column if not exists account_id uuid references public.clients(id) on delete cascade,
  add column if not exists assignee text;

create index if not exists tasks_account_id_idx on public.tasks(account_id);
create index if not exists tasks_assignee_idx on public.tasks(assignee);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent')),
  account_id uuid references public.clients(id) on delete set null,
  list_name text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaigns_account_id_idx on public.campaigns(account_id);
create index if not exists campaigns_status_idx on public.campaigns(status);

create table if not exists public.campaign_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  account_id uuid references public.clients(id) on delete set null,
  email text,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed', 'suppressed')),
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists campaign_sends_campaign_id_idx on public.campaign_sends(campaign_id);
create index if not exists campaign_sends_account_id_idx on public.campaign_sends(account_id);
create index if not exists campaign_sends_status_idx on public.campaign_sends(status);

create table if not exists public.personal_applicants (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  account_id uuid references public.clients(id) on delete cascade,
  vip boolean not null default false,
  labels text[] not null default array[]::text[],
  prefix text,
  first_name text not null,
  middle_initial text,
  last_name text not null,
  suffix text,
  address_state text,
  postal_code text,
  maiden_name text,
  nickname text,
  gender text,
  dob date,
  marital_status text,
  ssn_masked text,
  dl_number_masked text,
  dl_status text,
  dl_state text,
  education text,
  industry text,
  occupation text,
  occupation_years integer,
  prior_employer text,
  prior_employer_years integer,
  applicant_type text,
  customer_since date,
  account_name text,
  assigned_producer text,
  csr text,
  lead_source text,
  preferred_language text,
  primary_address_type text,
  primary_address text,
  unit text,
  address_line_2 text,
  city text,
  county text,
  postal_code_suffix text,
  years_at_address integer,
  months_at_address integer,
  phone_type text,
  phone_number text,
  email_type text,
  email_address text,
  bridge_email_to_carriers boolean not null default false,
  contact_method text,
  contact_time text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_applicants_link_check check (lead_id is not null or account_id is not null)
);

create unique index if not exists personal_applicants_lead_id_unique on public.personal_applicants(lead_id) where lead_id is not null;
create unique index if not exists personal_applicants_account_id_unique on public.personal_applicants(account_id) where account_id is not null;
create index if not exists personal_applicants_name_idx on public.personal_applicants(last_name, first_name);

alter table if exists public.leads
  add column if not exists pipeline_stage text not null default 'new',
  add column if not exists producer_owner text,
  add column if not exists close_probability numeric(5,2),
  add column if not exists expected_premium numeric(12,2);

alter table if exists public.leads
  drop constraint if exists leads_pipeline_stage_check;

alter table if exists public.leads
  add constraint leads_pipeline_stage_check check (pipeline_stage in ('new', 'contacted', 'quoted', 'proposal_sent', 'closed_won', 'closed_lost')) not valid;

update public.leads
set pipeline_stage = case
  when status = 'working' then 'contacted'
  when status = 'quoted' then 'quoted'
  when status = 'closed' then 'closed_won'
  when status in ('new', 'lead', 'prospect') then 'new'
  else pipeline_stage
end
where pipeline_stage = 'new';

create index if not exists leads_pipeline_stage_idx on public.leads(pipeline_stage);
create index if not exists leads_producer_owner_idx on public.leads(producer_owner);

create table if not exists public.workflow_rules (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('account_created', 'policy_bound', 'policy_expiring_30', 'policy_expiring_15', 'claim_opened')),
  action_type text not null check (action_type in ('create_task', 'send_email_template', 'create_note')),
  template_id uuid,
  content text,
  offset_days integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_rules_action_content_check check (template_id is not null or content is not null)
);

create index if not exists workflow_rules_trigger_type_idx on public.workflow_rules(trigger_type);
create index if not exists workflow_rules_active_idx on public.workflow_rules(active);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists policy_change_requests_updated_at_trigger on public.policy_change_requests;
create trigger policy_change_requests_updated_at_trigger
  before update on public.policy_change_requests
  for each row execute function public.set_updated_at();

drop trigger if exists billing_records_updated_at_trigger on public.billing_records;
create trigger billing_records_updated_at_trigger
  before update on public.billing_records
  for each row execute function public.set_updated_at();

drop trigger if exists applications_updated_at_trigger on public.applications;
create trigger applications_updated_at_trigger
  before update on public.applications
  for each row execute function public.set_updated_at();

drop trigger if exists campaigns_updated_at_trigger on public.campaigns;
create trigger campaigns_updated_at_trigger
  before update on public.campaigns
  for each row execute function public.set_updated_at();

drop trigger if exists personal_applicants_updated_at_trigger on public.personal_applicants;
create trigger personal_applicants_updated_at_trigger
  before update on public.personal_applicants
  for each row execute function public.set_updated_at();

drop trigger if exists workflow_rules_updated_at_trigger on public.workflow_rules;
create trigger workflow_rules_updated_at_trigger
  before update on public.workflow_rules
  for each row execute function public.set_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients',
    'leads',
    'policies',
    'claims',
    'certificates',
    'policy_change_requests',
    'policy_transactions',
    'applications',
    'billing_records',
    'campaigns',
    'campaign_sends',
    'personal_applicants',
    'tasks',
    'workflow_rules'
  ] loop
    execute format('alter table if exists public.%I enable row level security', table_name);
    execute format('drop policy if exists "Authenticated agency users can manage %s" on public.%I', table_name, table_name);
    execute format('create policy "Authenticated agency users can manage %s" on public.%I for all to authenticated using (true) with check (true)', table_name, table_name);
  end loop;
end $$;