-- Deduplicate imported leads: the accidental full-batch commit created rich,
-- domain-structured leads that duplicate thin legacy-importer leads from the
-- same vendor file. Keep the rich batch leads; remove legacy duplicates.

-- 1) Remove tasks attached to the legacy duplicates.
delete from public.tasks
where related_type = 'lead'
  and related_id in (
    select legacy.id
    from public.leads legacy
    where legacy.source = 'prospect_import'
      and legacy.form_payload ? 'row'
      and exists (
        select 1 from public.leads batch
        where batch.source = 'prospect_import'
          and batch.form_payload -> 'import' ->> 'batch_id' is not null
          and lower(batch.full_name) = lower(legacy.full_name)
          and batch.id <> legacy.id
      )
  );

-- 2) Remove the legacy duplicate leads themselves.
delete from public.leads legacy
where legacy.source = 'prospect_import'
  and legacy.form_payload ? 'row'
  and exists (
    select 1 from public.leads batch
    where batch.source = 'prospect_import'
      and batch.form_payload -> 'import' ->> 'batch_id' is not null
      and lower(batch.full_name) = lower(legacy.full_name)
      and batch.id <> legacy.id
  );
