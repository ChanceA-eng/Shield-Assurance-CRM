begin;
alter table public.policies add column quote_option_id uuid references public.quote_options(id) on delete restrict;
alter table public.policies add column quote_snapshot jsonb;
create unique index policies_quote_option_unique on public.policies(quote_option_id) where quote_option_id is not null;

create function public.issue_quote_policy_atomic(
  p_request_id uuid,p_account_id uuid,p_lead_id uuid,p_policy jsonb,p_quote_id uuid,p_quote_version timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare quote public.quote_options%rowtype; issued public.policies%rowtype; result jsonb;
begin
  if p_quote_id is null or p_quote_version is null then
    raise exception 'A selected quote and its last-loaded version are required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('issue:'||p_request_id::text,0));
  select * into quote from public.quote_options where id=p_quote_id for update;
  if not found then raise exception 'Quote option not found.' using errcode='P0002'; end if;
  if quote.client_id<>p_account_id then raise exception 'Quote belongs to another account.' using errcode='23514'; end if;
  select p.* into issued from public.policies p join public.policy_issue_operations op on op.policy_id=p.id
    where op.request_id=p_request_id;
  if found then
    if issued.quote_option_id is distinct from p_quote_id then
      raise exception 'Issuance ID belongs to another quote or manual policy.' using errcode='23505';
    end if;
    return public.issue_policy_atomic(p_request_id,p_account_id,p_lead_id,p_policy);
  end if;
  if quote.status<>'accepted' or quote.updated_at<>p_quote_version then
    raise exception 'Quote changed or is not accepted. Refresh and review it before recording coverage.' using errcode='40001';
  end if;
  if p_lead_id is not null and quote.lead_id is distinct from p_lead_id then
    raise exception 'The selected lead is not this quote''s source lead.' using errcode='23514';
  end if;
  result:=public.issue_policy_atomic(p_request_id,p_account_id,p_lead_id,p_policy);
  update public.policies set quote_option_id=p_quote_id,quote_snapshot=to_jsonb(quote)
    where id=(result->'policy'->>'id')::uuid returning * into issued;
  return jsonb_build_object('policy',to_jsonb(issued),'created',true);
end;
$$;
revoke all on function public.issue_quote_policy_atomic(uuid,uuid,uuid,jsonb,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.issue_quote_policy_atomic(uuid,uuid,uuid,jsonb,uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
