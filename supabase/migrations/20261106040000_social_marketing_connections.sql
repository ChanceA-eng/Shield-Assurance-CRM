begin;

create table public.social_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text not null check (browser_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references public.social_marketing_workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider='meta'),
  redirect_uri text not null check (redirect_uri ~ '^https://[^?#]+/api/social-marketing/connections/callback$'
    or redirect_uri ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/api/social-marketing/connections/callback$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index social_oauth_states_expiry on public.social_oauth_states(expires_at);

create table public.social_oauth_grants (
  id uuid primary key,
  workspace_id uuid not null references public.social_marketing_workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider='meta'),
  external_user_id text not null check (external_user_id ~ '^[0-9]{1,32}$'),
  user_name text not null check (char_length(btrim(user_name)) between 1 and 200),
  encrypted_user_token text not null check (char_length(encrypted_user_token) between 40 and 21000),
  granted_scopes text[] not null check (cardinality(granted_scopes)<=30),
  token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at>created_at and expires_at<=created_at+interval '15 minutes')
);
create index social_oauth_grants_expiry on public.social_oauth_grants(expires_at);

create table public.social_provider_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.social_marketing_workspaces(id) on delete restrict,
  provider text not null check (provider='meta'),
  external_user_id text not null check (external_user_id ~ '^[0-9]{1,32}$'),
  user_name text not null check (char_length(btrim(user_name)) between 1 and 200),
  encrypted_user_token text,
  granted_scopes text[] not null check (cardinality(granted_scopes)<=30),
  token_expires_at timestamptz not null,
  state text not null check (state in ('connected','reconnect','revocation_pending','disconnected')),
  authorized_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  last_validated_at timestamptz,
  last_error text check (last_error is null or char_length(last_error)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,provider,external_user_id),
  unique(workspace_id,id),
  check (state in ('connected','revocation_pending') or encrypted_user_token is null)
);

create table public.social_provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.social_marketing_workspaces(id) on delete restrict,
  grant_id uuid not null references public.social_provider_grants(id) on delete restrict,
  platform text not null check (platform in ('facebook_page','instagram_business')),
  external_account_id text not null check (external_account_id ~ '^[0-9]{1,32}$'),
  account_name text not null check (char_length(btrim(account_name)) between 1 and 200),
  username text check (username is null or char_length(username)<=100),
  parent_page_id text,
  parent_page_name text,
  encrypted_page_token text,
  can_publish boolean not null default false,
  capability_reason text check (capability_reason is null or char_length(capability_reason)<=500),
  state text not null check (state in ('connected','reconnect','revocation_pending','disconnected')),
  authorized_by uuid not null references auth.users(id) on delete restrict,
  granted_scopes text[] not null check(cardinality(granted_scopes)<=30),
  token_expires_at timestamptz not null,
  updated_by uuid references auth.users(id) on delete set null,
  last_validated_at timestamptz,
  last_error text check (last_error is null or char_length(last_error)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,platform,external_account_id),
  check ((platform='facebook_page' and parent_page_id is null and parent_page_name is null
      and ((state='disconnected' and encrypted_page_token is null) or (state<>'disconnected' and encrypted_page_token is not null)))
    or (platform='instagram_business' and parent_page_id is not null and parent_page_name is not null and encrypted_page_token is null)),
  foreign key(workspace_id,grant_id) references public.social_provider_grants(workspace_id,id) on delete restrict
);
create index social_provider_connections_workspace on public.social_provider_connections(workspace_id,state,platform);
create index social_provider_connections_grant on public.social_provider_connections(grant_id,state);

alter table public.social_oauth_states enable row level security;
alter table public.social_oauth_grants enable row level security;
alter table public.social_provider_grants enable row level security;
alter table public.social_provider_connections enable row level security;
revoke all on public.social_oauth_states,public.social_oauth_grants,public.social_provider_grants,public.social_provider_connections
  from public,anon,authenticated,service_role;

create function public.begin_social_oauth(p_actor uuid,p_state_hash text,p_browser_hash text,p_redirect_uri text)
returns void language plpgsql security definer set search_path=public as $$
declare workspace uuid;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can connect social accounts.' using errcode='42501'; end if;
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' or p_browser_hash is null or p_browser_hash !~ '^[0-9a-f]{64}$'
    or p_redirect_uri is null or not (p_redirect_uri ~ '^https://[^?#]+/api/social-marketing/connections/callback$'
      or p_redirect_uri ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/api/social-marketing/connections/callback$') then
    raise exception 'Social authorization setup is invalid.' using errcode='22023';
  end if;
  delete from social_oauth_states where expires_at<=clock_timestamp();
  delete from social_oauth_grants where expires_at<=clock_timestamp();
  insert into social_oauth_states(state_hash,browser_hash,workspace_id,actor_id,provider,redirect_uri,expires_at)
    values(p_state_hash,p_browser_hash,workspace,p_actor,'meta',p_redirect_uri,clock_timestamp()+interval '10 minutes');
end;
$$;

create function public.consume_social_oauth_state(p_actor uuid,p_state_hash text,p_browser_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved social_oauth_states; workspace uuid;
begin
  if p_state_hash is null or p_browser_hash is null then raise exception 'Social authorization expired. Start again.' using errcode='PT409'; end if;
  select * into saved from social_oauth_states where state_hash=p_state_hash for update;
  if saved.state_hash is null or saved.actor_id<>p_actor or saved.browser_hash<>p_browser_hash
    or saved.expires_at<=clock_timestamp() then raise exception 'Social authorization expired or was already used. Start again.' using errcode='PT409'; end if;
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can connect social accounts.' using errcode='42501'; end if;
  if saved.workspace_id<>workspace then raise exception 'Social authorization belongs to a different CRM workspace. Start again.' using errcode='PT409'; end if;
  delete from social_oauth_states where state_hash=p_state_hash;
  return jsonb_build_object('workspace_id',saved.workspace_id,'provider',saved.provider,'redirect_uri',saved.redirect_uri);
end;
$$;

create function public.store_social_oauth_grant(p_actor uuid,p_id uuid,p_external_user_id text,p_user_name text,
  p_encrypted_user_token text,p_granted_scopes text[],p_token_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_oauth_grants;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can connect social accounts.' using errcode='42501'; end if;
  if p_id is null or p_external_user_id is null or p_external_user_id !~ '^[0-9]{1,32}$'
    or p_user_name is null or char_length(btrim(p_user_name)) not between 1 and 200
    or p_encrypted_user_token is null or char_length(p_encrypted_user_token) not between 40 and 21000
    or p_granted_scopes is null or cardinality(p_granted_scopes)>30
    or p_token_expires_at is null or clock_timestamp()+interval '5 minutes'>p_token_expires_at then
    raise exception 'Meta did not return valid social authorization. Reconnect and approve the requested permissions.' using errcode='22023';
  end if;
  insert into social_oauth_grants(id,workspace_id,actor_id,provider,external_user_id,user_name,encrypted_user_token,granted_scopes,token_expires_at,expires_at)
    values(p_id,workspace,p_actor,'meta',p_external_user_id,btrim(p_user_name),p_encrypted_user_token,p_granted_scopes,
      p_token_expires_at,clock_timestamp()+interval '10 minutes') returning * into saved;
  return jsonb_build_object('id',saved.id,'expires_at',saved.expires_at);
end;
$$;

create function public.finish_social_oauth_grant(p_actor uuid,p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare workspace uuid;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can connect social accounts.' using errcode='42501'; end if;
  delete from social_oauth_grants where id=p_id and workspace_id=workspace and actor_id=p_actor;
end;
$$;

create function public.load_social_oauth_grant(p_actor uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_oauth_grants;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can connect social accounts.' using errcode='42501'; end if;
  select * into saved from social_oauth_grants where id=p_id and workspace_id=workspace and actor_id=p_actor and expires_at>clock_timestamp();
  if saved.id is null then raise exception 'Social authorization expired. Reconnect and choose an account.' using errcode='PT409'; end if;
  return to_jsonb(saved);
end;
$$;

create function public.list_social_provider_connections(p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  return jsonb_build_object(
    'can_manage',exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin')),
    'grants',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'user_name',g.user_name,
      'state',case when g.state='connected' and g.token_expires_at<=clock_timestamp() then 'reconnect' else g.state end,
      'granted_scopes',g.granted_scopes,'token_expires_at',g.token_expires_at) order by g.user_name,g.id)
      from social_provider_grants g where g.workspace_id=workspace),'[]'::jsonb),
    'connections',coalesce((select jsonb_agg(to_jsonb(c) order by c.account_name,c.platform,c.id) from
      (select c.id,c.grant_id,c.platform,c.external_account_id,c.account_name,c.username,c.parent_page_id,c.parent_page_name,
        case when c.state<>'connected' or g.state<>'connected'
            or c.token_expires_at<=clock_timestamp() or g.token_expires_at<=clock_timestamp()
          then false else c.can_publish end as can_publish,
        case when c.state='connected' and g.state='connected'
            and (c.token_expires_at<=clock_timestamp() or g.token_expires_at<=clock_timestamp())
          then 'Meta authorization expired. Reconnect the Meta account.'
          when c.state='connected' and g.state='reconnect' then 'Reconnect the Meta account to restore access.'
          when c.state='connected' and g.state='revocation_pending' then 'Meta revocation is pending. Publishing is disabled.'
          else c.capability_reason end as capability_reason,
        case when c.state='connected' and g.state='connected'
            and (c.token_expires_at<=clock_timestamp() or g.token_expires_at<=clock_timestamp()) then 'reconnect'
          when c.state='connected' and g.state<>'connected' then g.state else c.state end as state,
        case when g.state='connected' and g.token_expires_at<=clock_timestamp() then 'reconnect' else g.state end as grant_state,
        c.updated_by,c.authorized_by,c.token_expires_at,c.last_validated_at,c.updated_at,c.granted_scopes
       from social_provider_connections c join social_provider_grants g on g.id=c.grant_id and g.workspace_id=c.workspace_id
       where c.workspace_id=workspace) c),'[]'::jsonb));
end;
$$;

create function public.save_social_provider_accounts(p_actor uuid,p_oauth_grant_id uuid,p_accounts jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; oauth social_oauth_grants; provider_grant_id uuid; item jsonb; page_id text; page_name text;
  seen_page boolean:=false; seen_instagram boolean:=false;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can connect social accounts.' using errcode='42501'; end if;
  if jsonb_typeof(p_accounts)<>'array' or jsonb_array_length(p_accounts) not between 1 and 2 then
    raise exception 'Choose a Facebook Page, and at most its linked Instagram account.' using errcode='22023'; end if;
  select * into oauth from social_oauth_grants where id=p_oauth_grant_id and workspace_id=workspace and actor_id=p_actor and expires_at>clock_timestamp() for update;
  if oauth.id is null then raise exception 'Social authorization expired. Reconnect and choose an account.' using errcode='PT409'; end if;
  if not oauth.granted_scopes @> array['pages_show_list','pages_read_engagement','pages_manage_posts']::text[] then
    raise exception 'Reconnect and approve Page discovery, Page engagement, and Page publishing permissions.' using errcode='PT409'; end if;
  insert into social_provider_grants(workspace_id,provider,external_user_id,user_name,encrypted_user_token,granted_scopes,
    token_expires_at,state,authorized_by,updated_by,last_validated_at,last_error)
    values(workspace,'meta',oauth.external_user_id,oauth.user_name,oauth.encrypted_user_token,oauth.granted_scopes,
      oauth.token_expires_at,'connected',p_actor,p_actor,clock_timestamp(),null)
  on conflict(workspace_id,provider,external_user_id) do update set user_name=excluded.user_name,
    encrypted_user_token=excluded.encrypted_user_token,granted_scopes=excluded.granted_scopes,
    token_expires_at=excluded.token_expires_at,state='connected',updated_by=p_actor,last_validated_at=clock_timestamp(),
    last_error=null,updated_at=clock_timestamp()
  returning id into provider_grant_id;
  for item in select value from jsonb_array_elements(p_accounts) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'platform' not in ('facebook_page','instagram_business')
      or item->>'external_account_id' is null or item->>'external_account_id' !~ '^[0-9]{1,32}$'
      or char_length(coalesce(item->>'account_name','')) not between 1 and 200
      or jsonb_typeof(item->'can_publish') is distinct from 'boolean' or jsonb_typeof(item->'granted_scopes') is distinct from 'array' then
      raise exception 'A selected Meta account is invalid. Refresh account discovery.' using errcode='22023'; end if;
    if item->>'platform'='facebook_page' then
      if seen_page then raise exception 'Choose exactly one Facebook Page.' using errcode='22023'; end if;
      page_id:=item->>'external_account_id'; page_name:=btrim(item->>'account_name'); seen_page:=true;
      if item->>'encrypted_page_token' is null or char_length(item->>'encrypted_page_token') not between 40 and 21000
        or item->>'parent_page_id' is not null or item->>'parent_page_name' is not null then
        raise exception 'Selected Page authorization is invalid. Reconnect the Page.' using errcode='22023'; end if;
    else
      if seen_instagram then raise exception 'Choose at most one linked Instagram account.' using errcode='22023'; end if;
      seen_instagram:=true;
      if not seen_page or item->>'parent_page_id'<>page_id or item->>'parent_page_name'<>page_name
        or item->>'encrypted_page_token' is not null
        or not (oauth.granted_scopes @> array['instagram_basic','instagram_content_publish']::text[]) then
        raise exception 'Instagram must be linked to the selected Page and approved for publishing.' using errcode='22023'; end if;
    end if;
    insert into social_provider_connections(workspace_id,grant_id,platform,external_account_id,account_name,username,
      parent_page_id,parent_page_name,encrypted_page_token,can_publish,capability_reason,state,authorized_by,granted_scopes,
      token_expires_at,updated_by,last_validated_at)
    values(workspace,provider_grant_id,item->>'platform',item->>'external_account_id',btrim(item->>'account_name'),
      nullif(btrim(item->>'username'),''),item->>'parent_page_id',item->>'parent_page_name',item->>'encrypted_page_token',
      (item->>'can_publish')::boolean,nullif(btrim(item->>'capability_reason'),''),'connected',p_actor,
      array(select jsonb_array_elements_text(item->'granted_scopes')),oauth.token_expires_at,p_actor,clock_timestamp())
    on conflict(workspace_id,platform,external_account_id) do update set grant_id=excluded.grant_id,
      account_name=excluded.account_name,username=excluded.username,parent_page_id=excluded.parent_page_id,
      parent_page_name=excluded.parent_page_name,encrypted_page_token=excluded.encrypted_page_token,
      can_publish=excluded.can_publish,capability_reason=excluded.capability_reason,state='connected',
      updated_by=p_actor,last_validated_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp(),
      granted_scopes=excluded.granted_scopes,token_expires_at=oauth.token_expires_at,authorized_by=p_actor;
  end loop;
  if not seen_page then raise exception 'Choose the connected Facebook Page first.' using errcode='22023'; end if;
  if not seen_instagram then
    update social_provider_connections set state='disconnected',can_publish=false,
      capability_reason='Unselected during Page account setup.',updated_by=p_actor,updated_at=clock_timestamp()
      where platform='instagram_business' and parent_page_id=page_id and state<>'disconnected';
  end if;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,provider_grant_id,'social_meta_accounts_connected',
      jsonb_build_object('provider','meta','account_count',jsonb_array_length(p_accounts)));
  return list_social_provider_connections(p_actor);
end;
$$;

create function public.disconnect_social_provider_account(p_actor uuid,p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_provider_connections;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can disconnect social accounts.' using errcode='42501'; end if;
  select * into saved from social_provider_connections where id=p_connection_id and workspace_id=workspace for update;
  if saved.id is null then raise exception 'Connected account not found.' using errcode='P0002'; end if;
  update social_provider_connections set state='disconnected',encrypted_page_token=null,can_publish=false,
    capability_reason='Disconnected in the CRM.',updated_by=p_actor,updated_at=clock_timestamp() where id=saved.id;
  if saved.platform='facebook_page' then
    update social_provider_connections set state='disconnected',can_publish=false,
      capability_reason='Parent Facebook Page disconnected in the CRM.',updated_by=p_actor,updated_at=clock_timestamp()
      where grant_id=saved.grant_id and platform='instagram_business' and parent_page_id=saved.external_account_id;
  end if;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,saved.id,'social_provider_account_disconnected',jsonb_build_object('provider','meta','platform',saved.platform));
  return jsonb_build_object('id',saved.id,'state','disconnected');
end;
$$;

create function public.load_social_provider_revoke(p_actor uuid,p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_provider_grants;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can revoke Meta authorization.' using errcode='42501'; end if;
  select * into saved from social_provider_grants where id=p_grant_id and workspace_id=workspace and provider='meta' for update;
  if saved.id is null or saved.state='disconnected' or saved.encrypted_user_token is null then
    raise exception 'Meta authorization is already disconnected.' using errcode='PT409'; end if;
  return jsonb_build_object('id',saved.id,'workspace_id',saved.workspace_id,'external_user_id',saved.external_user_id,
    'encrypted_user_token',saved.encrypted_user_token,'state',saved.state);
end;
$$;

create function public.finish_social_provider_revoke(p_actor uuid,p_grant_id uuid,p_revoked boolean,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_provider_grants; next_state text;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'Only an active owner or administrator can revoke Meta authorization.' using errcode='42501'; end if;
  select * into saved from social_provider_grants where id=p_grant_id and workspace_id=workspace and provider='meta' for update;
  if saved.id is null then raise exception 'Meta authorization not found.' using errcode='P0002'; end if;
  next_state:=case when p_revoked then 'disconnected' else 'revocation_pending' end;
  update social_provider_grants set state=next_state,encrypted_user_token=case when p_revoked then null else encrypted_user_token end,
    updated_by=p_actor,last_error=case when p_revoked then null else coalesce(nullif(left(btrim(p_error),500),''),'Remote revocation could not be confirmed.') end,
    updated_at=clock_timestamp() where id=saved.id;
  update social_provider_connections set state=next_state,encrypted_page_token=case when p_revoked then null else encrypted_page_token end,
    can_publish=false,capability_reason=case when p_revoked then 'Meta authorization revoked.' else 'Meta revocation pending. Publishing is disabled.' end,
    updated_by=p_actor,last_error=case when p_revoked then null else coalesce(nullif(left(btrim(p_error),500),''),'Remote revocation could not be confirmed.') end,
    updated_at=clock_timestamp() where grant_id=saved.id and state<>'disconnected';
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,saved.id,case when p_revoked then 'social_meta_authorization_revoked' else 'social_meta_revocation_pending' end,
      jsonb_build_object('provider','meta'));
  return jsonb_build_object('id',saved.id,'state',next_state);
end;
$$;

revoke all on function public.begin_social_oauth(uuid,text,text,text),
  public.consume_social_oauth_state(uuid,text,text),
  public.store_social_oauth_grant(uuid,uuid,text,text,text,text[],timestamptz),
  public.finish_social_oauth_grant(uuid,uuid),
  public.load_social_oauth_grant(uuid,uuid),
  public.list_social_provider_connections(uuid),
  public.save_social_provider_accounts(uuid,uuid,jsonb),
  public.disconnect_social_provider_account(uuid,uuid),
  public.load_social_provider_revoke(uuid,uuid),
  public.finish_social_provider_revoke(uuid,uuid,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_social_oauth(uuid,text,text,text),
  public.consume_social_oauth_state(uuid,text,text),
  public.store_social_oauth_grant(uuid,uuid,text,text,text,text[],timestamptz),
  public.finish_social_oauth_grant(uuid,uuid),
  public.load_social_oauth_grant(uuid,uuid),
  public.list_social_provider_connections(uuid),
  public.save_social_provider_accounts(uuid,uuid,jsonb),
  public.disconnect_social_provider_account(uuid,uuid),
  public.load_social_provider_revoke(uuid,uuid),
  public.finish_social_provider_revoke(uuid,uuid,boolean,text) to service_role;

notify pgrst,'reload schema';
commit;
