begin;
do $test$
declare actor uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); draft_id uuid:=gen_random_uuid(); result jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,'social-review-agent-'||actor||'@example.invalid',now()),(reviewer,'social-review-admin-'||reviewer||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=reviewer then 'admin' else 'agent' end from auth.users where id in(actor,reviewer);
  perform save_social_draft(actor,draft_id,'create','Idea','');
  begin
    perform review_social_draft(actor,draft_id,'submit',1,0);
    raise exception 'Blank caption submitted';
  exception when invalid_parameter_value then null; end;
  perform save_social_draft(actor,draft_id,'update','Idea','Public caption',1);
  result:=review_social_draft(actor,draft_id,'submit',2,0);
  if result->>'review_state'<>'awaiting_review' or (result->>'review_version')::integer<>1 then raise exception 'Submit state incorrect'; end if;
  begin
    perform review_social_draft(actor,draft_id,'approve',2,1);
    raise exception 'Agent approved';
  exception when insufficient_privilege then null; end;
  begin
    perform review_social_draft(reviewer,draft_id,'request_changes',2,1,' ');
    raise exception 'Missing rejection reason accepted';
  exception when invalid_parameter_value then null; end;
  perform review_social_draft(reviewer,draft_id,'request_changes',2,1,'Make the wording clearer.');
  begin
    perform review_social_draft(reviewer,draft_id,'approve',2,1);
    raise exception 'Stale decision accepted';
  exception when sqlstate 'PT409' then null; end;
  perform review_social_draft(actor,draft_id,'submit',2,2);
  perform review_social_draft(actor,draft_id,'withdraw',2,3);
  perform review_social_draft(actor,draft_id,'submit',2,4);
  perform review_social_draft(reviewer,draft_id,'approve',2,5,'Approved public wording.');
  perform save_social_draft(actor,draft_id,'update','Idea','Public caption',2);
  if (select review_state from social_posts where id=draft_id)<>'approved' then raise exception 'No-op edit invalidated review'; end if;
  perform save_social_draft(actor,draft_id,'update','Idea','Changed caption',2);
  if (select review_state from social_posts where id=draft_id)<>'not_submitted' or (select review_version from social_posts where id=draft_id)<>7 then
    raise exception 'Changed content retained approval'; end if;
  if not exists(select 1 from social_review_events where post_id=draft_id and revision=2 and action='approve')
    or not exists(select 1 from social_review_events where post_id=draft_id and revision=2 and action='invalidated') then raise exception 'Approval audit lost'; end if;
  begin
    perform review_social_draft(reviewer,draft_id,'approve',2,6);
    raise exception 'Old revision approved';
  exception when sqlstate 'PT409' then null; end;
  perform review_social_draft(actor,draft_id,'submit',3,7);
  result:=list_social_drafts(reviewer,'awaiting_review',0,draft_id);
  if result->>'can_review'<>'true' or jsonb_array_length(result->'reviews')<>8 then raise exception 'Review detail incorrect'; end if;
  result:=list_social_drafts(actor,'awaiting_review');
  if result->>'can_review'<>'false' or not exists(select 1 from jsonb_array_elements(result->'posts') p where p->>'id'=draft_id::text) then
    raise exception 'Review queue or agent permissions incorrect'; end if;
  update agency_members set active=false where user_id=reviewer;
  begin
    perform review_social_draft(reviewer,draft_id,'approve',3,8);
    raise exception 'Revoked reviewer approved';
  exception when insufficient_privilege then null; end;
  perform save_social_draft(actor,draft_id,'archive',null,null,3);
  if (select review_state from social_posts where id=draft_id)<>'not_submitted' then raise exception 'Archive retained review'; end if;
  if has_function_privilege('authenticated','public.review_social_draft(uuid,uuid,text,integer,integer,text)','execute')
    or has_function_privilege('service_role','public.list_social_drafts_content(uuid,text,integer,uuid)','execute')
    or has_table_privilege('service_role','public.social_review_events','update') then raise exception 'Review grants unsafe'; end if;
end;
$test$;
rollback;
