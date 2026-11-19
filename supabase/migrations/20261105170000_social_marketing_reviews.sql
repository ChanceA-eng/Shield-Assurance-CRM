begin;
alter table public.social_posts add column review_state text not null default 'not_submitted'
  check (review_state in ('not_submitted','awaiting_review','approved','changes_requested'));
alter table public.social_posts add column review_version integer not null default 0 check(review_version>=0);
create table public.social_review_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  post_id uuid not null,
  revision integer not null,
  review_version integer not null,
  action text not null check(action in ('submit','withdraw','approve','request_changes','invalidated')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text not null default '' check(char_length(reason)<=1000),
  recorded_at timestamptz not null default now(),
  unique(post_id,review_version),
  foreign key(workspace_id,post_id) references public.social_posts(workspace_id,id) on delete restrict,
  foreign key(post_id,revision) references public.social_post_revisions(post_id,revision) on delete restrict
);
alter table public.social_review_events enable row level security;
revoke all on public.social_review_events from public,anon,authenticated,service_role;
grant select on public.social_review_events to service_role;

create function public.invalidate_social_review()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.revision<>old.revision and old.review_state<>'not_submitted' then
    new.review_state:='not_submitted';
    new.review_version:=old.review_version+1;
    insert into social_review_events(workspace_id,post_id,revision,review_version,action,actor_id,reason)
      values(old.workspace_id,old.id,old.revision,new.review_version,'invalidated',new.updated_by,
        case when new.status='archived' then 'Post archived.' else 'Content changed. Submit the new revision for review.' end);
  end if;
  return new;
end;
$$;
create trigger social_review_content_change before update on public.social_posts
  for each row execute function public.invalidate_social_review();
revoke all on function public.invalidate_social_review() from public,anon,authenticated,service_role;

create function public.review_social_draft(p_actor uuid,p_id uuid,p_action text,p_expected_revision integer,
  p_expected_review_version integer,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_posts; next_state text;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  if p_action is null or p_action not in ('submit','withdraw','approve','request_changes')
    or p_expected_revision is null or p_expected_revision<1
    or p_expected_review_version is null or p_expected_review_version<0 or p_expected_review_version>=2147483647
    or p_reason is null or char_length(btrim(p_reason))>1000 then
    raise exception 'Choose a valid review action and version.' using errcode='22023';
  end if;
  if p_action in ('approve','request_changes') then
    perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;
    if not found then raise exception 'Only active owners and administrators can review social posts.' using errcode='42501'; end if;
  end if;
  if p_action='request_changes' and btrim(p_reason)='' then
    raise exception 'Explain which changes are needed.' using errcode='22023';
  end if;
  if p_action in ('submit','withdraw') and p_reason<>'' then
    raise exception 'This review action does not accept a reason.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social-draft:'||p_id::text,0));
  select * into saved from social_posts where id=p_id and workspace_id=workspace for update;
  if saved.id is null then raise exception 'This draft was not found.' using errcode='P0002'; end if;
  if saved.revision<>p_expected_revision or saved.review_version<>p_expected_review_version then
    raise exception 'This post or its review changed. Reload before reviewing.' using errcode='PT409';
  end if;
  if saved.status<>'draft' then raise exception 'Archived posts cannot be reviewed.' using errcode='22023'; end if;
  if p_action='submit' then
    if saved.review_state not in ('not_submitted','changes_requested') then
      raise exception 'This revision is already submitted or approved.' using errcode='22023';
    end if;
    if btrim(saved.caption)='' then raise exception 'Write a caption before requesting review.' using errcode='22023'; end if;
    next_state:='awaiting_review';
  else
    if saved.review_state<>'awaiting_review' then raise exception 'This revision is not awaiting review.' using errcode='22023'; end if;
    next_state:=case p_action when 'withdraw' then 'not_submitted' when 'approve' then 'approved' else 'changes_requested' end;
  end if;
  update social_posts set review_state=next_state,review_version=review_version+1,
    updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into saved;
  insert into social_review_events(workspace_id,post_id,revision,review_version,action,actor_id,reason)
    values(workspace,p_id,saved.revision,saved.review_version,p_action,p_actor,btrim(p_reason));
  return to_jsonb(saved);
end;
$$;
revoke all on function public.review_social_draft(uuid,uuid,text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.review_social_draft(uuid,uuid,text,integer,integer,text) to service_role;

alter function public.list_social_drafts(uuid,text,integer,uuid) rename to list_social_drafts_content;
revoke all on function public.list_social_drafts_content(uuid,text,integer,uuid) from public,anon,authenticated,service_role;
create function public.list_social_drafts(p_actor uuid,p_status text default 'draft',p_offset integer default 0,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; result jsonb; total bigint; rows jsonb; can_review boolean;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  select exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin')) into can_review;
  if p_status in ('awaiting_review','approved','changes_requested') and p_id is null then
    if p_offset is null or p_offset<0 then raise exception 'Choose a valid draft offset.' using errcode='22023'; end if;
    select count(*) into total from social_posts where workspace_id=workspace and status='draft' and review_state=p_status;
    select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id),'[]'::jsonb) into rows from
      (select * from social_posts where workspace_id=workspace and status='draft' and review_state=p_status
        order by updated_at desc,id limit 50 offset p_offset) p;
    result:=jsonb_build_object('posts',rows,'total',total);
  else
    result:=list_social_drafts_content(p_actor,case when p_id is not null then 'draft' else p_status end,p_offset,p_id);
  end if;
  if p_id is not null then
    result:=result||jsonb_build_object('reviews',coalesce((
      select jsonb_agg(to_jsonb(e) order by e.review_version desc) from
        (select revision,review_version,action,actor_id,reason,recorded_at from social_review_events
          where workspace_id=workspace and post_id=p_id order by review_version desc limit 50) e),'[]'::jsonb));
  end if;
  return result||jsonb_build_object('can_review',can_review);
end;
$$;
revoke all on function public.list_social_drafts(uuid,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_social_drafts(uuid,text,integer,uuid) to service_role;
notify pgrst,'reload schema';
commit;
