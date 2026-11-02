begin;

alter table public.outreach_settings add column sender_profile jsonb not null default
  '{"name":"Chance","role":"Insurance producer","agency":"Shield Assurance","service_area":"Tucson, Arizona","specialties":"","tone":"Direct, warm, professional; no hype.","signature":"Chance\nShield Assurance","approved_claims":""}'::jsonb
  check(jsonb_typeof(sender_profile) = 'object');

create table public.outreach_marketing_profiles (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid unique references public.leads(id) on delete cascade,
  client_id uuid unique references public.clients(id) on delete cascade,
  profile jsonb not null check(jsonb_typeof(profile) = 'object'),
  updated_at timestamptz not null default now(),
  check(num_nonnulls(lead_id,client_id) = 1)
);
alter table public.outreach_marketing_profiles enable row level security;
revoke all on public.outreach_marketing_profiles from public,anon,authenticated;
grant all on public.outreach_marketing_profiles to service_role;

notify pgrst,'reload schema';
commit;
