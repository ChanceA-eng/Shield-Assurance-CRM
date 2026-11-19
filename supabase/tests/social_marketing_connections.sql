begin;
do $test$
declare
  owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid();
  oauth_id uuid:=gen_random_uuid(); refreshed_oauth_id uuid:=gen_random_uuid();
  connection_id uuid; target_grant uuid; result jsonb; details jsonb;
  granted text[]:=array['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish'];
  account_rows jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,'social-connections-owner-'||owner_id||'@example.invalid',now()),
    (agent_id,'social-connections-agent-'||agent_id||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
    from auth.users where id in(owner_id,agent_id);

  perform begin_social_oauth(owner_id,repeat('a',64),repeat('b',64),
    'https://crm.invalid/api/social-marketing/connections/callback');
  begin
    perform begin_social_oauth(agent_id,repeat('c',64),repeat('d',64),
      'https://crm.invalid/api/social-marketing/connections/callback');
    raise exception 'Agent started provider authorization';
  exception when insufficient_privilege then null; end;
  begin
    perform consume_social_oauth_state(owner_id,repeat('a',64),repeat('e',64));
    raise exception 'OAuth state accepted a different browser';
  exception when sqlstate 'PT409' then null; end;
  details:=consume_social_oauth_state(owner_id,repeat('a',64),repeat('b',64));
  if details->>'provider'<>'meta' or details->>'redirect_uri'<>'https://crm.invalid/api/social-marketing/connections/callback' then
    raise exception 'OAuth callback binding did not match'; end if;
  begin
    perform consume_social_oauth_state(owner_id,repeat('a',64),repeat('b',64));
    raise exception 'OAuth state replay was accepted';
  exception when sqlstate 'PT409' then null; end;

  perform store_social_oauth_grant(owner_id,oauth_id,'123456789','Agency Login',repeat('x',64),granted,clock_timestamp()+interval '1 hour');
  details:=load_social_oauth_grant(owner_id,oauth_id);
  if details->>'encrypted_user_token'<>repeat('x',64) then raise exception 'OAuth grant was not securely retained'; end if;
  begin
    perform load_social_oauth_grant(agent_id,oauth_id);
    raise exception 'Agent loaded an owner OAuth grant';
  exception when insufficient_privilege then null; end;

  account_rows:=jsonb_build_array(
    jsonb_build_object('platform','facebook_page','external_account_id','12345','account_name','Agency Page',
      'encrypted_page_token',repeat('p',64),'can_publish',true,'granted_scopes',to_jsonb(granted)),
    jsonb_build_object('platform','instagram_business','external_account_id','67890','account_name','agency',
      'username','agency','parent_page_id','12345','parent_page_name','Agency Page','can_publish',true,
      'granted_scopes',to_jsonb(granted))
  );
  result:=save_social_provider_accounts(owner_id,oauth_id,account_rows);
  if jsonb_array_length(result->'connections')<>2 then raise exception 'Facebook and Instagram accounts were not saved'; end if;
  if jsonb_array_length(result->'grants')<>1 or result->'grants'->0 ? 'encrypted_user_token' then
    raise exception 'Meta grants are missing safe list data or leaked credentials'; end if;
  if result->'connections'->0 ? 'encrypted_page_token' or result->'connections'->0 ? 'encrypted_user_token'
    or result->'connections'->1 ? 'encrypted_page_token' or result->'connections'->1 ? 'encrypted_user_token' then
    raise exception 'Provider credential appeared in the account-list response'; end if;
  if (result->>'can_manage')::boolean is not true then raise exception 'Active owner cannot manage connections'; end if;
  if (list_social_provider_connections(agent_id)->>'can_manage')::boolean is not false then raise exception 'Agent gained connection controls'; end if;
  select id into connection_id from social_provider_connections where workspace_id=social_marketing_workspace_for(owner_id)
    and platform='facebook_page' and external_account_id='12345';
  select id into target_grant from social_provider_grants where workspace_id=social_marketing_workspace_for(owner_id)
    and external_user_id='123456789';
  update social_provider_grants set token_expires_at=clock_timestamp()-interval '1 minute' where id=target_grant;
  update social_provider_connections set token_expires_at=clock_timestamp()-interval '1 minute' where grant_id=target_grant;
  result:=list_social_provider_connections(owner_id);
  if not exists(select 1 from jsonb_array_elements(result->'connections') c
    where c->>'id'=connection_id::text and c->>'state'='reconnect' and c->>'can_publish'='false') then
    raise exception 'Expired Meta token remained publish-capable'; end if;
  update social_provider_grants set token_expires_at=clock_timestamp()+interval '1 hour' where id=target_grant;
  update social_provider_connections set token_expires_at=clock_timestamp()+interval '1 hour' where grant_id=target_grant;

  begin
    perform disconnect_social_provider_account(agent_id,connection_id);
    raise exception 'Agent disconnected a provider account';
  exception when insufficient_privilege then null; end;

  perform store_social_oauth_grant(owner_id,refreshed_oauth_id,'123456789','Agency Login',repeat('y',64),granted,clock_timestamp()+interval '1 hour');
  result:=save_social_provider_accounts(owner_id,refreshed_oauth_id,jsonb_build_array(
    jsonb_build_object('platform','facebook_page','external_account_id','12345','account_name','Agency Page',
      'encrypted_page_token',repeat('q',64),'can_publish',true,'granted_scopes',to_jsonb(granted))
  ));
  if (select state from social_provider_connections where platform='instagram_business' and external_account_id='67890')<>'disconnected' then
    raise exception 'Unselected Instagram account remained active'; end if;
  if jsonb_array_length(result->'connections')<>2 then raise exception 'Page refresh removed account history'; end if;

  result:=disconnect_social_provider_account(owner_id,connection_id);
  if result->>'state'<>'disconnected' or exists(select 1 from social_provider_connections where platform='instagram_business'
    and parent_page_id='12345' and state<>'disconnected') then raise exception 'Disconnect left a linked account enabled'; end if;
  result:=load_social_provider_revoke(owner_id,target_grant);
  if result->>'encrypted_user_token'<>repeat('y',64) then raise exception 'Provider grant could not be revoked'; end if;
  perform finish_social_provider_revoke(owner_id,target_grant,false,'remote unavailable');
  if exists(select 1 from social_provider_connections where social_provider_connections.grant_id=target_grant
    and state<>'disconnected') then
    raise exception 'Failed remote revoke changed already-disconnected account state'; end if;
  if exists(select 1 from social_provider_connections where social_provider_connections.grant_id=target_grant and can_publish) then
    raise exception 'Failed remote revoke left publishing enabled'; end if;
  perform finish_social_provider_revoke(owner_id,target_grant,true,null);
  if exists(select 1 from social_provider_grants where id=target_grant and encrypted_user_token is not null)
    or exists(select 1 from social_provider_connections where social_provider_connections.grant_id=target_grant and encrypted_page_token is not null) then
    raise exception 'Confirmed revoke retained tokens'; end if;

  if has_function_privilege('authenticated','public.load_social_oauth_grant(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.save_social_provider_accounts(uuid,uuid,jsonb)','execute')
    or has_table_privilege('authenticated','public.social_provider_grants','select')
    or has_table_privilege('service_role','public.social_provider_grants','select') then
    raise exception 'Social provider storage grants are too broad'; end if;
end;
$test$;
rollback;
