begin;
create or replace function public.bulk_reschedule_tasks(p_tasks jsonb,p_due_date timestamptz,p_actor text)
returns setof public.tasks language plpgsql security definer set search_path=public as $$
declare expected integer; matched integer;
begin
  if jsonb_typeof(p_tasks) is distinct from 'array' or p_due_date is null or not isfinite(p_due_date)
    or nullif(trim(p_actor),'') is null then
    raise exception 'Select tasks and a valid new due date.' using errcode='22023';
  end if;
  expected:=jsonb_array_length(p_tasks);
  if expected<1 or expected>200 then raise exception 'Select between 1 and 200 tasks.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_tasks) item where jsonb_typeof(item) is distinct from 'object'
    or nullif(item->>'id','') is null or nullif(item->>'expected_updated_at','') is null)
    or (select count(distinct (item->>'id')::uuid) from jsonb_array_elements(p_tasks) item)<>expected then
    raise exception 'Each selected task needs a unique ID and its saved version.' using errcode='22023';
  end if;
  perform t.id from public.tasks t join jsonb_to_recordset(p_tasks) as requested(id uuid,expected_updated_at timestamptz)
    on t.id=requested.id order by t.id for update of t;
  select count(*) into matched from public.tasks t
    join jsonb_to_recordset(p_tasks) as requested(id uuid,expected_updated_at timestamptz)
      on t.id=requested.id and t.updated_at=requested.expected_updated_at
    where t.status='open';
  if matched<>expected then
    -- This is a user conflict, not a transient serialization failure for PostgREST to retry.
    raise exception 'A selected task changed, was completed or was removed. No tasks were rescheduled. Refresh and reselect.'
      using errcode='PT409';
  end if;
  return query update public.tasks t set due_date=p_due_date,updated_by=p_actor
    from jsonb_to_recordset(p_tasks) as requested(id uuid,expected_updated_at timestamptz)
    where t.id=requested.id returning t.*;
end;
$$;
revoke all on function public.bulk_reschedule_tasks(jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.bulk_reschedule_tasks(jsonb,timestamptz,text) to service_role;
notify pgrst,'reload schema';
commit;
