begin;
create table public.social_engine_controls (
  workspace_id uuid primary key references public.social_marketing_workspaces(id),
  paused boolean not null default true,
  updated_by uuid references auth.users(id),
  worker_seen_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.social_intents (
  id uuid primary key,
  workspace_id uuid not null,
  post_id uuid not null,
  revision integer not null,
  destination text not null default 'test' check(destination='test'),
  scenario text not null check(scenario in ('success','retry_once','permanent_failure','uncertain')),
  state text not null default 'awaiting_approval' check(state in ('awaiting_approval','approved','scheduled','running','retry_wait','confirming','simulated','failed','canceled','blocked')),
  version integer not null default 1 check(version>0),
  scheduled_at timestamptz,
  timezone text not null default 'America/Phoenix' check(timezone='America/Phoenix'),
  attempt_count integer not null default 0 check(attempt_count between 0 and 3),
  lease_id uuid,
  lease_until timestamptz,
  started_at timestamptz,
  approved_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  message text not null default '',
  receipt_id text,
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,post_id) references public.social_posts(workspace_id,id),
  foreign key(post_id,revision) references public.social_post_revisions(post_id,revision)
);
create index social_intents_due on public.social_intents(state,scheduled_at);
create table public.social_intent_events (
  id bigint generated always as identity primary key,
  intent_id uuid not null references public.social_intents(id),
  version integer not null,
  state text not null,
  actor_id uuid references auth.users(id),
  message text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create table public.social_attempts (
  lease_id uuid primary key,
  intent_id uuid not null references public.social_intents(id),
  attempt integer not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  outcome text,
  unique(intent_id,attempt)
);
create table public.social_test_receipts (
  intent_id uuid primary key references public.social_intents(id),
  receipt_id text not null unique,
  accepted_at timestamptz not null default clock_timestamp()
);
create table public.social_outbox (
  intent_id uuid primary key references public.social_intents(id),
  version integer not null,
  due_at timestamptz not null
);
alter table public.social_engine_controls enable row level security;
alter table public.social_intents enable row level security;
alter table public.social_intent_events enable row level security;
alter table public.social_attempts enable row level security;
alter table public.social_test_receipts enable row level security;
alter table public.social_outbox enable row level security;
revoke all on public.social_engine_controls,public.social_intents,public.social_intent_events,public.social_attempts,public.social_test_receipts,public.social_outbox from public,anon,authenticated,service_role;
grant select on public.social_engine_controls,public.social_intents,public.social_intent_events,public.social_attempts,public.social_outbox to service_role;

create function public.social_engine_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' or new.version<>old.version then
    insert into social_intent_events(intent_id,version,state,actor_id,message)
      values(new.id,new.version,new.state,case when tg_op='INSERT' then new.created_by else new.updated_by end,new.message);
  end if;
  if new.state in ('scheduled','retry_wait','confirming') and not (new.state='confirming' and new.scenario='uncertain') then
    insert into social_outbox(intent_id,version,due_at) values(new.id,new.version,coalesce(new.scheduled_at,now()))
      on conflict(intent_id) do update set version=excluded.version,due_at=excluded.due_at;
  else delete from social_outbox where intent_id=new.id; end if;
  return new;
end;
$$;
create trigger social_engine_intent_audit after insert or update on public.social_intents for each row execute function public.social_engine_audit();

create function public.list_social_engine(p_actor uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  return jsonb_build_object('paused',coalesce((select paused from social_engine_controls where workspace_id=workspace),true),
    'worker_seen_at',(select worker_seen_at from social_engine_controls where workspace_id=workspace),
    'can_manage',exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin')),
    'intents',coalesce((select jsonb_agg((to_jsonb(i)-'lease_id'-'lease_until'-'started_at') || jsonb_build_object(
      'title',(select title from social_post_revisions where post_id=i.post_id and revision=i.revision),
      'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.version desc) from
        (select version,state,actor_id,message,recorded_at from social_intent_events where intent_id=i.id order by version desc limit 10) e),'[]'::jsonb),
      'attempts',coalesce((select jsonb_agg(to_jsonb(a) order by a.attempt) from
        (select attempt,started_at,finished_at,outcome from social_attempts where intent_id=i.id) a),'[]'::jsonb))
      order by i.updated_at desc,i.id) from
      (select * from social_intents where workspace_id=workspace order by updated_at desc,id limit 200) i),'[]'::jsonb));
end;
$$;

create function public.command_social_engine(p_actor uuid,p_command jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_intents; post social_posts; action text:=p_command->>'action'; due timestamptz; target_id uuid;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  if action is null or action not in ('prepare','approve','schedule','cancel','retry','confirm','pause') then
    raise exception 'Choose a supported scheduling action.' using errcode='22023'; end if;
  if action in ('approve','schedule','retry','confirm','pause') then
    perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
    if not found then raise exception 'An active owner or administrator must manage test execution.' using errcode='42501'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social-engine:'||workspace::text,0));
  if action='pause' then
    if jsonb_typeof(p_command->'paused')<>'boolean' or not p_command ? 'paused' then raise exception 'Choose pause or resume.' using errcode='22023'; end if;
    insert into social_engine_controls(workspace_id,paused,updated_by) values(workspace,(p_command->>'paused')::boolean,p_actor)
      on conflict(workspace_id) do update set paused=excluded.paused,updated_by=p_actor,updated_at=clock_timestamp();
    return list_social_engine(p_actor);
  end if;
  target_id:=(p_command->>'id')::uuid;
  if target_id is null then raise exception 'Choose a valid test intent.' using errcode='22023'; end if;
  if action='prepare' then
    if p_command->>'scenario' is null or p_command->>'scenario' not in ('success','retry_once','permanent_failure','uncertain') then
      raise exception 'Choose a supported test scenario.' using errcode='22023'; end if;
    select * into post from social_posts where id=(p_command->>'post_id')::uuid and workspace_id=workspace for share;
    if post.id is null then raise exception 'Post not found.' using errcode='P0002'; end if;
    if (p_command->>'revision') is null or post.status<>'draft' or post.revision<>(p_command->>'revision')::integer or post.review_state<>'approved' then
      raise exception 'Approve the current saved content before preparing a destination.' using errcode='PT409'; end if;
    select * into saved from social_intents where id=target_id;
    if saved.id is not null then
      if saved.workspace_id=workspace and saved.post_id=post.id and saved.revision=post.revision and saved.scenario=p_command->>'scenario' and saved.created_by=p_actor then return to_jsonb(saved)-'lease_id'-'lease_until'-'started_at'; end if;
      raise exception 'This test intent already exists.' using errcode='PT409';
    end if;
    insert into social_intents(id,workspace_id,post_id,revision,scenario,created_by,message)
      values(target_id,workspace,post.id,post.revision,p_command->>'scenario',p_actor,'Test destination selected. Destination approval required.') returning * into saved;
  else
    select * into saved from social_intents where id=target_id and workspace_id=workspace;
    if saved.id is null then raise exception 'Test intent not found.' using errcode='P0002'; end if;
    select * into post from social_posts where id=saved.post_id for share;
    select * into saved from social_intents where id=target_id and workspace_id=workspace for update;
    if (p_command->>'expected_version') is null or saved.version<>(p_command->>'expected_version')::integer then
      raise exception 'This intent changed. Reload before continuing.' using errcode='PT409'; end if;
    if action not in ('cancel','confirm') and (post.status<>'draft' or post.revision<>saved.revision or post.review_state<>'approved') then
      raise exception 'Content approval is no longer current. Prepare a new approved revision.' using errcode='PT409'; end if;
    if action='approve' then
      if saved.state<>'awaiting_approval' then raise exception 'This destination is not awaiting approval.' using errcode='PT409'; end if;
      update social_intents set state='approved',approved_by=p_actor,message='Exact revision and test destination approved.' where id=target_id;
    elsif action='schedule' then
      if saved.state not in ('approved','scheduled','retry_wait') or p_command->>'timezone' is distinct from 'America/Phoenix' then
        raise exception 'Choose an approved intent and an Arizona schedule.' using errcode='22023'; end if;
      due:=(p_command->>'scheduled_at')::timestamptz;
      if due is null or not isfinite(due) or due<clock_timestamp()-interval '1 minute' or due>clock_timestamp()+interval '1 year' then
        raise exception 'Choose a schedule between now and one year ahead.' using errcode='22023'; end if;
      update social_intents set state='scheduled',scheduled_at=due,message='Test run scheduled. No social network will be contacted.' where id=target_id;
    elsif action='cancel' then
      if saved.state in ('running','confirming','simulated') then
        raise exception 'Execution may already have been accepted. Resolve its outcome instead of canceling.' using errcode='PT409'; end if;
      if saved.state='canceled' then return to_jsonb(saved)-'lease_id'-'lease_until'-'started_at'; end if;
      update social_intents set state='canceled',message='Test run canceled.' where id=target_id;
    elsif action='retry' then
      if saved.state<>'failed' or saved.attempt_count>=3 or exists(select 1 from social_test_receipts where intent_id=saved.id) then
        raise exception 'This intent cannot safely retry. Prepare a new intent after reviewing the failure.' using errcode='PT409'; end if;
      update social_intents set state='scheduled',scheduled_at=clock_timestamp(),message='Explicit test retry requested.' where id=target_id;
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

create function public.invalidate_social_intents() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.revision<>old.revision or new.review_state<>'approved' then
    update social_intents set state='blocked',version=version+1,message='Content changed or approval withdrawn. Prepare a new approved revision.',
      updated_by=new.updated_by,updated_at=clock_timestamp() where post_id=new.id and state in ('awaiting_approval','approved','scheduled','retry_wait');
  end if;
  return new;
end;
$$;
create trigger social_engine_content_change after update on public.social_posts for each row execute function public.invalidate_social_intents();

create function public.reconcile_social_engine() returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update social_engine_controls set worker_seen_at=clock_timestamp();
  update social_attempts a set finished_at=clock_timestamp(),outcome='lease_expired'
    from social_intents i where i.state='running' and i.lease_until<clock_timestamp() and a.lease_id=i.lease_id and a.finished_at is null;
  update social_intents set state=case when started_at is null then 'retry_wait' else 'confirming' end,
    version=version+1,scheduled_at=clock_timestamp(),lease_id=null,lease_until=null,
    message=case when started_at is null then 'Worker lease expired before execution. Safe retry queued.' else 'Worker lease expired after dispatch. Confirming acceptance before any retry.' end,
    updated_by=null,updated_at=clock_timestamp()
    where state='running' and lease_until<clock_timestamp();
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.intent_id,'version',o.version)) from
    (select o.* from social_outbox o left join social_engine_controls c on c.workspace_id=(select workspace_id from social_intents where id=o.intent_id)
      where o.due_at<=clock_timestamp() and not coalesce(c.paused,true) order by o.due_at,o.intent_id limit 50) o),'[]'::jsonb);
end;
$$;

create function public.claim_social_intent(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare saved social_intents; post social_posts; reviewer uuid;
begin
  select * into saved from social_intents where id=p_id;
  if saved.id is null then return null; end if;
  select * into post from social_posts where id=saved.post_id for share;
  perform pg_advisory_xact_lock(hashtextextended('social-engine:'||saved.workspace_id::text,0));
  select * into saved from social_intents where id=p_id for update;
  if p_version is null or saved.version<>p_version or saved.state not in ('scheduled','retry_wait','confirming') or saved.scheduled_at>clock_timestamp()
    or coalesce((select paused from social_engine_controls where workspace_id=saved.workspace_id),true) then return null; end if;
  if saved.state='confirming' then
    if saved.scenario='uncertain' then return null; end if;
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
  if saved.attempt_count>=3 then
    update social_intents set state='failed',version=version+1,message='Test retry budget exhausted.',updated_at=clock_timestamp() where id=p_id;
    return null;
  end if;
  update social_intents set state='running',version=version+1,
    lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',started_at=null,
    message='Test worker claimed execution.',updated_by=null,updated_at=clock_timestamp() where id=p_id returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.start_social_intent(p_id uuid,p_lease uuid) returns boolean language plpgsql security definer set search_path=public as $$
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
    update social_intents set state='retry_wait',version=version+1,lease_id=null,lease_until=null,scheduled_at=clock_timestamp(),message='Paused before dispatch.',updated_by=null,updated_at=clock_timestamp() where id=p_id;
    return false;
  end if;
  perform 1 from social_posts p join agency_members m on m.user_id=saved.approved_by join auth.users u on u.id=m.user_id
    where p.id=saved.post_id and p.revision=saved.revision and p.status='draft' and p.review_state='approved'
      and m.active and m.role in ('owner','admin') and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=clock_timestamp())
    for share of p,m,u;
  if not found then
    update social_intents set state='blocked',version=version+1,message='Authorization changed before dispatch.',updated_at=clock_timestamp() where id=p_id;
    return false;
  end if;
  update social_intents set started_at=clock_timestamp(),attempt_count=attempt_count+1 where id=p_id;
  insert into social_attempts(lease_id,intent_id,attempt) values(p_lease,p_id,saved.attempt_count+1);
  return true;
end;
$$;

create function public.execute_social_test(p_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare saved social_intents; receipt text;
begin
  select * into saved from social_intents where id=p_id for update;
  if saved.id is null or saved.state<>'running' or saved.lease_id is distinct from p_lease or saved.lease_until<=clock_timestamp() or saved.started_at is null then
    raise exception 'Test execution lease is no longer valid.' using errcode='PT409'; end if;
  if saved.scenario='retry_once' and saved.attempt_count=1 then return jsonb_build_object('outcome','retry'); end if;
  if saved.scenario='permanent_failure' then return jsonb_build_object('outcome','failed'); end if;
  receipt:='test-'||p_id::text;
  insert into social_test_receipts(intent_id,receipt_id) values(p_id,receipt) on conflict(intent_id) do nothing;
  return jsonb_build_object('outcome',case when saved.scenario='uncertain' then 'uncertain' else 'accepted' end,'receipt_id',receipt);
end;
$$;

create function public.finish_social_intent(p_id uuid,p_lease uuid,p_outcome text) returns boolean language plpgsql security definer set search_path=public as $$
declare saved social_intents;
begin
  if p_outcome is null or p_outcome not in ('retry','failed','uncertain','accepted') then raise exception 'Unknown test result.' using errcode='22023'; end if;
  select * into saved from social_intents where id=p_id for update;
  if saved.id is null or saved.started_at is null or saved.state<>'running' or saved.lease_id is distinct from p_lease or saved.lease_until<=clock_timestamp() then return false; end if;
  if p_outcome in ('accepted','uncertain') and not exists(select 1 from social_test_receipts where intent_id=p_id) then
    raise exception 'Test acceptance receipt is missing.' using errcode='PT409'; end if;
  if p_outcome in ('retry','failed') and exists(select 1 from social_test_receipts where intent_id=p_id) then
    raise exception 'Accepted test execution must be confirmed, not retried.' using errcode='PT409'; end if;
  update social_attempts set finished_at=clock_timestamp(),outcome=p_outcome where lease_id=p_lease;
  update social_intents set state=case p_outcome when 'accepted' then 'simulated' when 'uncertain' then 'confirming'
      when 'retry' then case when attempt_count<3 then 'retry_wait' else 'failed' end else 'failed' end,
    version=version+1,lease_id=null,lease_until=null,scheduled_at=case when p_outcome='retry' then clock_timestamp()+make_interval(secs=>30*power(2,attempt_count-1)::integer+floor(random()*5)::integer) else scheduled_at end,
    receipt_id=case when p_outcome='accepted' then (select receipt_id from social_test_receipts where intent_id=p_id) else null end,
    message=case p_outcome when 'accepted' then 'Test completed. Nothing was published.' when 'uncertain' then 'Test acceptance is uncertain. Confirm the receipt; do not blindly retry.'
      when 'retry' then 'Temporary test failure. Bounded retry queued.' else 'Test destination rejected the intent. Review before retrying.' end,
    updated_at=clock_timestamp() where id=p_id;
  return true;
end;
$$;
revoke all on function public.social_engine_audit(),public.invalidate_social_intents(),
  public.list_social_engine(uuid),public.command_social_engine(uuid,jsonb),public.reconcile_social_engine(),
  public.claim_social_intent(uuid,integer),public.start_social_intent(uuid,uuid),public.execute_social_test(uuid,uuid),
  public.finish_social_intent(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.list_social_engine(uuid),public.command_social_engine(uuid,jsonb) to service_role;
-- Execution RPCs are intentionally database-worker-only; web service_role cannot dispatch work.
notify pgrst,'reload schema';
commit;
