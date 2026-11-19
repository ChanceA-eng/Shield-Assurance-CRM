begin;

drop policy "Authenticated agency users can manage outreach_settings" on public.outreach_settings;
create policy outreach_settings_owner on public.outreach_settings for all to authenticated
  using (exists(select 1 from public.agency_members where user_id=auth.uid() and active and role='owner'))
  with check (exists(select 1 from public.agency_members where user_id=auth.uid() and active and role='owner'));
revoke insert,update,delete,truncate,references,trigger on public.outreach_settings from authenticated,anon;

create or replace function public.manage_agency_member(p_actor uuid,p_target uuid,p_role text,p_active boolean)
returns void language plpgsql security definer set search_path=public as $$
declare actor agency_members; target agency_members;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  select * into actor from agency_members where user_id=p_actor and active for update;
  if actor.user_id is null or actor.role<>'owner' then
    raise exception 'Only the agency owner can manage team access' using errcode='42501';
  end if;
  select * into target from agency_members where user_id=p_target for update;
  if target.user_id is null then raise exception 'Member not found' using errcode='P0002'; end if;
  if p_role is null or p_role not in ('owner','admin','agent') or p_active is null then
    raise exception 'Choose a valid role and active state' using errcode='22023';
  end if;
  if target.role='owner' and (not p_active or p_role<>'owner') and not exists(
    select 1 from agency_members where role='owner' and active and user_id<>p_target
  ) then raise exception 'The last active owner cannot be removed' using errcode='22023'; end if;
  update agency_members set role=p_role,active=p_active,updated_at=now() where user_id=p_target;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,p_target,'membership_changed',jsonb_build_object('role',p_role,'active',p_active));
end;
$$;

create function public.save_agency_outreach_settings(p_actor uuid,p_update jsonb,p_confirm_automatic boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare current_settings outreach_settings; field text; sender jsonb; value numeric;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then
    raise exception 'Only the agency owner can change agency settings' using errcode='42501';
  end if;
  if p_update is null or jsonb_typeof(p_update)<>'object' or p_update='{}'::jsonb then
    raise exception 'Provide settings to save' using errcode='22023';
  end if;
  for field in select jsonb_object_keys(p_update) loop
    if field not in ('approval_mode','daily_send_cap','send_window_start','send_window_end','sender_profile') then
      raise exception 'An unsupported setting was supplied' using errcode='22023';
    end if;
  end loop;
  select * into current_settings from outreach_settings where id=1 for update;
  if not found then raise exception 'Agency outreach settings are not initialized' using errcode='P0002'; end if;
  if p_update ? 'approval_mode' and jsonb_typeof(p_update->'approval_mode')<>'boolean' then
    raise exception 'Choose whether sending requires approval' using errcode='22023';
  end if;
  if current_settings.approval_mode and p_update->'approval_mode'='false'::jsonb and not coalesce(p_confirm_automatic,false) then
    raise exception 'Confirm automatic sending before removing the approval requirement' using errcode='22023';
  end if;
  foreach field in array array['daily_send_cap','send_window_start','send_window_end'] loop
    if p_update ? field then
      if jsonb_typeof(p_update->field)<>'number' then raise exception 'Send limits must be whole numbers' using errcode='22023'; end if;
      value:=(p_update->>field)::numeric;
      if value<>trunc(value) or value<(case when field='send_window_start' then 0 else 1 end)
        or value>(case when field='daily_send_cap' then 200 when field='send_window_start' then 23 else 24 end) then
        raise exception 'Choose valid sending limits and hours' using errcode='22023';
      end if;
    end if;
  end loop;
  if coalesce((p_update->>'send_window_start')::int,current_settings.send_window_start)
    >=coalesce((p_update->>'send_window_end')::int,current_settings.send_window_end) then
    raise exception 'Send window end must be after its start' using errcode='22023';
  end if;
  if p_update ? 'sender_profile' then
    sender:=p_update->'sender_profile';
    if jsonb_typeof(sender)<>'object' then raise exception 'Provide a sender profile' using errcode='22023'; end if;
    foreach field in array array['name','role','agency','service_area','specialties','tone','signature','approved_claims'] loop
      if not sender ? field or jsonb_typeof(sender->field)<>'string' or length(sender->>field)>1000 then
        raise exception 'Sender details must be text of up to 1000 characters' using errcode='22023';
      end if;
    end loop;
    if btrim(sender->>'name')='' or btrim(sender->>'agency')='' or btrim(sender->>'signature')='' then
      raise exception 'Sender name, agency and signature are required' using errcode='22023';
    end if;
  end if;
  update outreach_settings set
    approval_mode=coalesce((p_update->>'approval_mode')::boolean,approval_mode),
    daily_send_cap=coalesce((p_update->>'daily_send_cap')::int,daily_send_cap),
    send_window_start=coalesce((p_update->>'send_window_start')::int,send_window_start),
    send_window_end=coalesce((p_update->>'send_window_end')::int,send_window_end),
    sender_profile=coalesce(sender,sender_profile),updated_at=clock_timestamp()
    where id=1;
  insert into agency_audit(actor_id,action,details)
    values(p_actor,'outreach_settings_changed',jsonb_build_object('fields',(select jsonb_agg(key order by key) from jsonb_object_keys(p_update) key)));
end;
$$;

revoke all on function public.save_agency_outreach_settings(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_agency_outreach_settings(uuid,jsonb,boolean) to service_role;
notify pgrst,'reload schema';
commit;
