begin;

-- Task changes keep the linked appointment's status and agency-local time in sync
-- without turning a cancelled appointment back into a scheduled one.
drop trigger if exists workspace_sync_calendar_task on public.tasks;
drop trigger if exists workspace_sync_calendar_task_insert on public.tasks;
drop trigger if exists workspace_sync_calendar_task_update on public.tasks;
create trigger workspace_sync_calendar_task_insert after insert on public.tasks
  for each row execute function public.sync_agency_calendar_time_zone();
create trigger workspace_sync_calendar_task_update after update of status,due_date on public.tasks
  for each row execute function public.sync_agency_calendar_time_zone();

notify pgrst,'reload schema';
commit;
