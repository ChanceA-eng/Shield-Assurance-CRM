begin;
do $test$
declare owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid(); post_id uuid:=gen_random_uuid();
  grant_id uuid:=gen_random_uuid(); page_id uuid:=gen_random_uuid(); instagram_id uuid:=gen_random_uuid();
  live_intent_id uuid:=gen_random_uuid(); published_intent uuid:=gen_random_uuid(); result jsonb; lease uuid; workspace uuid;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'social-publish-owner-'||owner_id||'@example.invalid',now()),
    (agent_id,'social-publish-agent-'||agent_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
    from auth.users where id in(owner_id,agent_id);
  workspace:=social_marketing_workspace_for(owner_id);

  perform save_social_draft(agent_id,post_id,'create','Provider post','Approved Page update.','https://example.invalid');
  perform review_social_draft(agent_id,post_id,'submit',1,0);
  perform review_social_draft(owner_id,post_id,'approve',1,1);

  insert into social_provider_grants(id,workspace_id,provider,external_user_id,user_name,encrypted_user_token,
    granted_scopes,token_expires_at,state,authorized_by)
  values(grant_id,workspace,'meta','123456789','Agency Login',repeat('u',64),
    array['pages_manage_posts','pages_read_engagement','instagram_basic','instagram_content_publish'],
    clock_timestamp()+interval '1 day','connected',owner_id);
  insert into social_provider_connections(id,workspace_id,grant_id,platform,external_account_id,account_name,
    encrypted_page_token,can_publish,state,authorized_by,granted_scopes,token_expires_at)
  values(page_id,workspace,grant_id,'facebook_page','111','Agency Page',repeat('p',64),true,'connected',owner_id,
    array['pages_manage_posts','pages_read_engagement'],clock_timestamp()+interval '1 day');
  insert into social_provider_connections(id,workspace_id,grant_id,platform,external_account_id,account_name,
    parent_page_id,parent_page_name,can_publish,state,authorized_by,granted_scopes,token_expires_at)
  values(instagram_id,workspace,grant_id,'instagram_business','222','agency','111','Agency Page',true,'connected',owner_id,
    array['instagram_basic','instagram_content_publish','pages_manage_posts','pages_read_engagement'],clock_timestamp()+interval '1 day');

  result:=prepare_social_publish_intent(agent_id,live_intent_id,post_id,1,page_id);
  if result->>'destination'<>'facebook_page' or result->>'state'<>'awaiting_approval' then
    raise exception 'Live target was not bound to the selected Facebook Page';
  end if;
  result:=list_social_engine(agent_id);
  if result::text like '%encrypted_page_token%' or result::text like '%encrypted_user_token%' then
    raise exception 'Social engine list leaked a provider credential';
  end if;
  if not exists(select 1 from jsonb_array_elements(result->'connections') c
    where c->>'id'=page_id::text and c->>'platform'='facebook_page') then
    raise exception 'Publishing-capable connection was not exposed safely';
  end if;
  begin
    perform prepare_social_publish_intent(agent_id,gen_random_uuid(),post_id,1,instagram_id);
    raise exception 'Instagram accepted a link-only post';
  exception when sqlstate '22023' then null; end;

  result:=command_social_engine(owner_id,jsonb_build_object('action','approve','id',live_intent_id,'expected_version',1));
  if result->>'message'<>'Exact revision and live destination approved by an owner/admin.' then
    raise exception 'Live destination approval was mislabeled as a test approval';
  end if;
  result:=command_social_engine(owner_id,jsonb_build_object('action','schedule','id',live_intent_id,'expected_version',2,
    'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  if result->>'message'<>'Live post scheduled for the connected account.' then
    raise exception 'Live destination schedule was mislabeled as a test schedule';
  end if;
  perform command_social_engine(owner_id,'{"action":"pause","paused":false}'::jsonb);
  if claim_social_intent_gated(live_intent_id,3,false,false) is not null then
    raise exception 'A target dispatched while real publishing was disabled';
  end if;
  result:=claim_social_intent_gated(live_intent_id,3,false,true);
  lease:=(result->>'lease_id')::uuid;
  if result->>'destination'<>'facebook_page' or lease is null then raise exception 'Enabled real target did not claim'; end if;
  if not start_social_intent(live_intent_id,lease) then raise exception 'Live target failed its pre-dispatch checks'; end if;
  result:=load_social_publish_context(live_intent_id,lease);
  if result->>'account_id'<>'111' or result->>'token_context'<>workspace::text||':meta:page:111'
    or result->>'caption'<>'Approved Page update.' then raise exception 'Worker context did not bind exact content and credentials'; end if;
  if not begin_social_provider_dispatch(live_intent_id,lease) then raise exception 'Provider dispatch could not be fenced'; end if;
  if not finish_social_publish_intent(live_intent_id,lease,'uncertain',null,null,'Provider response was lost.') then
    raise exception 'Uncertain provider result did not commit';
  end if;
  if (select state from social_intents where id=live_intent_id)<>'confirming'
    or exists(select 1 from social_outbox where social_outbox.intent_id=live_intent_id) then
    raise exception 'Uncertain provider result was automatically retried';
  end if;
  if claim_social_intent_gated(live_intent_id,5,false,true) is not null then
    raise exception 'Uncertain provider result was blindly retried';
  end if;
  begin
    perform command_social_engine(owner_id,jsonb_build_object('action','confirm','id',live_intent_id,'expected_version',5));
    raise exception 'Test-only confirmation resolved a real uncertain publication';
  exception when sqlstate 'PT409' then null; end;
  result:=resolve_social_publish_intent(owner_id,live_intent_id,5,'not_published',null,null);
  if result->>'state'<>'failed' or (select publish_dispatched_at from social_intents where id=live_intent_id) is not null then
    raise exception 'Verified non-publication did not unlock an explicit retry';
  end if;
  result:=command_social_engine(owner_id,jsonb_build_object('action','retry','id',live_intent_id,'expected_version',6));
  if result->>'state'<>'scheduled' or result->>'message'<>'Explicit retry requested after confirming no live post exists.' then
    raise exception 'Explicit retry after operator confirmation was not scheduled';
  end if;

  perform prepare_social_publish_intent(agent_id,published_intent,post_id,1,page_id);
  perform command_social_engine(owner_id,jsonb_build_object('action','approve','id',published_intent,'expected_version',1));
  perform command_social_engine(owner_id,jsonb_build_object('action','schedule','id',published_intent,'expected_version',2,
    'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  result:=claim_social_intent_gated(published_intent,3,false,true);
  lease:=(result->>'lease_id')::uuid;
  if not start_social_intent(published_intent,lease) or not begin_social_provider_dispatch(published_intent,lease) then
    raise exception 'Second live target did not start';
  end if;
  perform finish_social_publish_intent(published_intent,lease,'uncertain',null,null,'Provider response was lost.');
  result:=resolve_social_publish_intent(owner_id,published_intent,5,'published','123_456','https://www.facebook.com/123_456');
  if result->>'state'<>'published' or result->>'remote_id'<>'123_456'
    or result->>'permalink'<>'https://www.facebook.com/123_456' then
    raise exception 'Verified provider publication was not retained';
  end if;
end;
$test$;
rollback;
