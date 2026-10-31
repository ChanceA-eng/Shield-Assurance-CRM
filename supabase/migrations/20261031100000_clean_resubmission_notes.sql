-- Old resubmission notes dumped raw JSON into the interaction content.
-- Replace them with a clean human sentence; the submission data itself
-- lives on the lead profile (current + previous_submissions).

update public.interactions
set content = 'Submitted the website form again with updated details. Earlier submission is archived on the profile.'
where content like 'Lead resubmitted via website:%';
