-- Personalize generic open tasks: name the prospect and the actual next step.

-- "Check in with this prospect" -> stage-aware wording with the lead's name.
update public.tasks t
set
  subject = case
    when lower(coalesce(l.status, 'new')) = 'quoted' then 'Follow up on ' || l.full_name || '''s quote'
    when lower(coalesce(l.status, 'new')) = 'contacted' then 'Follow up with ' || l.full_name
    else 'Make first contact with ' || l.full_name
  end,
  description = case
    when lower(coalesce(l.status, 'new')) = 'quoted'
      then l.full_name || ' has a quote in hand but hasn''t moved. Ask where they stand and what it would take to close.'
    when lower(coalesce(l.status, 'new')) = 'contacted'
      then 'You''ve already reached out to ' || l.full_name || ' — keep the conversation moving with a call or a short note.'
    else l.full_name || ' is still untouched in your pipeline. Introduce yourself and qualify their interest.'
  end
from public.leads l
where t.related_type = 'lead'
  and t.related_id = l.id
  and t.status = 'open'
  and t.subject = 'Check in with this prospect';

-- "Quote <type> — <name>" -> "<name> — <type> renewal approaching"
update public.tasks
set subject = regexp_replace(subject, '^Quote (.+) — (.+)$', '\2 — \1 renewal approaching')
where status = 'open'
  and subject ~ '^Quote .+ — .+$';
