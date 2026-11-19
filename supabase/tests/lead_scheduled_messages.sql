do $$
declare lead uuid := gen_random_uuid(); scheduled uuid := gen_random_uuid(); claimed integer;
begin
  insert into public.leads(id, full_name, source, status) values(lead, 'Synthetic schedule fixture', 'test', 'new');
  insert into public.scheduled_messages(id, lead_id, send_at, channel, body, automation_type)
    values(scheduled, lead, now() + interval '1 day', 'email', 'Synthetic email', 'manual');
  if (select client_id from public.scheduled_messages where id=scheduled) is not null then
    raise exception 'Lead scheduling must not create an account';
  end if;
  update public.scheduled_messages set status='processing' where id=scheduled and status='pending';
  get diagnostics claimed = row_count;
  if claimed <> 1 then raise exception 'First claim must succeed'; end if;
  update public.scheduled_messages set status='processing' where id=scheduled and status='pending';
  get diagnostics claimed = row_count;
  if claimed <> 0 then raise exception 'A claimed send must not be claimed twice'; end if;
  update public.scheduled_messages set status='cancelled' where id=scheduled and status='pending';
  get diagnostics claimed = row_count;
  if claimed <> 0 then raise exception 'An executing send cannot be cancelled as pending'; end if;
  delete from public.leads where id=lead;
  if exists(select 1 from public.scheduled_messages where id=scheduled) then
    raise exception 'Deleting a lead must delete its queued messages';
  end if;
end;
$$;
