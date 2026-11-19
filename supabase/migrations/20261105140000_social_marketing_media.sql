begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('social-marketing-media','social-marketing-media',false,4194304,array['image/jpeg'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.social_media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.social_marketing_workspaces(id) on delete restrict,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 180),
  alt_text text not null check (char_length(btrim(alt_text)) between 1 and 1000),
  rights_reference text not null check (char_length(btrim(rights_reference)) between 1 and 1000),
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  width integer,
  height integer,
  byte_size integer,
  error_message text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '5 minutes',
  unique (workspace_id,id),
  check (status<>'ready' or (width between 1 and 4096 and height between 1 and 4096 and byte_size between 1 and 4194304)),
  check (status<>'failed' or char_length(error_message) between 1 and 500)
);
create index social_media_workspace_created on public.social_media_assets(workspace_id,created_at desc,id);
alter table public.social_media_assets enable row level security;
revoke all on public.social_media_assets from public,anon,authenticated,service_role;
grant select on public.social_media_assets to service_role;
create policy social_media_private on storage.objects as restrictive for all to authenticated
  using(bucket_id<>'social-marketing-media') with check(bucket_id<>'social-marketing-media');

alter table public.social_posts add column media_ids uuid[] not null default '{}' check (cardinality(media_ids)<=1);
alter table public.social_post_revisions add column media_ids uuid[] not null default '{}' check (cardinality(media_ids)<=1);
create table public.social_revision_media (
  workspace_id uuid not null,
  post_id uuid not null,
  revision integer not null,
  media_id uuid not null,
  primary key(post_id,revision,media_id),
  foreign key(post_id,revision) references public.social_post_revisions(post_id,revision) on delete restrict,
  foreign key(workspace_id,post_id) references public.social_posts(workspace_id,id) on delete restrict,
  foreign key(workspace_id,media_id) references public.social_media_assets(workspace_id,id) on delete restrict
);
alter table public.social_revision_media enable row level security;
revoke all on public.social_revision_media from public,anon,authenticated,service_role;
grant select on public.social_revision_media to service_role;

create function public.reserve_social_media(p_actor uuid,p_file_name text,p_alt_text text,p_rights_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_media_assets;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  if p_file_name is null or char_length(btrim(p_file_name)) not between 1 and 180
    or p_alt_text is null or char_length(btrim(p_alt_text)) not between 1 and 1000
    or p_rights_reference is null or char_length(btrim(p_rights_reference)) not between 1 and 1000 then
    raise exception 'Enter a file name, alt text, and usage rights/source.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social-media:'||workspace::text,0));
  update social_media_assets set status='failed',error_message='Upload expired. Upload the image again.'
    where workspace_id=workspace and status='processing' and expires_at<now();
  if (select count(*) from social_media_assets where workspace_id=workspace and status='processing')>=2 then
    raise exception 'Two images are already processing. Wait before uploading another.' using errcode='PT429';
  end if;
  if (select coalesce(sum(case when status='ready' then byte_size+102400 else 4296704 end),0)
    from social_media_assets where workspace_id=workspace and status in ('ready','processing'))+4296704>262144000 then
    raise exception 'The 250 MB image-library limit has been reached. Contact the CRM owner.' using errcode='22023';
  end if;
  insert into social_media_assets(workspace_id,file_name,alt_text,rights_reference,created_by)
    values(workspace,btrim(p_file_name),btrim(p_alt_text),btrim(p_rights_reference),p_actor) returning * into saved;
  return to_jsonb(saved)-'expires_at';
end;
$$;

create function public.complete_social_media(p_actor uuid,p_id uuid,p_width integer,p_height integer,p_bytes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_media_assets;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  select * into saved from social_media_assets where workspace_id=workspace and id=p_id for update;
  if saved.id is null or saved.created_by<>p_actor then raise exception 'This upload was not found.' using errcode='P0002'; end if;
  if saved.status<>'processing' or saved.expires_at<now() then raise exception 'Upload expired. Upload the image again.' using errcode='22023'; end if;
  if p_width is null or p_height is null or p_bytes is null or p_width not between 1 and 4096
    or p_height not between 1 and 4096 or p_bytes not between 1 and 4194304 then
    raise exception 'The processed image is invalid.' using errcode='22023';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='social-marketing-media'
    and name=workspace::text||'/'||p_id::text||'/image.jpg')
    or not exists(select 1 from storage.objects where bucket_id='social-marketing-media'
    and name=workspace::text||'/'||p_id::text||'/thumbnail.jpg') then
    raise exception 'Image storage is incomplete. Upload again.' using errcode='22023';
  end if;
  update social_media_assets set status='ready',width=p_width,height=p_height,byte_size=p_bytes
    where id=p_id returning * into saved;
  return to_jsonb(saved)-'expires_at';
end;
$$;

create function public.fail_social_media(p_actor uuid,p_id uuid,p_message text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_message is null or char_length(p_message) not between 1 and 500 then
    raise exception 'A valid upload failure message is required.' using errcode='22023';
  end if;
  -- Cleanup must still work after the uploader's membership has been revoked.
  update social_media_assets set status='failed',error_message=p_message
    where id=p_id and created_by=p_actor and status in ('processing','failed');
  if not found then raise exception 'This unfinished upload was not found.' using errcode='P0002'; end if;
end;
$$;

create function public.list_social_media(p_actor uuid,p_offset integer default 0,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; result jsonb; total bigint;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  if p_offset is null or p_offset<0 then raise exception 'Choose a valid media offset.' using errcode='22023'; end if;
  if p_id is not null then
    select to_jsonb(m)-'expires_at' into result from social_media_assets m where id=p_id and workspace_id=workspace;
    if result is null then raise exception 'This image was not found.' using errcode='P0002'; end if;
    return result;
  end if;
  select count(*) into total from social_media_assets where workspace_id=workspace;
  select coalesce(jsonb_agg(to_jsonb(m)-'expires_at' order by m.created_at desc,m.id),'[]'::jsonb) into result from
    (select * from social_media_assets where workspace_id=workspace order by created_at desc,id limit 24 offset p_offset) m;
  return jsonb_build_object('assets',result,'total',total);
end;
$$;

create or replace function public.list_social_drafts(p_actor uuid,p_status text default 'draft',p_offset integer default 0,p_id uuid default null)
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
        (select revision,title,caption,media_ids,action,actor_id,recorded_at from social_post_revisions
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

drop function public.save_social_draft(uuid,uuid,text,text,text,integer);
create function public.save_social_draft(p_actor uuid,p_id uuid,p_action text,p_title text default null,
  p_caption text default null,p_expected_revision integer default null,p_media_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_posts; audit_action text; chosen uuid[];
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
  if p_action='archive' and (p_title is not null or p_caption is not null or p_media_ids is not null) then
    raise exception 'Archiving cannot change draft content.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social-draft:'||p_id::text,0));
  select * into saved from social_posts where id=p_id and workspace_id=workspace for update;
  chosen:=coalesce(p_media_ids,saved.media_ids,'{}'::uuid[]);
  if cardinality(chosen)>1 or array_position(chosen,null) is not null
    or (cardinality(chosen)>0 and coalesce(array_ndims(chosen),1)<>1) then
    raise exception 'Choose at most one ready image.' using errcode='22023';
  end if;
  perform 1 from social_media_assets where id=any(chosen) and workspace_id=workspace and status='ready' for share;
  if (select count(*) from social_media_assets where id=any(chosen) and workspace_id=workspace and status='ready')<>cardinality(chosen) then
    raise exception 'Choose a ready image from this marketing library.' using errcode='22023';
  end if;
  if p_action='create' then
    if saved.id is not null then
      if saved.created_by=p_actor and saved.revision=1 and saved.status='draft'
        and saved.title=btrim(p_title) and saved.caption=p_caption and saved.media_ids=chosen then return to_jsonb(saved); end if;
      raise exception 'This draft already exists. Reload before saving.' using errcode='PT409';
    end if;
    insert into social_posts(id,workspace_id,title,caption,media_ids,created_by,updated_by)
      values(p_id,workspace,btrim(p_title),p_caption,chosen,p_actor,p_actor) returning * into saved;
    audit_action:='created';
  else
    if saved.id is null then raise exception 'This draft was not found.' using errcode='P0002'; end if;
    if saved.revision<>p_expected_revision then
      raise exception 'Someone else changed this draft. Reload before saving.' using errcode='PT409';
    end if;
    if saved.status<>'draft' then raise exception 'Archived drafts cannot be changed.' using errcode='22023'; end if;
    if p_action='update' and saved.title=btrim(p_title) and saved.caption=p_caption and saved.media_ids=chosen then return to_jsonb(saved); end if;
    update social_posts set
      title=case when p_action='update' then btrim(p_title) else title end,
      caption=case when p_action='update' then p_caption else caption end,
      media_ids=chosen,
      status=case when p_action='archive' then 'archived' else status end,
      revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
      where id=p_id and workspace_id=workspace returning * into saved;
    audit_action:=case when p_action='archive' then 'archived' else 'edited' end;
  end if;
  insert into social_post_revisions(workspace_id,post_id,revision,title,caption,media_ids,action,actor_id)
    values(workspace,saved.id,saved.revision,saved.title,saved.caption,saved.media_ids,audit_action,p_actor);
  insert into social_revision_media(workspace_id,post_id,revision,media_id)
    select workspace,saved.id,saved.revision,unnest(saved.media_ids);
  return to_jsonb(saved);
end;
$$;

revoke all on function public.reserve_social_media(uuid,text,text,text),public.complete_social_media(uuid,uuid,integer,integer,integer),
  public.fail_social_media(uuid,uuid,text),public.list_social_media(uuid,integer,uuid),
  public.save_social_draft(uuid,uuid,text,text,text,integer,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.reserve_social_media(uuid,text,text,text),public.complete_social_media(uuid,uuid,integer,integer,integer),
  public.fail_social_media(uuid,uuid,text),public.list_social_media(uuid,integer,uuid),
  public.save_social_draft(uuid,uuid,text,text,text,integer,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
