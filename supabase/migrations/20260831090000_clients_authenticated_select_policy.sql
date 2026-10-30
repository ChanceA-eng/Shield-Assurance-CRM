alter table if exists public.clients enable row level security;

drop policy if exists "Authenticated agency users can read clients" on public.clients;

create policy "Authenticated agency users can read clients"
  on public.clients
  for select
  to authenticated
  using (true);