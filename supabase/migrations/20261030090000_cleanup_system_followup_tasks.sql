-- Clean up migrated system check-in tasks:
-- 1) Drop system check-ins for leads that are no longer active.
delete from public.tasks
where status = 'open'
  and related_type = 'lead'
  and description like 'System Automated Follow-Up%'
  and related_id in (
    select id from public.leads where status not in ('new', 'contacted', 'quoted')
  );

-- Also drop system check-ins pointing at leads that no longer exist.
delete from public.tasks
where status = 'open'
  and related_type = 'lead'
  and description like 'System Automated Follow-Up%'
  and related_id not in (select id from public.leads);

-- 2) The old cron accumulated one check-in per day per lead; keep only the earliest per lead.
with ranked as (
  select id, row_number() over (partition by related_id order by due_date asc, created_at asc) as rn
  from public.tasks
  where status = 'open'
    and related_type = 'lead'
    and description like 'System Automated Follow-Up%'
)
delete from public.tasks
where id in (select id from ranked where rn > 1);
