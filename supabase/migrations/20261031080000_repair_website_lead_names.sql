-- Repair website-pull leads imported as "Unknown Web Lead": the submitter's
-- name (and sometimes contact info) was stored in form_payload but never
-- promoted to the lead columns.

update public.leads
set full_name = coalesce(
  nullif(trim(form_payload->>'client_name'), ''),
  nullif(trim(form_payload->'metadata'->'routing'->>'fullName'), ''),
  full_name
)
where full_name ilike '%unknown%web%lead%'
  and (
    nullif(trim(form_payload->>'client_name'), '') is not null
    or nullif(trim(form_payload->'metadata'->'routing'->>'fullName'), '') is not null
  );

update public.leads
set email = lower(coalesce(
  nullif(trim(form_payload->>'email'), ''),
  nullif(trim(form_payload->'metadata'->'routing'->>'email'), '')
))
where (email is null or email = '')
  and source = 'website-pull'
  and (
    nullif(trim(form_payload->>'email'), '') is not null
    or nullif(trim(form_payload->'metadata'->'routing'->>'email'), '') is not null
  );

update public.leads
set phone = coalesce(
  nullif(trim(form_payload->>'phone'), ''),
  nullif(trim(form_payload->'metadata'->'routing'->>'phone'), '')
)
where (phone is null or phone = '')
  and source = 'website-pull'
  and (
    nullif(trim(form_payload->>'phone'), '') is not null
    or nullif(trim(form_payload->'metadata'->'routing'->>'phone'), '') is not null
  );
