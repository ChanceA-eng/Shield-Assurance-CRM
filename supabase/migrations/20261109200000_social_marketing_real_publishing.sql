begin;

alter table public.social_engine_controls add column worker_test_enabled boolean not null default false;
alter table public.social_engine_controls add column worker_real_enabled boolean not null default false;
alter table public.social_provider_connections add constraint social_provider_connections_workspace_id_unique unique(workspace_id,id);
alter table public.social_intents drop constraint social_intents_destination_check;
alter table public.social_intents add constraint social_intents_destination_check
  check(destination in ('test','facebook_page','instagram_business'));
alter table public.social_intents alter column scenario drop not null;
alter table public.social_intents add column connection_id uuid references public.social_provider_connections(id) on delete restrict;
alter table public.social_intents add column remote_id text check(remote_id is null or remote_id ~ '^[0-9_]{1,70}$');
alter table public.social_intents add column permalink text check(permalink is null or permalink ~ '^https://[^?#]+$');
alter table public.social_intents add column container_id text check(container_id is null or container_id ~ '^[0-9]{1,32}$');
alter table public.social_intents add column container_status text not null default 'none'
  check(container_status in ('none','processing'));
alter table public.social_intents add column publish_dispatched_at timestamptz;
alter table public.social_intents add column published_at timestamptz;
alter table public.social_intents drop constraint social_intents_state_check;
alter table public.social_intents add constraint social_intents_state_check
  check(state in ('awaiting_approval','approved','scheduled','running','retry_wait','confirming','simulated','published','failed','canceled','blocked'));
alter table public.social_intents add constraint social_intents_destination_connection_check
  check((destination='test' and scenario is not null and connection_id is null)
     or (destination in ('facebook_page','instagram_business') and scenario is null and connection_id is not null));
create index social_intents_connection on public.social_intents(connection_id,state);

create or replace function public.social_engine_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' or new.version<>old.version then
    insert into social_intent_events(intent_id,version,state,actor_id,message)
      values(new.id,new.version,new.state,case when tg_op='INSERT' then new.created_by else new.updated_by end,new.message);
  end if;
  if new.state in ('scheduled','retry_wait') or (new.state='confirming' and new.destination='test' and new.scenario<>'uncertain') then
    insert into social_outbox(intent_id,version,due_at) values(new.id,new.version,coalesce(new.scheduled_at,now()))
      on conflict(intent_id) do update set version=excluded.version,due_at=excluded.due_at;
  else delete from social_outbox where intent_id=new.id; end if;
  return new;
end;
$$;

create or replace function public.list_social_engine(p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  return jsonb_build_object('paused',coalesce((select paused from social_engine_controls where workspace_id=workspace),true),
    'worker_seen_at',(select worker_seen_at from social_engine_controls where workspace_id=workspace),
    'worker_test_enabled',coalesce((select worker_test_enabled from social_engine_controls where workspace_id=workspace),false),
    'worker_real_enabled',coalesce((select worker_real_enabled from social_engine_controls where workspace_id=workspace),false),
    'can_manage',exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin')),
    'connections',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'platform',c.platform,'account_name',c.account_name,
      'state',c.state,'can_publish',c.can_publish,'capability_reason',c.capability_reason,'token_expires_at',c.token_expires_at)
      order by c.platform,c.account_name,c.id) from social_provider_connections c where c.workspace_id=workspace
        and c.state<>'disconnected'),'[]'::jsonb),
    'intents',coalesce((select jsonb_agg((to_jsonb(i)-'lease_id'-'lease_until'-'started_at'-'container_id') || jsonb_build_object(
      'title',(select title from social_post_revisions where post_id=i.post_id and revision=i.revision),
      'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.version desc) from
        (select version,state,actor_id,message,recorded_at from social_intent_events where intent_id=i.id order by version desc limit 10) e),'[]'::jsonb),
      'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.attempt) from
        (select attempt,started_at,finished_at,outcome from social_attempts where intent_id=i.id) a),'[]'::jsonb))
      order by i.updated_at desc,i.id) from
      (select * from social_intents where workspace_id=workspace order by updated_at desc,id limit 200) i),'[]'::jsonb));
end;
$$;

create function public.reconcile_social_engine_gated(p_allow_test boolean,p_allow_real boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_allow_test is distinct from true and p_allow_real is distinct from true then
    update social_engine_controls set worker_seen_at=clock_timestamp(),worker_test_enabled=false,worker_real_enabled=false;
    return '[]'::jsonb;
  end if;
  perform reconcile_social_engine();
  insert into social_engine_controls(workspace_id,paused,worker_seen_at,worker_test_enabled,worker_real_enabled)
    select id,true,clock_timestamp(),p_allow_test,p_allow_real from social_marketing_workspaces where singleton
    on conflict(workspace_id) do update set worker_seen_at=clock_timestamp(),
      worker_test_enabled=excluded.worker_test_enabled,worker_real_enabled=excluded.worker_real_enabled;
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.intent_id,'version',o.version)) from
    (select o.* from social_outbox o join social_intents i on i.id=o.intent_id
      join social_engine_controls c on c.workspace_id=i.workspace_id
      where o.due_at<=clock_timestamp() and not c.paused
        and ((i.destination='test' and p_allow_test) or (i.destination<>'test' and p_allow_real))
      order by o.due_at,o.intent_id limit 50) o),'[]'::jsonb);
end;
$$;

create function public.prepare_social_publish_intent(p_actor uuid,p_id uuid,p_post_id uuid,p_revision integer,p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; post social_posts; target social_provider_connections; grant_row social_provider_grants; saved social_intents;
  required_scopes text[];
begin
  if p_id is null or p_post_id is null or p_revision is null or p_revision<1 or p_revision>=2147483647
    or p_connection_id is null then raise exception 'Choose a valid live publishing target.' using errcode='22023'; end if;
  workspace:=social_marketing_workspace_for(p_actor);
  perform pg_advisory_xact_lock(hashtextextended('social-engine:'||workspace::text,0));
  select * into post from social_posts where id=p_post_id and workspace_id=workspace for share;
  if post.id is null then raise exception 'Post not found.' using errcode='P0002'; end if;
  if post.status<>'draft' or post.revision<>p_revision or post.review_state<>'approved' then
    raise exception 'Approve the exact current content revision before preparing a live destination.' using errcode='PT409'; end if;
  if not exists(select 1 from agency_members where user_id=p_actor and active) then
    raise exception 'Active agency membership is required.' using errcode='42501'; end if;
  select * into target from social_provider_connections where id=p_connection_id and workspace_id=workspace for share;
  if target.id is null then raise exception 'Connected social account not found.' using errcode='P0002'; end if;
  if target.platform not in ('facebook_page','instagram_business') or target.state<>'connected'
    or not target.can_publish or target.token_expires_at<=clock_timestamp() then
    raise exception 'Reconnect this account and verify publishing permissions before scheduling.' using errcode='PT409'; end if;
  if target.platform='instagram_business' and cardinality(post.media_ids)=0 then
    raise exception 'Instagram publishing requires one approved image.' using errcode='22023'; end if;
  if target.platform='instagram_business' and post.link_url is not null then
    raise exception 'Instagram posts use the caption and approved image; remove the link from this draft.' using errcode='22023'; end if;
  if cardinality(post.media_ids)>0 and not exists(select 1 from social_revision_media rm join social_media_assets m
    on m.id=rm.media_id and m.workspace_id=rm.workspace_id where rm.post_id=post.id and rm.revision=post.revision
      and rm.media_id=any(post.media_ids) and m.status='ready') then
    raise exception 'The current revision image is not ready. Update and reapprove the post.' using errcode='PT409'; end if;
  select * into grant_row from social_provider_grants where id=target.grant_id and workspace_id=workspace for share;
  if grant_row.id is null or grant_row.state<>'connected' or grant_row.token_expires_at<=clock_timestamp()
    or grant_row.encrypted_user_token is null then
    raise exception 'Meta authorization expired or was revoked. Reconnect the account.' using errcode='PT409'; end if;
  required_scopes:=case target.platform when 'facebook_page' then array['pages_manage_posts','pages_read_engagement']
    else array['instagram_basic','instagram_content_publish','pages_manage_posts','pages_read_engagement'] end;
  if not (grant_row.granted_scopes @> required_scopes) or not (target.granted_scopes @> required_scopes) then
    raise exception 'Meta authorization is missing publishing permissions. Reconnect and approve the requested permissions.' using errcode='PT409'; end if;
  if target.platform='instagram_business' and not exists(select 1 from social_provider_connections page
    where page.workspace_id=workspace and page.grant_id=target.grant_id and page.platform='facebook_page'
      and page.external_account_id=target.parent_page_id and page.state='connected' and page.can_publish
      and page.encrypted_page_token is not null and page.token_expires_at>clock_timestamp()
      and page.granted_scopes @> array['pages_manage_posts','pages_read_engagement']) then
    raise exception 'The linked Facebook Page is disconnected or cannot publish. Reconnect the Page.' using errcode='PT409'; end if;
  select * into saved from social_intents where id=p_id;
  if saved.id is not null then
    if saved.workspace_id=workspace and saved.post_id=post.id and saved.revision=post.revision
      and saved.connection_id=target.id and saved.destination=target.platform and saved.created_by=p_actor then
      return to_jsonb(saved)-'lease_id'-'lease_until'-'started_at';
    end if;
    raise exception 'This publishing intent already exists.' using errcode='PT409';
  end if;
  insert into social_intents(id,workspace_id,post_id,revision,destination,scenario,connection_id,created_by,message)
    values(p_id,workspace,post.id,post.revision,target.platform,null,target.id,p_actor,'Live destination selected. Owner/admin approval is required.')
    returning * into saved;
  return to_jsonb(saved)-'lease_id'-'lease_until'-'started_at';
end;
$$;

create or replace function public.command_social_engine(p_actor uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_intents; post social_posts; action text:=p_command->>'action'; due timestamptz; target_id uuid;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  if action is null or action not in ('prepare','approve','schedule','cancel','retry','confirm','pause') then
    raise exception 'Choose a supported publishing action.' using errcode='22023'; end if;
  if action in ('approve','schedule','retry','confirm','pause') then
    perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
    if not found then raise exception 'An active owner or administrator must manage publishing.' using errcode='42501'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social-engine:'||workspace::text,0));
  if action='pause' then
    if jsonb_typeof(p_command->'paused')<>'boolean' or not p_command ? 'paused' then
      raise exception 'Choose pause or resume.' using errcode='22023'; end if;
    insert into social_engine_controls(workspace_id,paused,updated_by) values(workspace,(p_command->>'paused')::boolean,p_actor)
      on conflict(workspace_id) do update set paused=excluded.paused,updated_by=p_actor,updated_at=clock_timestamp();
    return list_social_engine(p_actor);
  end if;
  target_id:=(p_command->>'id')::uuid;
  if target_id is null then raise exception 'Choose a valid publishing intent.' using errcode='22023'; end if;
  if action='prepare' then
    if p_command->>'scenario' is null or p_command->>'scenario' not in ('success','retry_once','permanent_failure','uncertain') then
      raise exception 'Choose a supported test scenario.' using errcode='22023'; end if;
    select * into post from social_posts where id=(p_command->>'post_id')::uuid and workspace_id=workspace for share;
    if post.id is null then raise exception 'Post not found.' using errcode='P0002'; end if;
    if (p_command->>'revision') is null or post.status<>'draft' or post.revision<>(p_command->>'revision')::integer or post.review_state<>'approved' then
      raise exception 'Approve the current saved content before preparing a destination.' using errcode='PT409'; end if;
    select * into saved from social_intents where id=target_id;
    if saved.id is not null then
      if saved.workspace_id=workspace and saved.post_id=post.id and saved.revision=post.revision
        and saved.destination='test' and saved.scenario=p_command->>'scenario' and saved.created_by=p_actor then
        return to_jsonb(saved)-'lease_id'-'lease_until'-'started_at';
      end if;
      raise exception 'This publishing intent already exists.' using errcode='PT409';
    end if;
    insert into social_intents(id,workspace_id,post_id,revision,scenario,created_by,message)
      values(target_id,workspace,post.id,post.revision,p_command->>'scenario',p_actor,'Test destination selected. Destination approval required.')
      returning * into saved;
  else
    select * into saved from social_intents where id=target_id and workspace_id=workspace;
    if saved.id is null then raise exception 'Publishing intent not found.' using errcode='P0002'; end if;
    select * into post from social_posts where id=saved.post_id for share;
    select * into saved from social_intents where id=target_id and workspace_id=workspace for update;
    if (p_command->>'expected_version') is null or saved.version<>(p_command->>'expected_version')::integer then
      raise exception 'This intent changed. Reload before continuing.' using errcode='PT409'; end if;
    if saved.destination<>'test' and action='confirm' then
      raise exception 'Live provider outcomes require explicit Meta reconciliation.' using errcode='PT409'; end if;
    if action not in ('cancel','confirm') and (post.status<>'draft' or post.revision<>saved.revision or post.review_state<>'approved') then
      raise exception 'Content approval is no longer current. Prepare a new approved revision.' using errcode='PT409'; end if;
    if action='approve' then
      if saved.state<>'awaiting_approval' then raise exception 'This destination is not awaiting approval.' using errcode='PT409'; end if;
      update social_intents set state='approved',approved_by=p_actor,
        message=case when saved.destination='test' then 'Exact revision and test destination approved.'
          else 'Exact revision and live destination approved by an owner/admin.' end where id=target_id;
    elsif action='schedule' then
      if saved.state not in ('approved','scheduled','retry_wait') or p_command->>'timezone' is distinct from 'America/Phoenix' then
        raise exception 'Choose an approved intent and an Arizona schedule.' using errcode='22023'; end if;
      due:=(p_command->>'scheduled_at')::timestamptz;
      if due is null or not isfinite(due) or due<clock_timestamp()-interval '1 minute' or due>clock_timestamp()+interval '1 year' then
        raise exception 'Choose a schedule between now and one year ahead.' using errcode='22023'; end if;
      update social_intents set state='scheduled',scheduled_at=due,
        message=case when saved.destination='test' then 'Test run scheduled. No social network will be contacted.'
          else 'Live post scheduled for the connected account.' end where id=target_id;
    elsif action='cancel' then
      if saved.state in ('running','confirming','simulated') then
        raise exception 'Execution may already have been accepted. Resolve its outcome instead of canceling.' using errcode='PT409'; end if;
      if saved.state='canceled' then return to_jsonb(saved)-'lease_id'-'lease_until'-'started_at'; end if;
      update social_intents set state='canceled',
        message=case when saved.destination='test' then 'Test run canceled.' else 'Live post canceled before provider dispatch.' end where id=target_id;
    elsif action='retry' then
      if saved.state<>'failed' or saved.attempt_count>=3 or exists(select 1 from social_test_receipts where intent_id=saved.id)
        or (saved.destination<>'test' and saved.publish_dispatched_at is not null) then
        raise exception 'This intent cannot safely retry. Review the provider outcome before retrying.' using errcode='PT409'; end if;
      update social_intents set state='scheduled',scheduled_at=clock_timestamp(),
        message=case when saved.destination='test' then 'Explicit test retry requested.'
          else 'Explicit retry requested after confirming no live post exists.' end where id=target_id;
    elsif action='confirm' then
      if saved.state<>'confirming' then raise exception 'This intent does not need confirmation.' using errcode='PT409'; end if;
      if exists(select 1 from social_test_receipts where intent_id=saved.id) then
        update social_intents set state='simulated',receipt_id=(select receipt_id from social_test_receipts where intent_id=saved.id),
          message='Test acceptance confirmed. Nothing was published.' where id=target_id;
      else update social_intents set state='failed',message='No test acceptance found. Review before an explicit retry.' where id=target_id; end if;
    end if;
    update social_intents set version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=target_id returning * into saved;
  end if;
  return to_jsonb(saved)-'lease_id'-'lease_until'-'started_at';
end;
$$;

create function public.load_social_publish_context(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i social_intents; target social_provider_connections; page social_provider_connections; g social_provider_grants;
  post social_posts; revision social_post_revisions; asset social_media_assets; image_path text;
begin
  select * into i from social_intents where id=p_id and state='running' and lease_id=p_lease
    and lease_until>clock_timestamp() and started_at is not null for share;
  if i.id is null or i.destination='test' then raise exception 'Live publishing lease is no longer valid.' using errcode='PT409'; end if;
  select * into post from social_posts p where p.id=i.post_id and p.workspace_id=i.workspace_id and p.status='draft'
    and p.revision=i.revision and p.review_state='approved' for share;
  if post.id is null then raise exception 'Content approval changed before dispatch.' using errcode='PT409'; end if;
  select * into revision from social_post_revisions r
    where r.post_id=i.post_id and r.revision=i.revision and r.workspace_id=i.workspace_id;
  select * into target from social_provider_connections where id=i.connection_id and workspace_id=i.workspace_id
    and platform=i.destination and state='connected' and can_publish and token_expires_at>clock_timestamp() for share;
  if target.id is null then raise exception 'The destination disconnected or lost publishing permission.' using errcode='PT409'; end if;
  if target.platform='facebook_page' then page:=target;
  else select * into page from social_provider_connections where workspace_id=i.workspace_id and grant_id=target.grant_id
    and platform='facebook_page' and external_account_id=target.parent_page_id and state='connected' and can_publish
    and encrypted_page_token is not null and token_expires_at>clock_timestamp()
    and granted_scopes @> array['pages_manage_posts','pages_read_engagement'] for share;
  end if;
  if page.id is null then raise exception 'The linked Facebook Page disconnected before Instagram publishing.' using errcode='PT409'; end if;
  select * into g from social_provider_grants where id=target.grant_id and workspace_id=i.workspace_id
    and provider='meta' and state='connected' and encrypted_user_token is not null and token_expires_at>clock_timestamp() for share;
  if g.id is null then raise exception 'Meta authorization expired before dispatch.' using errcode='PT409'; end if;
  if cardinality(post.media_ids)>0 then
    select m.* into asset from social_revision_media rm join social_media_assets m
      on m.id=rm.media_id and m.workspace_id=rm.workspace_id
      where rm.post_id=i.post_id and rm.revision=i.revision and m.id=any(post.media_ids) and m.status='ready';
    if asset.id is null then raise exception 'The approved image is no longer available.' using errcode='PT409'; end if;
    image_path:=asset.workspace_id::text||'/'||asset.id::text||'/image.jpg';
  end if;
  return jsonb_build_object('intent_id',i.id,'workspace_id',i.workspace_id,'destination',i.destination,
    'connection_id',target.id,'account_id',target.external_account_id,'account_name',target.account_name,
    'page_id',page.external_account_id,'encrypted_page_token',page.encrypted_page_token,
    'token_context',i.workspace_id::text||':meta:page:'||page.external_account_id,
    'caption',revision.caption,'link_url',revision.link_url,'image_path',image_path,
    'container_id',i.container_id,'container_status',i.container_status,'publish_dispatched_at',i.publish_dispatched_at);
end;
$$;

create function public.record_social_publish_container(p_id uuid,p_lease uuid,p_container_id text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_container_id is null or p_container_id !~ '^[0-9]{1,32}$' then raise exception 'Instagram container is invalid.' using errcode='22023'; end if;
  update social_intents set container_id=p_container_id,container_status='processing'
    where id=p_id and destination='instagram_business' and state='running' and lease_id=p_lease and lease_until>clock_timestamp()
      and container_id is null and publish_dispatched_at is null;
  return found;
end;
$$;

create function public.begin_social_provider_dispatch(p_id uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update social_intents set publish_dispatched_at=clock_timestamp()
    where id=p_id and destination in ('facebook_page','instagram_business') and state='running'
      and lease_id=p_lease and lease_until>clock_timestamp() and publish_dispatched_at is null
      and (destination='facebook_page' or container_status='processing');
  return found;
end;
$$;

create function public.finish_social_publish_intent(p_id uuid,p_lease uuid,p_outcome text,p_remote_id text default null,
  p_permalink text default null,p_message text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare saved social_intents; next_state text; next_at timestamptz;
begin
  if p_outcome is null or p_outcome not in ('published','processing','retry','failed','blocked','uncertain')
    or (p_remote_id is not null and p_remote_id !~ '^[0-9_]{1,70}$')
    or (p_permalink is not null and p_permalink !~ '^https://[^?#]+$')
    or (p_message is not null and char_length(p_message)>500) then
    raise exception 'Live publishing result is invalid.' using errcode='22023'; end if;
  select * into saved from social_intents where id=p_id and destination<>'test' for update;
  if saved.id is null or saved.started_at is null or saved.state<>'running'
    or saved.lease_id is distinct from p_lease or saved.lease_until<=clock_timestamp() then return false; end if;
  if p_outcome='published' and p_remote_id is null then raise exception 'Published result ID is required.' using errcode='22023'; end if;
  if p_outcome='processing' and (saved.destination<>'instagram_business' or saved.container_id is null
    or saved.publish_dispatched_at is not null) then raise exception 'Instagram processing state is invalid.' using errcode='PT409'; end if;
  next_state:=case p_outcome when 'published' then 'published' when 'processing' then 'scheduled'
    when 'retry' then case when saved.attempt_count<3 then 'retry_wait' else 'failed' end
    when 'blocked' then 'blocked' when 'uncertain' then 'confirming' else 'failed' end;
  next_at:=case when p_outcome='processing' then clock_timestamp()+interval '10 seconds'
    when p_outcome='retry' and saved.attempt_count<3 then clock_timestamp()+make_interval(secs=>30*power(2,saved.attempt_count-1)::integer+floor(random()*5)::integer)
    else saved.scheduled_at end;
  update social_attempts set finished_at=clock_timestamp(),outcome=p_outcome where lease_id=p_lease;
  update social_intents set state=next_state,version=version+1,lease_id=null,lease_until=null,scheduled_at=next_at,
    publish_dispatched_at=case when p_outcome in ('retry','failed','blocked') then null else publish_dispatched_at end,
    remote_id=case when p_outcome='published' then p_remote_id else remote_id end,
    permalink=case when p_outcome='published' then p_permalink else permalink end,
    published_at=case when p_outcome='published' then clock_timestamp() else published_at end,
    message=coalesce(nullif(p_message,''),case p_outcome when 'published' then 'Published on the connected account.'
      when 'processing' then 'Instagram media is processing. The container is saved; the next check will continue without re-uploading.'
      when 'retry' then 'Meta returned a safe transient error. A bounded retry is queued.'
      when 'blocked' then 'Publishing authorization changed. Reconnect and prepare a new approved intent.'
      when 'uncertain' then 'Meta may have accepted this post. Check the provider before any retry.'
      else 'Meta rejected this post. Review the content and account before retrying.' end),
    updated_at=clock_timestamp() where id=p_id;
  return true;
end;
$$;

create function public.resolve_social_publish_intent(p_actor uuid,p_id uuid,p_expected_version integer,p_resolution text,
  p_remote_id text default null,p_permalink text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_intents;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
  if not found then raise exception 'An active owner or administrator must resolve an uncertain Meta result.' using errcode='42501'; end if;
  if p_resolution is null or p_resolution not in ('published','not_published')
    or (p_permalink is not null and p_permalink !~ '^https://[^?#]+$')
    or (p_resolution='published' and (p_remote_id is null or p_remote_id !~ '^[0-9_]{1,70}$'))
    or (p_resolution='not_published' and (p_remote_id is not null or p_permalink is not null)) then
    raise exception 'Enter a valid provider result.' using errcode='22023'; end if;
  select * into saved from social_intents where id=p_id and workspace_id=workspace and destination<>'test' for update;
  if saved.id is null then raise exception 'Live publishing intent not found.' using errcode='P0002'; end if;
  if p_expected_version is null or saved.version<>p_expected_version or saved.state<>'confirming'
    or saved.publish_dispatched_at is null or saved.remote_id is not null then
    raise exception 'This provider result changed. Reload before resolving it.' using errcode='PT409'; end if;
  update social_intents set state=case p_resolution when 'published' then 'published' else 'failed' end,
    version=version+1,remote_id=case when p_resolution='published' then p_remote_id else null end,
    permalink=case when p_resolution='published' then p_permalink else null end,
    published_at=case when p_resolution='published' then clock_timestamp() else null end,
    publish_dispatched_at=case when p_resolution='not_published' then null else publish_dispatched_at end,
    message=case p_resolution when 'published' then 'Operator confirmed published: provider result recorded.'
      else 'Operator confirmed no publication in Meta. An explicit retry is available.' end,
    updated_by=p_actor,updated_at=clock_timestamp()
    where id=p_id returning * into saved;
  return to_jsonb(saved)-'lease_id'-'lease_until'-'started_at'-'container_id'-'publish_dispatched_at';
end;
$$;

create or replace function public.reconcile_social_engine() returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update social_engine_controls set worker_seen_at=clock_timestamp();
  update social_attempts a set finished_at=clock_timestamp(),outcome='lease_expired'
    from social_intents i where i.state='running' and i.lease_until<clock_timestamp()
      and a.lease_id=i.lease_id and a.finished_at is null;
  update social_intents set state=case when started_at is null then 'retry_wait' else 'confirming' end,
    version=version+1,scheduled_at=clock_timestamp(),lease_id=null,lease_until=null,
    message=case when started_at is null then 'Worker lease expired before execution. Safe retry queued.'
      else 'Worker lease expired after test dispatch. Confirming acceptance before any retry.' end,
    updated_by=null,updated_at=clock_timestamp()
    where state='running' and destination='test' and lease_until<clock_timestamp();
  update social_intents set state=case when publish_dispatched_at is null then 'retry_wait' else 'confirming' end,
    version=version+1,scheduled_at=case when publish_dispatched_at is null then clock_timestamp() else scheduled_at end,
    lease_id=null,lease_until=null,
    message=case when publish_dispatched_at is null then 'Worker lease expired before provider dispatch. Safe retry queued.'
      else 'Worker lease expired after provider dispatch. Check Meta before any retry.' end,
    updated_by=null,updated_at=clock_timestamp()
    where state='running' and destination<>'test' and lease_until<clock_timestamp();
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.intent_id,'version',o.version)) from
    (select o.* from social_outbox o left join social_engine_controls c on c.workspace_id=(select workspace_id from social_intents where id=o.intent_id)
      where o.due_at<=clock_timestamp() and not coalesce(c.paused,true) order by o.due_at,o.intent_id limit 50) o),'[]'::jsonb);
end;
$$;

create or replace function public.claim_social_intent(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare saved social_intents; post social_posts; reviewer uuid; target social_provider_connections;
begin
  select * into saved from social_intents where id=p_id;
  if saved.id is null then return null; end if;
  select * into post from social_posts where id=saved.post_id for share;
  perform pg_advisory_xact_lock(hashtextextended('social-engine:'||saved.workspace_id::text,0));
  select * into saved from social_intents where id=p_id for update;
  if p_version is null or saved.version<>p_version or saved.state not in ('scheduled','retry_wait','confirming') or saved.scheduled_at>clock_timestamp()
    or coalesce((select paused from social_engine_controls where workspace_id=saved.workspace_id),true) then return null; end if;
  if saved.state='confirming' then
    if saved.destination<>'test' or saved.scenario='uncertain' then return null; end if;
    update social_intents set state=case when exists(select 1 from social_test_receipts where intent_id=p_id) then 'simulated' else 'failed' end,
      receipt_id=(select receipt_id from social_test_receipts where intent_id=p_id),
      message='Expired dispatch reconciled against the test receipt. Nothing was published.',version=version+1,updated_by=null,updated_at=clock_timestamp() where id=p_id;
    return null;
  end if;
  reviewer:=saved.approved_by;
  perform 1 from agency_members m join auth.users u on u.id=m.user_id
    where m.user_id=reviewer and m.active and m.role in ('owner','admin') and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of m,u;
  if not found or post.status<>'draft' or post.revision<>saved.revision or post.review_state<>'approved' then
    update social_intents set state='blocked',version=version+1,message='Content or destination approval is no longer authorized.',updated_at=clock_timestamp() where id=p_id;
    return null;
  end if;
  if saved.destination<>'test' then
    select * into target from social_provider_connections where id=saved.connection_id and workspace_id=saved.workspace_id
      and platform=saved.destination and state='connected' and can_publish and token_expires_at>clock_timestamp() for share;
    if target.id is null then
      update social_intents set state='blocked',version=version+1,message='Connected account or publishing authorization is no longer available.',
        updated_at=clock_timestamp() where id=p_id;
      return null;
    end if;
  end if;
  if saved.attempt_count>=3 then
    update social_intents set state='failed',version=version+1,message=case when saved.destination='test' then 'Test retry budget exhausted.' else 'Publishing retry budget exhausted.' end,
      updated_at=clock_timestamp() where id=p_id;
    return null;
  end if;
  update social_intents set state='running',version=version+1,
    lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',started_at=null,
    message=case when saved.destination='test' then 'Test worker claimed execution.' else 'Publishing worker claimed the approved destination.' end,
    updated_by=null,updated_at=clock_timestamp() where id=p_id returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.claim_social_intent_gated(p_id uuid,p_version integer,p_allow_test boolean,p_allow_real boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target text;
begin
  if p_allow_test is distinct from true and p_allow_real is distinct from true then return null; end if;
  select destination into target from social_intents where id=p_id;
  if target is null or (target='test' and p_allow_test is distinct from true)
    or (target<>'test' and p_allow_real is distinct from true) then return null; end if;
  return claim_social_intent(p_id,p_version);
end;
$$;

create or replace function public.start_social_intent(p_id uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare saved social_intents;
begin
  select * into saved from social_intents where id=p_id;
  if saved.id is null then return false; end if;
  perform 1 from social_posts where id=saved.post_id for share;
  perform pg_advisory_xact_lock(hashtextextended('social-engine:'||saved.workspace_id::text,0));
  select * into saved from social_intents where id=p_id for update;
  if saved.state<>'running' or saved.lease_id is distinct from p_lease or saved.lease_until<=clock_timestamp() then return false; end if;
  if saved.started_at is not null then return false; end if;
  if coalesce((select paused from social_engine_controls where workspace_id=saved.workspace_id),true) then
    update social_intents set state='retry_wait',version=version+1,lease_id=null,lease_until=null,scheduled_at=clock_timestamp(),
      message='Paused before dispatch.',updated_by=null,updated_at=clock_timestamp() where id=p_id;
    return false;
  end if;
  perform 1 from social_posts p join agency_members m on m.user_id=saved.approved_by join auth.users u on u.id=m.user_id
    where p.id=saved.post_id and p.revision=saved.revision and p.status='draft' and p.review_state='approved'
      and m.active and m.role in ('owner','admin') and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of p,m,u;
  if not found then
    update social_intents set state='blocked',version=version+1,message='Authorization changed before dispatch.',updated_at=clock_timestamp() where id=p_id;
    return false;
  end if;
  if saved.destination<>'test' then
    perform 1 from social_provider_connections c join social_provider_grants g
      on g.id=c.grant_id and g.workspace_id=c.workspace_id
      where c.id=saved.connection_id and c.workspace_id=saved.workspace_id and c.platform=saved.destination
        and c.state='connected' and c.can_publish and c.token_expires_at>clock_timestamp()
        and g.state='connected' and g.encrypted_user_token is not null and g.token_expires_at>clock_timestamp()
        and c.granted_scopes @> case c.platform when 'facebook_page' then array['pages_manage_posts','pages_read_engagement']
          else array['instagram_basic','instagram_content_publish','pages_manage_posts','pages_read_engagement'] end
        and g.granted_scopes @> case c.platform when 'facebook_page' then array['pages_manage_posts','pages_read_engagement']
          else array['instagram_basic','instagram_content_publish','pages_manage_posts','pages_read_engagement'] end
      for share of c,g;
    if not found then
      update social_intents set state='blocked',version=version+1,message='Connected account or Meta authorization changed before dispatch.',
        updated_at=clock_timestamp() where id=p_id;
      return false;
    end if;
    if saved.destination='instagram_business' and not exists(select 1 from social_provider_connections page
      where page.workspace_id=saved.workspace_id and page.grant_id=(select grant_id from social_provider_connections where id=saved.connection_id)
        and page.platform='facebook_page' and page.external_account_id=(select parent_page_id from social_provider_connections where id=saved.connection_id)
        and page.state='connected' and page.can_publish and page.encrypted_page_token is not null
        and page.token_expires_at>clock_timestamp() and page.granted_scopes @> array['pages_manage_posts','pages_read_engagement']) then
      update social_intents set state='blocked',version=version+1,message='Linked Facebook Page authorization changed before Instagram dispatch.',
        updated_at=clock_timestamp() where id=p_id;
      return false;
    end if;
  end if;
  if saved.destination='facebook_page' then
    update social_intents set started_at=clock_timestamp() where id=p_id;
    return true;
  end if;
  if saved.destination='instagram_business' and saved.container_id is not null and saved.publish_dispatched_at is null then
    update social_intents set started_at=clock_timestamp() where id=p_id;
    return true;
  end if;
  update social_intents set started_at=clock_timestamp(),attempt_count=attempt_count+1 where id=p_id;
  insert into social_attempts(lease_id,intent_id,attempt) values(p_lease,p_id,saved.attempt_count+1);
  return true;
end;
$$;

create or replace function public.begin_social_provider_dispatch(p_id uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare saved social_intents; target social_provider_connections;
begin
  select * into saved from social_intents where id=p_id and destination in ('facebook_page','instagram_business')
    and state='running' and lease_id=p_lease and lease_until>clock_timestamp() for update;
  if saved.id is null or saved.publish_dispatched_at is not null then return false; end if;
  if saved.destination='instagram_business' and (saved.container_id is null or saved.container_status<>'processing') then return false; end if;
  if saved.attempt_count>=3 then return false; end if;
  if coalesce((select paused from social_engine_controls where workspace_id=saved.workspace_id),true) then return false; end if;
  perform 1 from social_posts p join agency_members m on m.user_id=saved.approved_by join auth.users u on u.id=m.user_id
    where p.id=saved.post_id and p.workspace_id=saved.workspace_id and p.revision=saved.revision
      and p.status='draft' and p.review_state='approved' and m.active and m.role in ('owner','admin')
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=clock_timestamp())
    for share of p,m,u;
  if not found then return false; end if;
  select c.* into target from social_provider_connections c join social_provider_grants g
    on g.id=c.grant_id and g.workspace_id=c.workspace_id
    where c.id=saved.connection_id and c.workspace_id=saved.workspace_id and c.platform=saved.destination
      and c.state='connected' and c.can_publish and c.token_expires_at>clock_timestamp()
      and g.state='connected' and g.encrypted_user_token is not null and g.token_expires_at>clock_timestamp()
      and c.granted_scopes @> case c.platform when 'facebook_page' then array['pages_manage_posts','pages_read_engagement']
        else array['instagram_basic','instagram_content_publish','pages_manage_posts','pages_read_engagement'] end
      and g.granted_scopes @> case c.platform when 'facebook_page' then array['pages_manage_posts','pages_read_engagement']
      else array['instagram_basic','instagram_content_publish','pages_manage_posts','pages_read_engagement'] end
    for share of c,g;
  if target.id is null then return false; end if;
  if saved.destination='instagram_business' and not exists(select 1 from social_provider_connections page
    where page.workspace_id=saved.workspace_id and page.grant_id=target.grant_id and page.platform='facebook_page'
      and page.external_account_id=target.parent_page_id and page.state='connected' and page.can_publish
      and page.encrypted_page_token is not null and page.token_expires_at>clock_timestamp()
      and page.granted_scopes @> array['pages_manage_posts','pages_read_engagement']) then return false; end if;
  update social_intents set publish_dispatched_at=clock_timestamp(),attempt_count=attempt_count+1 where id=p_id;
  insert into social_attempts(lease_id,intent_id,attempt) values(p_lease,p_id,saved.attempt_count+1)
    on conflict(lease_id) do nothing;
  return true;
end;
$$;

create function public.guard_social_publish_retry() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.destination<>'test' and old.state='published' and new.state<>'published' then
    raise exception 'A published provider result is immutable. Record a separate provider deletion action only if supported.' using errcode='PT409';
  end if;
  if old.destination<>'test' and old.state='confirming' and old.publish_dispatched_at is not null
    and old.remote_id is null and new.state<>'confirming'
    and not (new.state='published' and new.remote_id is not null and new.message like 'Operator confirmed published:%')
    and not (new.state='failed' and new.publish_dispatched_at is null
      and new.message='Operator confirmed no publication in Meta. An explicit retry is available.') then
    raise exception 'Meta acceptance is uncertain. Verify the provider before changing or retrying this intent.' using errcode='PT409';
  end if;
  if old.destination<>'test' and old.publish_dispatched_at is not null and old.remote_id is null
    and old.state<>'running' and new.state in ('scheduled','retry_wait','approved') then
    raise exception 'Meta may have accepted this post. Verify the provider result before any retry.' using errcode='PT409';
  end if;
  return new;
end;
$$;
create trigger social_publish_retry_guard before update of state on public.social_intents
  for each row execute function public.guard_social_publish_retry();

revoke all on function public.prepare_social_publish_intent(uuid,uuid,uuid,integer,uuid),
  public.load_social_publish_context(uuid,uuid),public.record_social_publish_container(uuid,uuid,text),
  public.begin_social_provider_dispatch(uuid,uuid),public.finish_social_publish_intent(uuid,uuid,text,text,text,text),
  public.resolve_social_publish_intent(uuid,uuid,integer,text,text,text),
  public.claim_social_intent_gated(uuid,integer,boolean,boolean),
  public.reconcile_social_engine_gated(boolean,boolean),
  public.guard_social_publish_retry()
  from public,anon,authenticated,service_role;
grant execute on function public.prepare_social_publish_intent(uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function public.resolve_social_publish_intent(uuid,uuid,integer,text,text,text) to service_role;
grant execute on function public.reconcile_social_engine_gated(boolean,boolean) to service_role;
grant execute on function public.load_social_publish_context(uuid,uuid),public.record_social_publish_container(uuid,uuid,text),
  public.begin_social_provider_dispatch(uuid,uuid),public.finish_social_publish_intent(uuid,uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
