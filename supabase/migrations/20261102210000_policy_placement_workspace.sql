begin;

create table public.policy_confirmation_evidence (
  policy_id uuid primary key references public.policies(id) on delete cascade,
  request_id uuid not null unique,
  confirmation jsonb not null,
  recorded_by text not null,
  recorded_at timestamptz not null default now()
);
create table public.placement_documents (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.policies(id) on delete cascade,
  quote_id uuid references public.quote_options(id) on delete cascade,
  file_id uuid not null references public.client_files(id) on delete restrict,
  file_snapshot jsonb not null,
  added_by text not null,
  added_at timestamptz not null default now(),
  check(num_nonnulls(policy_id,quote_id)=1),
  unique(policy_id,file_id),
  unique(quote_id,file_id)
);
create table public.policy_term_history (
  id bigint generated always as identity primary key,
  policy_id uuid not null references public.policies(id) on delete cascade,
  event text not null,
  snapshot jsonb not null,
  recorded_by text not null,
  recorded_at timestamptz not null default now()
);
create index policy_term_history_cursor on public.policy_term_history(policy_id,id desc);
create index policies_prior_term_idx on public.policies(prior_policy_id);
alter table public.policy_confirmation_evidence enable row level security;
alter table public.placement_documents enable row level security;
alter table public.policy_term_history enable row level security;
revoke all on public.policy_confirmation_evidence,public.placement_documents,public.policy_term_history from public,anon,authenticated;
grant all on public.policy_confirmation_evidence,public.placement_documents,public.policy_term_history to service_role;
grant usage,select on sequence public.policy_term_history_id_seq to service_role;

create function public.audit_policy_term() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return null; end if;
  insert into public.policy_term_history(policy_id,event,snapshot,recorded_by)
  values(new.id,case when tg_op='INSERT' then 'recorded' else 'updated' end,to_jsonb(new),
    coalesce(nullif(current_setting('app.policy_actor',true),''),'Database / legacy workflow'));
  return null;
end;
$$;
create trigger policy_term_audit after insert or update on public.policies for each row execute function public.audit_policy_term();

create function public.protect_policy_placement() returns trigger language plpgsql set search_path=public as $$
begin
  if new.prior_policy_id is not null then
    if new.prior_policy_id=new.id or not exists(select 1 from public.policies
      where id=new.prior_policy_id and client_id=new.client_id) then
      raise exception 'Previous term must be a different policy on this account.' using errcode='23514';
    end if;
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.policy_confirmation_evidence where policy_id=old.id)
    and (new.client_id is distinct from old.client_id or new.account_id is distinct from old.account_id
      or new.prior_policy_id is distinct from old.prior_policy_id or new.source is distinct from old.source) then
    raise exception 'Recorded placement account and term lineage cannot be reassigned.' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger protect_policy_placement before insert or update on public.policies for each row execute function public.protect_policy_placement();

create function public.attach_placement_document(p_account_id uuid,p_policy_id uuid,p_quote_id uuid,p_file_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare document public.client_files%rowtype; linked public.placement_documents%rowtype;
begin
  if num_nonnulls(p_policy_id,p_quote_id)<>1 or nullif(trim(p_actor),'') is null then
    raise exception 'Choose one placement record and an authenticated operator.' using errcode='22023';
  end if;
  if p_policy_id is not null then
    perform 1 from public.policies where id=p_policy_id and client_id=p_account_id for key share;
  else
    perform 1 from public.quote_options where id=p_quote_id and client_id=p_account_id for key share;
  end if;
  if not found then raise exception 'Placement record was not found on this account.' using errcode='P0002'; end if;
  select * into document from public.client_files where id=p_file_id and client_id=p_account_id for share;
  if not found or document.status is distinct from 'stored' or document.metadata->>'source_kind' is distinct from 'stored'
    or nullif(document.metadata#>>'{storage,path}','') is null then
    raise exception 'Choose a stored document on this account.' using errcode='23514';
  end if;
  insert into public.placement_documents(policy_id,quote_id,file_id,file_snapshot,added_by)
    values(p_policy_id,p_quote_id,p_file_id,to_jsonb(document),p_actor) on conflict do nothing;
  select * into linked from public.placement_documents where file_id=p_file_id
    and (policy_id=p_policy_id or quote_id=p_quote_id);
  return to_jsonb(linked);
end;
$$;

create function public.record_policy_placement_atomic(
  p_request_id uuid,p_account_id uuid,p_lead_id uuid,p_policy jsonb,p_asset_ids uuid[],
  p_confirmation jsonb,p_actor text,p_quote_id uuid default null,p_quote_version timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.policy_confirmation_evidence%rowtype; result jsonb; issued_id uuid; confirmed_on date;
  file_id uuid; confirmation_data jsonb; document public.client_files%rowtype;
begin
  if p_confirmation is null or jsonb_typeof(p_confirmation)<>'object'
    or p_confirmation->'attested' is distinct from 'true'::jsonb or nullif(trim(p_actor),'') is null then
    raise exception 'Carrier confirmation evidence and operator attestation are required.' using errcode='22023';
  end if;
  if coalesce(p_confirmation->>'confirmed_on','') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'A valid carrier confirmation date is required.' using errcode='22023';
  end if;
  confirmed_on:=(p_confirmation->>'confirmed_on')::date;
  if confirmed_on>(now() at time zone 'America/Phoenix')::date then
    raise exception 'Carrier confirmation cannot be dated in the future.' using errcode='22023';
  end if;
  file_id:=nullif(p_confirmation->>'file_id','')::uuid;
  if file_id is null and length(trim(coalesce(p_confirmation->>'reference',''))) not between 1 and 500 then
    raise exception 'Supply an uploaded carrier document or a carrier confirmation reference.' using errcode='22023';
  end if;
  if length(coalesce(p_confirmation->>'reference',''))>500 then
    raise exception 'Carrier confirmation reference is too long.' using errcode='22023';
  end if;
  confirmation_data:=jsonb_build_object('confirmed_on',confirmed_on,'reference',trim(coalesce(p_confirmation->>'reference','')),
    'file_id',file_id,'attested',true);
  perform pg_advisory_xact_lock(hashtextextended('placement:'||p_request_id::text,0));
  select * into prior from public.policy_confirmation_evidence where request_id=p_request_id;
  if found and prior.confirmation-'file_snapshot' is distinct from confirmation_data then
    raise exception 'Issuance ID reused with different carrier evidence.' using errcode='23505';
  end if;
  if not found then
    if exists(select 1 from public.policy_issue_operations where request_id=p_request_id) then
      raise exception 'Issuance ID belongs to an earlier placement; use its existing policy.' using errcode='23505';
    end if;
    if p_policy->>'source' in ('Renewal','Rewrite') and (p_lead_id is not null or p_policy->>'prior_policy_id' is null) then
      raise exception 'Renewals and rewrites require a previous account policy, not lead completion.' using errcode='23514';
    end if;
    if file_id is not null then
      select * into document from public.client_files where id=file_id and client_id=p_account_id for share;
      if not found or document.status is distinct from 'stored' or document.metadata->>'source_kind' is distinct from 'stored'
        or nullif(document.metadata#>>'{storage,path}','') is null then
        raise exception 'Carrier evidence must be a stored document on this account.' using errcode='23514';
      end if;
    end if;
  end if;
  perform set_config('app.policy_actor',p_actor,true);
  result:=public.issue_policy_with_assets_atomic(p_request_id,p_account_id,p_lead_id,p_policy,p_asset_ids,p_quote_id,p_quote_version);
  issued_id:=(result#>>'{policy,id}')::uuid;
  if prior.policy_id is null then
    insert into public.policy_confirmation_evidence(policy_id,request_id,confirmation,recorded_by)
      values(issued_id,p_request_id,confirmation_data||case when file_id is null then '{}'::jsonb
        else jsonb_build_object('file_snapshot',to_jsonb(document)) end,p_actor);
    if file_id is not null then perform public.attach_placement_document(p_account_id,issued_id,null,file_id,p_actor); end if;
  end if;
  return result;
end;
$$;

create function public.update_policy_record_atomic(p_id uuid,p_updates jsonb,p_actor text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
  if nullif(trim(p_actor),'') is null then raise exception 'Authenticated operator required.' using errcode='22023'; end if;
  perform set_config('app.policy_actor',p_actor,true);
  return public.update_policy_atomic(p_id,p_updates);
end;
$$;
create function public.claim_document_deletion(p_account_id uuid,p_file_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare document public.client_files%rowtype;
begin
  select * into document from public.client_files where id=p_file_id and client_id=p_account_id for update;
  if not found then raise exception 'Document not found on this account.' using errcode='P0002'; end if;
  if exists(select 1 from public.placement_documents where file_id=p_file_id) then
    raise exception 'This document is retained as quote or policy evidence and cannot be deleted.' using errcode='23514';
  end if;
  update public.client_files set status='deletion_pending' where id=p_file_id;
  return to_jsonb(document);
end;
$$;
revoke all on function public.audit_policy_term(),public.protect_policy_placement(),
  public.attach_placement_document(uuid,uuid,uuid,uuid,text),
  public.record_policy_placement_atomic(uuid,uuid,uuid,jsonb,uuid[],jsonb,text,uuid,timestamptz),
  public.update_policy_record_atomic(uuid,jsonb,text),public.claim_document_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.attach_placement_document(uuid,uuid,uuid,uuid,text),
  public.record_policy_placement_atomic(uuid,uuid,uuid,jsonb,uuid[],jsonb,text,uuid,timestamptz),
  public.update_policy_record_atomic(uuid,jsonb,text),public.claim_document_deletion(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
