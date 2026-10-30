-- Import Center staging: vendor files land here for review before entering the pipeline.

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  vendor_profile text not null default 'generic', -- commercial | personal_auto | generic
  status text not null default 'review',          -- review | committed | discarded
  row_count integer not null default 0,
  prospect_count integer not null default 0,
  duplicate_count integer not null default 0,
  committed_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.import_prospects (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  address text,
  line_of_business text,
  disposition text not null default 'pending',    -- pending | committed | skipped | duplicate
  duplicate_of text,                              -- 'lead:<id>' or 'client:<id>'
  lead_id uuid,
  payload jsonb not null default '{}'::jsonb,     -- { profile, raw }
  created_at timestamptz not null default now()
);

create index if not exists import_prospects_batch_idx on public.import_prospects(batch_id, disposition);

alter table public.import_batches enable row level security;
alter table public.import_prospects enable row level security;
create policy "Authenticated agency users can manage import_batches" on public.import_batches for all to authenticated using (true) with check (true);
create policy "Authenticated agency users can manage import_prospects" on public.import_prospects for all to authenticated using (true) with check (true);
