begin;
create function public.retain_policy_record() returns trigger
language plpgsql set search_path=public as $$
begin
  if exists(select 1 from public.policy_confirmation_evidence where policy_id=old.id)
    or exists(select 1 from public.policy_term_history where policy_id=old.id)
    or exists(select 1 from public.placement_documents where policy_id=old.id) then
    raise exception 'This policy has retained CRM history or documents. Update its status instead of deleting the policy or its account.'
      using errcode='23514';
  end if;
  return old;
end;
$$;
create trigger retain_policy_record before delete on public.policies
  for each row execute function public.retain_policy_record();
revoke all on function public.retain_policy_record() from public,anon,authenticated;
commit;
