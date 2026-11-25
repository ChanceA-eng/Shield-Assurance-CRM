begin;

create function public.team_conversation_allowed(p_actor uuid,p_type text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare account uuid; assigned_only boolean;
begin
  if p_type is null or p_type not in ('lead','client') or p_id is null then return false; end if;
  if not exists(select 1 from agency_members m join auth.users u on u.id=m.user_id
    where m.user_id=p_actor and m.active and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now()))
    or not team_has_permission(p_actor,'messages.view','assigned') then
    return false;
  end if;
  assigned_only:=not team_has_permission(p_actor,'messages.view','agency');
  if p_type='lead' then
    select l.account_id into account from leads l where l.id=p_id
      and (team_has_permission(p_actor,'leads.view','agency')
        or (team_has_permission(p_actor,'leads.view','assigned') and l.agent_user_id=p_actor))
      and (not assigned_only or l.agent_user_id=p_actor);
    if not found then return false; end if;
  else
    account:=p_id;
  end if;
  if account is not null and not exists(select 1 from clients c where c.id=account
    and (team_has_permission(p_actor,'accounts.view','agency')
      or (team_has_permission(p_actor,'accounts.view','assigned') and c.agent_user_id=p_actor))
    and (not assigned_only or c.agent_user_id=p_actor)) then
    return false;
  end if;
  return true;
end;
$$;

create function public.team_conversation_thread(p_actor uuid,p_type text,p_id uuid,p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare account uuid; key text; total bigint; items jsonb;
begin
  if p_type is null or p_type not in ('lead','client') or p_id is null
    or p_offset is null or p_offset<0 or p_offset>2147483447
    or p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'Choose a valid conversation and page.' using errcode='22023';
  end if;
  if not team_conversation_allowed(p_actor,p_type,p_id) then
    raise exception 'Conversation is outside your record access.' using errcode='42501';
  end if;
  if p_type='lead' then select account_id into account from leads where id=p_id;
  else account:=p_id; end if;
  key:=case when account is null then 'lead:'||p_id::text else 'client:'||account::text end;
  select count(*) into total from canonical_communications c where c.conversation_key=key;
  select coalesce(jsonb_agg(to_jsonb(page) order by page.sent_at desc,page.id desc),'[]'::jsonb) into items
    from (select c.* from canonical_communications c where c.conversation_key=key
      order by c.sent_at desc,c.id desc limit p_limit offset p_offset) page;
  return jsonb_build_object('clientId',account,'items',items,'total',total,
    'nextOffset',case when p_offset+jsonb_array_length(items)<total then p_offset+jsonb_array_length(items) else null end);
end;
$$;

create function public.team_conversation_inbox(p_actor uuid,p_search text,p_page integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare total bigint; items jsonb;
begin
  if p_page is null or p_page<0 or p_page>100000 or p_search is null or length(p_search)>200 then
    raise exception 'Choose a valid inbox page and search.' using errcode='22023';
  end if;
  if not team_has_permission(p_actor,'messages.view','assigned') or not exists(
    select 1 from agency_members m join auth.users u on u.id=m.user_id where m.user_id=p_actor and m.active
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Conversation access is required.' using errcode='42501';
  end if;
  with visible as (
    select i.* from conversation_inbox i
    where team_conversation_allowed(p_actor,i.kind,case i.kind when 'client' then i.client_id when 'lead' then i.lead_id end)
      and (p_search='' or strpos(lower(coalesce(i.name,'')||' '||coalesce(i.email,'')||' '||coalesce(i.phone,'')||' '||coalesce(i.last_subject,'')),lower(p_search))>0)
  ), page as (
    select * from visible order by last_at desc,key limit 25 offset p_page*25
  )
  select (select count(*) from visible),
    coalesce((select jsonb_agg(to_jsonb(page) order by last_at desc,key) from page),'[]'::jsonb)
    into total,items;
  return jsonb_build_object('conversations',items,'total',total,'page',p_page,'page_size',25);
end;
$$;

create function public.team_mark_conversation_read(p_actor uuid,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare updated uuid[];
begin
  if p_ids is null or cardinality(p_ids)>500 or array_position(p_ids,null) is not null then
    raise exception 'Choose at most 500 valid message IDs.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  perform 1 from agency_members where user_id=p_actor and active for share;
  if not found or not team_has_permission(p_actor,'messages.view','assigned') then
    raise exception 'Conversation access is required.' using errcode='42501';
  end if;
  perform 1 from communication_log m where m.id=any(p_ids) order by m.id for update;
  perform 1 from leads l where l.id in
    (select c.canonical_lead_id from canonical_communications c where c.id=any(p_ids)) order by l.id for share;
  perform 1 from clients a where a.id in
    (select c.canonical_account_id from canonical_communications c where c.id=any(p_ids)) order by a.id for share;
  if exists(select 1 from canonical_communications c where c.id=any(p_ids)
    and not team_conversation_allowed(p_actor,
      case when c.canonical_account_id is not null then 'client' else 'lead' end,
      coalesce(c.canonical_account_id,c.canonical_lead_id))) then
    raise exception 'A message is outside your record access.' using errcode='42501';
  end if;
  with changed as (
    update communication_log set read_at=clock_timestamp()
    where id=any(p_ids) and direction='inbound' and read_at is null returning id
  ) select coalesce(array_agg(id),'{}'::uuid[]) into updated from changed;
  return jsonb_build_object('updated',cardinality(updated),'ids',to_jsonb(updated));
end;
$$;

revoke all on function public.team_conversation_allowed(uuid,text,uuid),
  public.team_conversation_thread(uuid,text,uuid,integer,integer),public.team_conversation_inbox(uuid,text,integer),
  public.team_mark_conversation_read(uuid,uuid[])
  from public,anon,authenticated,service_role;
grant execute on function public.team_conversation_thread(uuid,text,uuid,integer,integer),
  public.team_conversation_inbox(uuid,text,integer),public.team_mark_conversation_read(uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
