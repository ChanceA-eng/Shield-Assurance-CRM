-- Unify follow-ups into tasks: tasks become the single scheduler.
-- Interactions remain as a pure activity log.

-- Follow-ups carry times; widen tasks.due_date from date to timestamptz.
alter table public.tasks
  alter column due_date type timestamptz using due_date::timestamptz;

-- Convert open interaction follow-ups into lead tasks.
insert into public.tasks (subject, description, due_date, status, priority, related_type, related_id, created_at)
select
  case
    when coalesce(trim(i.content), '') = '' then 'Follow up with lead'
    when length(trim(i.content)) > 80 then left(trim(i.content), 77) || '...'
    else trim(i.content)
  end,
  i.content,
  i.follow_up_at,
  'open',
  'medium',
  'lead',
  i.lead_id,
  coalesce(i.created_at, now())
from public.interactions i
where i.follow_up_completed = false
  and i.follow_up_at is not null;

-- Close the migrated follow-ups so legacy queues cannot double-count them.
update public.interactions
set follow_up_completed = true
where follow_up_completed = false
  and follow_up_at is not null;
