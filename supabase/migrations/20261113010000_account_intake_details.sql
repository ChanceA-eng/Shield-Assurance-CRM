begin;

alter table public.clients
  add column if not exists intake_details jsonb not null default '{}'::jsonb
  check (jsonb_typeof(intake_details) = 'object');

commit;
