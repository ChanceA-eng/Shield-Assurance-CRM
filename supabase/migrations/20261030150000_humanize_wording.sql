-- Humanize legacy automated wording in existing tasks, notifications, and notes.

update public.tasks
set subject = 'Check in with this prospect',
    description = 'Scheduled check-in — no recent activity on this prospect.'
where description like 'System Automated Follow-Up%' or subject = 'Prospect check-in';

update public.tasks
set subject = regexp_replace(subject, '^HOT: (.*) submitted again$', '\1 submitted another request — call now'),
    description = 'They filled out the website form again. Repeat inquiries close fast.'
where subject like 'HOT: %submitted again';

update public.notifications
set message = regexp_replace(message, '^Lead (.*) moved to (\w+)\.$', '\1 is now in \2')
where message like 'Lead %moved to%';

update public.interactions
set content = 'Scheduled check-in — no recent activity on this prospect.'
where content like 'System Automated Follow-Up%';
