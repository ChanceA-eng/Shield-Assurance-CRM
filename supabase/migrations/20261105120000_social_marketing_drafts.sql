begin;

create table public.social_marketing_workspaces (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  created_at timestamptz not null default now()
);
insert into public.social_marketing_workspaces(singleton) values (true);

create table public.social_posts (
  id uuid primary key,
  workspace_id uuid not null references public.social_marketing_workspaces(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  caption text not null default '' check (char_length(caption) <= 10000),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'draft' check (status in ('draft','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id)
);
create index social_posts_status_updated on public.social_posts(workspace_id,status,updated_at desc,id);

create table public.social_post_revisions (
  workspace_id uuid not null,
  post_id uuid not null,
  revision integer not null check (revision > 0),
  title text not null,
  caption text not null,
  action text not null check (action in ('created','edited','archived')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  primary key (post_id,revision),
  foreign key (workspace_id,post_id) references public.social_posts(workspace_id,id) on delete restrict
);

alter table public.social_marketing_workspaces enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_revisions enable row level security;
revoke all on public.social_marketing_workspaces,public.social_posts,public.social_post_revisions from public,anon,authenticated,service_role;
grant select on public.social_marketing_workspaces,public.social_posts,public.social_post_revisions to service_role;

create function public.social_marketing_workspace_for(p_actor uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare workspace uuid;
begin
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null
    and (banned_until is null or banned_until<=now())) then
    raise exception 'A confirmed CRM session is required.' using errcode='42501';
  end if;
  if exists(select 1 from agency_members) then
    perform 1 from agency_members where user_id=p_actor and active for share;
    if not found then raise exception 'Active agency membership is required.' using errcode='42501'; end if;
  end if;
  select id into workspace from social_marketing_workspaces where singleton;
  if workspace is null then raise exception 'The marketing workspace is not configured.' using errcode='P0002'; end if;
  return workspace;
end;
$$;

create function public.list_social_drafts(p_actor uuid,p_status text default 'draft',p_offset integer default 0,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; result jsonb; total bigint;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  if p_status is null or p_status not in ('draft','archived') or p_offset is null or p_offset<0 then
    raise exception 'Choose a valid draft filter.' using errcode='22023';
  end if;
  if p_id is not null then
    select to_jsonb(p) into result from social_posts p where p.id=p_id and p.workspace_id=workspace;
    if result is null then raise exception 'This draft was not found.' using errcode='P0002'; end if;
    return jsonb_build_object('post',result,'history',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.revision desc) from
        (select revision,title,caption,action,actor_id,recorded_at from social_post_revisions
          where post_id=p_id and workspace_id=workspace order by revision desc limit 50) r
    ),'[]'::jsonb));
  end if;
  select count(*) into total from social_posts where workspace_id=workspace and status=p_status;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id),'[]'::jsonb) into result from
    (select * from social_posts where workspace_id=workspace and status=p_status
      order by updated_at desc,id limit 50 offset p_offset) p;
  return jsonb_build_object('posts',result,'total',total);
end;
$$;

create function public.save_social_draft(p_actor uuid,p_id uuid,p_action text,p_title text default null,
  p_caption text default null,p_expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_posts; audit_action text;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  if p_id is null or p_action is null or p_action not in ('create','update','archive') then
    raise exception 'Choose a valid draft action.' using errcode='22023';
  end if;
  if p_action in ('create','update') and (p_title is null or char_length(btrim(p_title)) not between 1 and 160
    or p_caption is null or char_length(p_caption)>10000) then
    raise exception 'Enter a valid title and caption.' using errcode='22023';
  end if;
  if p_action='create' and p_expected_revision is not null then
    raise exception 'A new draft cannot include a revision.' using errcode='22023';
  end if;
  if p_action<>'create' and (p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=2147483647) then
    raise exception 'A valid draft revision is required.' using errcode='22023';
  end if;
  if p_action='archive' and (p_title is not null or p_caption is not null) then
    raise exception 'Archiving cannot change draft content.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social-draft:'||p_id::text,0));
  select * into saved from social_posts where id=p_id and workspace_id=workspace for update;
  if p_action='create' then
    if saved.id is not null then
      if saved.created_by=p_actor and saved.revision=1 and saved.status='draft'
        and saved.title=btrim(p_title) and saved.caption=p_caption then return to_jsonb(saved); end if;
      raise exception 'This draft already exists. Reload before saving.' using errcode='PT409';
    end if;
    insert into social_posts(id,workspace_id,title,caption,created_by,updated_by)
      values(p_id,workspace,btrim(p_title),p_caption,p_actor,p_actor) returning * into saved;
    audit_action:='created';
  else
    if saved.id is null then raise exception 'This draft was not found.' using errcode='P0002'; end if;
    if saved.revision<>p_expected_revision then
      raise exception 'Someone else changed this draft. Reload before saving.' using errcode='PT409';
    end if;
    if saved.status<>'draft' then raise exception 'Archived drafts cannot be changed.' using errcode='22023'; end if;
    if p_action='update' and saved.title=btrim(p_title) and saved.caption=p_caption then return to_jsonb(saved); end if;
    update social_posts set
      title=case when p_action='update' then btrim(p_title) else title end,
      caption=case when p_action='update' then p_caption else caption end,
      status=case when p_action='archive' then 'archived' else status end,
      revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
      where id=p_id and workspace_id=workspace returning * into saved;
    audit_action:=case when p_action='archive' then 'archived' else 'edited' end;
  end if;
  insert into social_post_revisions(workspace_id,post_id,revision,title,caption,action,actor_id)
    values(workspace,saved.id,saved.revision,saved.title,saved.caption,audit_action,p_actor);
  return to_jsonb(saved);
end;
$$;

revoke all on function public.social_marketing_workspace_for(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_social_drafts(uuid,text,integer,uuid),
  public.save_social_draft(uuid,uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_social_drafts(uuid,text,integer,uuid),
  public.save_social_draft(uuid,uuid,text,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
