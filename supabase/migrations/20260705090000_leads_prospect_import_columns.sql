alter table if exists public.leads
  add column if not exists website text,
  add column if not exists est_employees text,
  add column if not exists est_revenue text,
  add column if not exists risk_exposure text;
