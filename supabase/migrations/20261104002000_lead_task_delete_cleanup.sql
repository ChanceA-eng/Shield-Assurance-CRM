begin;

create function public.cleanup_deleted_lead_tasks()
returns trigger language plpgsql security definer set search_path=public as $$
declare task_ids uuid[];
begin
  select coalesce(array_agg(id),'{}') into task_ids from public.tasks
    where related_type='lead' and related_id=old.id;
  delete from public.notifications where task_id=any(task_ids);
  delete from public.events where (related_type='lead' and related_id=old.id)
    or id in (select event_id from public.tasks where id=any(task_ids) and event_id is not null);
  delete from public.tasks where id=any(task_ids);
  return old;
end;
$$;

revoke all on function public.cleanup_deleted_lead_tasks() from public,anon,authenticated;
create trigger cleanup_deleted_lead_tasks before delete on public.leads
  for each row execute function public.cleanup_deleted_lead_tasks();

notify pgrst,'reload schema';
commit;
