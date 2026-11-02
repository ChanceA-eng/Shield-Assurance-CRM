begin;
create table public.quote_options (
  id uuid primary key,
  client_id uuid not null references public.clients(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete set null,
  source_lead_id uuid,
  carrier text not null check(length(trim(carrier)) between 1 and 160),
  line_of_business text not null check(length(trim(line_of_business)) between 1 and 120),
  premium numeric(14,2) not null check(premium>=0),
  effective_date date,
  expiration_date date,
  limits text not null default '',
  deductibles text not null default '',
  notes text not null default '',
  status text not null default 'draft' check(status in ('draft','presented','accepted','declined')),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(expiration_date is null or effective_date is null or expiration_date>effective_date)
);
create index quote_options_account_created on public.quote_options(client_id,created_at desc,id);
create table public.quote_option_history (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.quote_options(id) on delete restrict,
  snapshot jsonb not null,
  changed_at timestamptz not null default now()
);
create function public.audit_quote_option() returns trigger language plpgsql set search_path=public as $$
begin
  insert into quote_option_history(quote_id,snapshot) values(new.id,to_jsonb(new));
  return null;
end;
$$;
create trigger quote_option_audit after insert or update on public.quote_options for each row execute function public.audit_quote_option();
alter table public.quote_options enable row level security;
alter table public.quote_option_history enable row level security;
create policy quote_options_authenticated_read on public.quote_options for select to authenticated using(true);
create policy quote_history_authenticated_read on public.quote_option_history for select to authenticated using(true);
revoke all on public.quote_options,public.quote_option_history from public,anon,authenticated;
revoke all on sequence public.quote_option_history_id_seq from public,anon,authenticated;
revoke all on function public.audit_quote_option() from public,anon,authenticated;
grant select on public.quote_options,public.quote_option_history to authenticated;
grant all on public.quote_options,public.quote_option_history to service_role;
grant usage,select on sequence public.quote_option_history_id_seq to service_role;
notify pgrst,'reload schema';
commit;
