begin;

create table public.policy_knowledge_candidates (
  id uuid primary key,
  account_id uuid not null references public.clients(id),
  created_by uuid not null references auth.users(id),
  carrier text not null,
  form_number text not null,
  edition text not null,
  jurisdiction text not null,
  line_of_business text not null,
  wording text not null check(length(wording) between 40 and 6000),
  scope text not null default 'Observed policy form wording; not carrier-wide underwriting appetite'
    check(scope='Observed policy form wording; not carrier-wide underwriting appetite'),
  revision integer not null default 1 check(revision > 0),
  state text not null default 'submitted'
    check(state in ('submitted','approved','rejected','published','withdrawn')),
  approved_by uuid references auth.users(id),
  approved_revision integer,
  document_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.policy_knowledge_review_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.policy_knowledge_candidates(id),
  actor_id uuid not null references auth.users(id),
  action text not null check(action in ('submitted','approved','rejected','published','withdrawn')),
  revision integer not null check(revision > 0),
  created_at timestamptz not null default now()
);
alter table public.policy_knowledge_candidates enable row level security;
alter table public.policy_knowledge_review_events enable row level security;
revoke all on public.policy_knowledge_candidates,public.policy_knowledge_review_events from public,anon,authenticated;
grant all on public.policy_knowledge_candidates,public.policy_knowledge_review_events to service_role;

create function public.protect_reviewed_policy_knowledge()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from policy_knowledge_candidates where id::text=old.id) then
    raise exception 'Use policy wording review to withdraw or replace an approved excerpt' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger protect_reviewed_policy_knowledge before update on public."KnowledgeDocument"
for each row execute function public.protect_reviewed_policy_knowledge();
revoke all on function public.protect_reviewed_policy_knowledge() from public,anon,authenticated;

create function public.save_policy_knowledge_candidate(p_actor uuid,p_id uuid,p_expected integer,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved policy_knowledge_candidates; owner_actor boolean;
begin
  if p_id is null or p_expected is null or p_expected<0 or p_values is null or jsonb_typeof(p_values)<>'object' then
    raise exception 'Provide a candidate ID, revision and reviewed values' using errcode='22023'; end if;
  perform 1 from agency_members where user_id=p_actor and active for share;
  if not found then raise exception 'Active agency membership required' using errcode='42501'; end if;
  select role='owner' into owner_actor from agency_members where user_id=p_actor;
  perform pg_advisory_xact_lock(hashtext('policy-knowledge:'||p_id::text));
  select * into saved from policy_knowledge_candidates where id=p_id for update;
  if coalesce(saved.revision,0)<>p_expected then raise exception 'Candidate changed. Reload before saving.' using errcode='PT409'; end if;
  if saved.id is not null and (saved.state in ('published','withdrawn') or (saved.created_by<>p_actor and not owner_actor)) then
    raise exception 'This candidate cannot be edited' using errcode='42501';
  end if;
  if saved.id is null and exists(select 1 from public."KnowledgeDocument" where id=p_id::text) then
    raise exception 'This identifier belongs to an existing knowledge document. Start a new submission.' using errcode='23505';
  end if;
  if coalesce(length(trim(p_values->>'carrier')),0) not between 1 and 150
    or coalesce(length(trim(p_values->>'form_number')),0) not between 1 and 100
    or coalesce(length(trim(p_values->>'edition')),0) not between 1 and 100
    or coalesce(length(trim(p_values->>'jurisdiction')),0) not between 1 and 100
    or coalesce(length(trim(p_values->>'line_of_business')),0) not between 1 and 100
    or coalesce(length(trim(p_values->>'wording')),0) not between 40 and 6000
    or p_values->'privacy_confirmed' is distinct from 'true'::jsonb
    or p_values->'rights_confirmed' is distinct from 'true'::jsonb then
    raise exception 'Provide reviewed de-identified wording, form context and reuse permission' using errcode='22023';
  end if;
  if not exists(select 1 from clients where id=(p_values->>'account_id')::uuid) then
    raise exception 'Account not found' using errcode='22023'; end if;
  insert into policy_knowledge_candidates(id,account_id,created_by,carrier,form_number,edition,jurisdiction,line_of_business,wording)
    values(p_id,(p_values->>'account_id')::uuid,p_actor,trim(p_values->>'carrier'),trim(p_values->>'form_number'),
      trim(p_values->>'edition'),trim(p_values->>'jurisdiction'),trim(p_values->>'line_of_business'),trim(p_values->>'wording'))
    on conflict(id) do update set account_id=excluded.account_id,carrier=excluded.carrier,
      form_number=excluded.form_number,edition=excluded.edition,jurisdiction=excluded.jurisdiction,
      line_of_business=excluded.line_of_business,wording=excluded.wording,revision=policy_knowledge_candidates.revision+1,
      state='submitted',approved_by=null,approved_revision=null,updated_at=clock_timestamp()
    returning * into saved;
  insert into policy_knowledge_review_events(candidate_id,actor_id,action,revision)
    values(saved.id,p_actor,'submitted',saved.revision);
  return to_jsonb(saved);
end;
$$;

create function public.review_policy_knowledge_candidate(p_actor uuid,p_id uuid,p_expected integer,p_approve boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved policy_knowledge_candidates;
begin
  if p_id is null or p_expected is null or p_expected<1 or p_approve is null then
    raise exception 'Provide a candidate ID, revision and review decision' using errcode='22023'; end if;
  perform 1 from agency_members where user_id=p_actor and active and role='owner' for share;
  if not found then raise exception 'Only an active owner can approve policy knowledge' using errcode='42501'; end if;
  select * into saved from policy_knowledge_candidates where id=p_id for update;
  if saved.id is null or saved.revision<>p_expected or saved.state<>'submitted' then
    raise exception 'Candidate changed. Reload before reviewing.' using errcode='PT409'; end if;
  update policy_knowledge_candidates set state=case when p_approve then 'approved' else 'rejected' end,
    approved_by=case when p_approve then p_actor else null end,
    approved_revision=case when p_approve then revision else null end,updated_at=clock_timestamp()
    where id=p_id returning * into saved;
  insert into policy_knowledge_review_events(candidate_id,actor_id,action,revision)
    values(saved.id,p_actor,saved.state,saved.revision);
  return to_jsonb(saved);
end;
$$;
revoke all on function public.save_policy_knowledge_candidate(uuid,uuid,integer,jsonb),
  public.review_policy_knowledge_candidate(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.save_policy_knowledge_candidate(uuid,uuid,integer,jsonb),
  public.review_policy_knowledge_candidate(uuid,uuid,integer,boolean) to service_role;
commit;
