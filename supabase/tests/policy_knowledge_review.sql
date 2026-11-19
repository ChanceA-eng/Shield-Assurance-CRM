begin;
do $test$
declare actor uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); account uuid:=gen_random_uuid();
  candidate uuid:=gen_random_uuid(); public_source uuid:=gen_random_uuid(); saved jsonb; vals jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,'policy-agent-'||actor||'@example.invalid',now()),
    (reviewer,'policy-owner-'||reviewer||'@example.invalid',now());
  insert into agency_members(user_id,email,role,active) select id,email,
    case when id=actor then 'agent' else 'owner' end,true from auth.users where id in (actor,reviewer);
  insert into clients(id,full_name,source) values(account,'Synthetic review account','Synthetic SQL fixture');
  vals=jsonb_build_object('account_id',account,'carrier','Synthetic Carrier','form_number','CG 00 01',
    'edition','04 13','jurisdiction','Arizona','line_of_business','General liability',
    'wording','This insurance does not apply to bodily injury expected or intended from the standpoint of the insured.',
    'privacy_confirmed',true,'rights_confirmed',true);
  insert into "KnowledgeDocument"(id,title,"sourceType","rawText",status,"updatedAt")
    values(public_source::text,'Synthetic public source','NOTE','Synthetic public source wording','READY',now());
  begin
    perform save_policy_knowledge_candidate(actor,public_source,0,vals);
    raise exception 'Submission claimed and locked an unrelated knowledge document';
  exception when unique_violation then null; end;
  update "KnowledgeDocument" set "sourceUrl"='https://example.invalid/public-source' where id=public_source::text;
  saved=save_policy_knowledge_candidate(actor,candidate,0,vals);
  if saved->>'state'<>'submitted' or saved->>'revision'<>'1' then raise exception 'Submission not saved'; end if;
  if exists(select 1 from "KnowledgeDocument" where id=candidate::text) then raise exception 'Unapproved wording indexed'; end if;
  begin
    perform save_policy_knowledge_candidate(actor,candidate,0,vals);
    raise exception 'Stale save accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform review_policy_knowledge_candidate(actor,candidate,1,true);
    raise exception 'Agent approved wording';
  exception when insufficient_privilege then null; end;
  saved=review_policy_knowledge_candidate(reviewer,candidate,1,true);
  if saved->>'approved_revision'<>'1' or saved->>'state'<>'approved' then raise exception 'Approval not revision bound'; end if;
  saved=save_policy_knowledge_candidate(actor,candidate,1,vals);
  if saved->>'revision'<>'2' or saved->>'state'<>'submitted' or saved->>'approved_revision' is not null then
    raise exception 'Edit retained stale approval'; end if;
  begin
    perform review_policy_knowledge_candidate(reviewer,candidate,1,true);
    raise exception 'Stale approval accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform review_policy_knowledge_candidate(reviewer,candidate,null,true);
    raise exception 'Null approval revision accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform review_policy_knowledge_candidate(reviewer,candidate,2,null);
    raise exception 'Null decision accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_policy_knowledge_candidate(actor,null,0,vals);
    raise exception 'Null candidate ID accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_policy_knowledge_candidate(actor,gen_random_uuid(),null,vals);
    raise exception 'Null saved revision accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_policy_knowledge_candidate(actor,gen_random_uuid(),0,vals||'{"rights_confirmed":false}'::jsonb);
    raise exception 'Missing reuse permission accepted';
  exception when invalid_parameter_value then null; end;
  saved=review_policy_knowledge_candidate(reviewer,candidate,2,false);
  if saved->>'state'<>'rejected' then raise exception 'Rejection not saved'; end if;
  update policy_knowledge_candidates set state='published' where id=candidate;
  begin
    perform save_policy_knowledge_candidate(actor,candidate,2,vals);
    raise exception 'Published wording editable without withdrawal';
  exception when insufficient_privilege then null; end;
  if (select count(*) from policy_knowledge_review_events where candidate_id=candidate)<>4 then raise exception 'Review audit incomplete'; end if;
  if has_table_privilege('authenticated','public.policy_knowledge_candidates','SELECT')
    or has_table_privilege('authenticated','public.policy_knowledge_review_events','INSERT')
    or has_function_privilege('authenticated','public.review_policy_knowledge_candidate(uuid,uuid,integer,boolean)','EXECUTE') then
    raise exception 'Direct browser review access allowed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.policy_knowledge_candidates'::regclass) then raise exception 'Missing RLS'; end if;
  insert into "KnowledgeDocument"(id,title,"sourceType","rawText",status,"updatedAt")
    values(candidate::text,'Synthetic owner-reviewed excerpt','NOTE',vals->>'wording','READY',now());
  insert into "DocumentInsight"(id,"documentId","insightIndex",content)
    values(gen_random_uuid()::text,candidate::text,0,vals->>'wording');
  begin
    update "KnowledgeDocument" set "sourceUrl"='https://example.invalid/private-source' where id=candidate::text;
    raise exception 'Public source URL attached to private-source-derived knowledge';
  exception when insufficient_privilege then null; end;
  delete from "KnowledgeDocument" where id=candidate::text;
  if exists(select 1 from "DocumentInsight" where "documentId"=candidate::text) then raise exception 'Withdrawal left derived insights'; end if;
end;
$test$;
rollback;
