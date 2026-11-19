begin;

create table public.record_contact_preferences (
  lead_id uuid references public.leads(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  do_not_contact boolean not null default true,
  reason text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.agency_members(user_id),
  constraint record_contact_preferences_one_record check ((lead_id is null) <> (client_id is null)),
  constraint record_contact_preferences_reason_length check (char_length(reason) <= 500),
  unique (lead_id),
  unique (client_id)
);

alter table public.record_contact_preferences enable row level security;
revoke all on public.record_contact_preferences from public, anon, authenticated;
grant all on public.record_contact_preferences to service_role;

create function public.set_record_contact_preference(
  p_actor uuid,
  p_type text,
  p_id uuid,
  p_do_not_contact boolean,
  p_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member agency_members;
  assigned_agent uuid;
begin
  select * into v_member from agency_members where user_id = p_actor and active;
  if v_member.user_id is null then raise exception 'Active agency membership is required' using errcode = '42501'; end if;
  if p_type = 'lead' then
    select agent_user_id into assigned_agent from leads where id = p_id;
  elsif p_type = 'client' then
    select agent_user_id into assigned_agent from clients where id = p_id;
  else
    raise exception 'Invalid record type' using errcode = '22023';
  end if;
  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if v_member.role = 'agent' and assigned_agent is not null and assigned_agent <> p_actor then
    raise exception 'Record is assigned to another agent' using errcode = '42501';
  end if;
  if p_do_not_contact then
    if p_type = 'lead' then
      insert into record_contact_preferences(lead_id, do_not_contact, reason, updated_at, updated_by)
        values(p_id, true, left(coalesce(p_reason, ''), 500), now(), p_actor)
        on conflict (lead_id) do update set do_not_contact = true, reason = excluded.reason, updated_at = now(), updated_by = p_actor;
    else
      insert into record_contact_preferences(client_id, do_not_contact, reason, updated_at, updated_by)
        values(p_id, true, left(coalesce(p_reason, ''), 500), now(), p_actor)
        on conflict (client_id) do update set do_not_contact = true, reason = excluded.reason, updated_at = now(), updated_by = p_actor;
    end if;
  elsif p_type = 'lead' then
    delete from record_contact_preferences where lead_id = p_id;
  else
    delete from record_contact_preferences where client_id = p_id;
  end if;
  insert into agency_audit(actor_id, target_id, action, details)
    values(p_actor, p_id, 'contact_preference_changed',
      jsonb_build_object('record_type', p_type, 'do_not_contact', p_do_not_contact));
end;
$$;

revoke all on function public.set_record_contact_preference(uuid, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_record_contact_preference(uuid, text, uuid, boolean, text) to service_role;

create function public.lead_contact_restrictions(p_leads uuid[])
returns table(lead_id uuid,do_not_contact boolean)
language sql stable security definer set search_path=public as $$
  select l.id,exists(select 1 from record_contact_preferences pref
    where pref.do_not_contact and (pref.lead_id=l.id or pref.client_id=l.account_id
      or pref.lead_id in (select sibling.id from leads sibling where sibling.account_id=l.account_id)))
  from leads l where l.id=any(p_leads)
$$;
revoke all on function public.lead_contact_restrictions(uuid[]) from public,anon,authenticated;
grant execute on function public.lead_contact_restrictions(uuid[]) to service_role;
notify pgrst, 'reload schema';
commit;
