begin;
do $test$
declare
  l uuid:=gen_random_uuid(); no_id uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid();
  source_id text:='receipt-qa-'||gen_random_uuid()::text;
  payload jsonb; anonymous_payload jsonb; total integer;
begin
  payload:=jsonb_build_object('id',source_id,'submitted_at','2020-01-01T12:00:00Z','full_name','Receipt QA');
  anonymous_payload:=jsonb_build_object('full_name','Receipt QA no id','submitted_at','2020-01-02T12:00:00Z','marker',gen_random_uuid());
  insert into leads(id,full_name,source,status,form_payload) values(l,'Receipt QA','website','new',payload);
  if not exists(select 1 from website_submission_receipts_for(jsonb_build_array(payload)) where "position"=0 and lead_id=l) then
    raise exception 'New website intake did not retain its receipt'; end if;
  perform archive_leads(array[l],'Receipt QA');
  if apply_website_resubmission(l,payload) then raise exception 'Archived duplicate was reapplied'; end if;
  if not exists(select 1 from leads where id=l and archived_at is not null) then raise exception 'Duplicate restored archived lead'; end if;
  if exists(select 1 from lead_intake_events where lead_id=l and opened_at is null and dismissed_at is null and handled_at is null) then
    raise exception 'Archived duplicate reopened banner'; end if;
  perform purge_leads(array[l],'Receipt QA');
  if exists(select 1 from lead_intake_events where lead_id=l) then raise exception 'Purged payload was retained'; end if;
  if not exists(select 1 from website_submission_receipts_for(jsonb_build_array(payload)) where "position"=0 and lead_id is null) then
    raise exception 'Purge erased submission identity'; end if;
  begin
    insert into leads(id,full_name,source,status,form_payload) values(replacement,'Receipt QA replay','website','new',payload);
    raise exception 'Old export recreated a deleted lead';
  exception when unique_violation then null;
  end;
  if exists(select 1 from leads where id=replacement) then raise exception 'Failed replay left a lead behind'; end if;

  insert into leads(id,full_name,source,status,form_payload) values(no_id,'Receipt QA no id','website','new',anonymous_payload);
  perform archive_leads(array[no_id],'Receipt QA');
  perform purge_leads(array[no_id],'Receipt QA');
  if not exists(select 1 from website_submission_receipts_for(jsonb_build_array(anonymous_payload||'{"_intake":{"channel":"website"},"profile":{"note":"edited"}}'::jsonb))
    where "position"=0 and lead_id is null) then raise exception 'No-id replay lost its stable receipt'; end if;

  insert into leads(id,full_name,source,status) values(l,'Receipt QA returning','manual','new');
  perform archive_leads(array[l],'Receipt QA');
  if not apply_website_resubmission(l,jsonb_build_object('id',source_id||'-new','submitted_at',now())) then
    raise exception 'Genuinely new request was blocked'; end if;
  if not exists(select 1 from leads where id=l and archived_at is null) then raise exception 'New request did not restore lead'; end if;
  select count(*) into total from lead_intake_events where lead_id=l and dismissed_at is null and handled_at is null;
  if total<>1 then raise exception 'Genuine new request did not create exactly one event'; end if;
  if apply_website_resubmission(l,jsonb_build_object('id',source_id||'-new','submitted_at',now())) then
    raise exception 'New request replay was not deduplicated'; end if;
  if has_table_privilege('authenticated','public.website_submission_receipts','select')
    or has_function_privilege('anon','public.website_submission_receipts_for(jsonb)','execute') then
    raise exception 'Private receipt ledger exposed'; end if;
end;
$test$;
rollback;
