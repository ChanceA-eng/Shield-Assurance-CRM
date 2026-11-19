begin;
create table public.email_setup_checks (
  id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  expected_sender text not null,
  configuration_hash text not null check(configuration_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  verified_at timestamptz,
  inbound_provider_id text unique
);
create index email_setup_configuration_idx on public.email_setup_checks(configuration_hash,verified_at desc);
alter table public.email_setup_checks enable row level security;
revoke all on public.email_setup_checks from public,anon,authenticated;
grant all on public.email_setup_checks to service_role;

create function public.claim_email_setup_check(p_actor uuid,p_id uuid,p_configuration_hash text)
returns public.email_setup_checks language plpgsql security definer set search_path=public as $$
declare member agency_members; result email_setup_checks;
begin
  perform pg_advisory_xact_lock(hashtext('email-setup-check'));
  select * into member from agency_members where user_id=p_actor and active and role='owner';
  if member.user_id is null then raise exception 'Only the owner can test agency email' using errcode='42501'; end if;
  select * into result from email_setup_checks where id=p_id;
  if found then
    if result.actor_id<>p_actor or result.configuration_hash<>p_configuration_hash then
      raise exception 'This test belongs to another account or configuration' using errcode='42501';
    end if;
    if result.expires_at<=now() then raise exception 'This test expired. Start a new test' using errcode='22023'; end if;
    return result;
  end if;
  if exists(select 1 from email_setup_checks where actor_id=p_actor and created_at>now()-interval '1 minute') then
    raise exception 'Wait one minute before sending another test' using errcode='22023';
  end if;
  insert into email_setup_checks(id,actor_id,expected_sender,configuration_hash)
    values(p_id,p_actor,lower(member.email),p_configuration_hash) returning * into result;
  return result;
end;
$$;
revoke all on function public.claim_email_setup_check(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_email_setup_check(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
