begin;

alter table public.social_posts add column link_url text
  check (link_url is null or (char_length(link_url)<=2048 and link_url ~ '^https://[^/@?#]+([/?#]|$)'));
alter table public.social_post_revisions add column link_url text
  check (link_url is null or (char_length(link_url)<=2048 and link_url ~ '^https://[^/@?#]+([/?#]|$)'));

create or replace function public.list_social_drafts(p_actor uuid,p_status text default 'draft',p_offset integer default 0,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; result jsonb; total bigint; rows jsonb; can_review boolean;
begin
  workspace:=social_marketing_workspace_for(p_actor);
  select exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin'))
    into can_review;
  if p_status is null or p_status not in ('draft','archived','awaiting_review','approved','changes_requested')
    or p_offset is null or p_offset<0 then
    raise exception 'Choose a valid draft filter.' using errcode='22023';
  end if;
  if p_status in ('awaiting_review','approved','changes_requested') and p_id is null then
    select count(*) into total from social_posts
      where workspace_id=workspace and status='draft' and review_state=p_status;
    select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id),'[]'::jsonb) into rows from
      (select * from social_posts where workspace_id=workspace and status='draft' and review_state=p_status
        order by updated_at desc,id limit 50 offset p_offset) p;
    return jsonb_build_object('posts',rows,'total',total,'can_review',can_review);
  end if;
  if p_id is not null then
    select to_jsonb(p) into result from social_posts p where p.id=p_id and p.workspace_id=workspace;
    if result is null then raise exception 'This draft was not found.' using errcode='P0002'; end if;
    result:=jsonb_build_object('post',result,'history',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.revision desc) from
        (select revision,title,caption,link_url,media_ids,action,actor_id,recorded_at from social_post_revisions
          where post_id=p_id and workspace_id=workspace order by revision desc limit 50) r
    ),'[]'::jsonb),'reviews',coalesce((
      select jsonb_agg(to_jsonb(e) order by e.review_version desc) from
        (select revision,review_version,action,actor_id,reason,recorded_at from social_review_events
          where workspace_id=workspace and post_id=p_id order by review_version desc limit 50) e
    ),'[]'::jsonb));
    return result||jsonb_build_object('can_review',can_review);
  end if;
  select count(*) into total from social_posts where workspace_id=workspace and status=p_status;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id),'[]'::jsonb) into result from
    (select * from social_posts where workspace_id=workspace and status=p_status
      order by updated_at desc,id limit 50 offset p_offset) p;
  return jsonb_build_object('posts',result,'total',total,'can_review',can_review);
end;
$$;

drop function if exists public.save_social_draft(uuid,uuid,text,text,text,integer,uuid[]);

create function public.save_social_draft(p_actor uuid,p_id uuid,p_action text,p_title text default null,
  p_caption text default null,p_expected_revision integer default null,p_media_ids uuid[] default null,p_link_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare workspace uuid; saved social_posts; audit_action text; chosen uuid[];
begin
  workspace:=social_marketing_workspace_for(p_actor);
  if p_id is null or p_action is null or p_action not in ('create','update','archive') then
    raise exception 'Choose a valid draft action.' using errcode='22023';
  end if;
  if p_action in ('create','update') and (p_title is null or char_length(btrim(p_title)) not between 1 and 160
    or p_caption is null or char_length(p_caption)>10000
    or (p_link_url is not null and (char_length(p_link_url)>2048 or p_link_url !~ '^https://[^/@?#]+([/?#]|$)'))) then
    raise exception 'Enter a valid title, caption, and HTTPS link.' using errcode='22023';
  end if;
  if p_action='create' and p_expected_revision is not null then
    raise exception 'A new draft cannot include a revision.' using errcode='22023';
  end if;
  if p_action<>'create' and (p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=2147483647) then
    raise exception 'A valid draft revision is required.' using errcode='22023';
  end if;
  if p_action='archive' and (p_title is not null or p_caption is not null or p_link_url is not null or p_media_ids is not null) then
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
        and saved.title=btrim(p_title) and saved.caption=p_caption and saved.link_url is not distinct from p_link_url
        and saved.media_ids=chosen then return to_jsonb(saved); end if;
      raise exception 'This draft already exists. Reload before saving.' using errcode='PT409';
    end if;
    insert into social_posts(id,workspace_id,title,caption,link_url,media_ids,created_by,updated_by)
      values(p_id,workspace,btrim(p_title),p_caption,p_link_url,chosen,p_actor,p_actor) returning * into saved;
    audit_action:='created';
  else
    if saved.id is null then raise exception 'This draft was not found.' using errcode='P0002'; end if;
    if saved.revision<>p_expected_revision then
      raise exception 'Someone else changed this draft. Reload before saving.' using errcode='PT409';
    end if;
    if saved.status<>'draft' then raise exception 'Archived drafts cannot be changed.' using errcode='22023'; end if;
    if p_action='update' and saved.title=btrim(p_title) and saved.caption=p_caption
      and saved.link_url is not distinct from p_link_url and saved.media_ids=chosen then return to_jsonb(saved); end if;
    update social_posts set
      title=case when p_action='update' then btrim(p_title) else title end,
      caption=case when p_action='update' then p_caption else caption end,
      link_url=case when p_action='update' then p_link_url else link_url end,
      media_ids=chosen,
      status=case when p_action='archive' then 'archived' else status end,
      revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
      where id=p_id and workspace_id=workspace returning * into saved;
    audit_action:=case when p_action='archive' then 'archived' else 'edited' end;
  end if;
  insert into social_post_revisions(workspace_id,post_id,revision,title,caption,link_url,media_ids,action,actor_id)
    values(workspace,saved.id,saved.revision,saved.title,saved.caption,saved.link_url,saved.media_ids,audit_action,p_actor);
  insert into social_revision_media(workspace_id,post_id,revision,media_id)
    select workspace,saved.id,saved.revision,unnest(saved.media_ids);
  return to_jsonb(saved);
end;
$$;

create function public.save_social_draft(p_actor uuid,p_id uuid,p_action text,p_title text,p_caption text,p_legacy_link_url text)
returns jsonb language sql security definer set search_path=public as $$
  select public.save_social_draft(p_actor,p_id,p_action,p_title,p_caption,null,null,p_legacy_link_url);
$$;

revoke all on function public.save_social_draft(uuid,uuid,text,text,text,integer,uuid[],text) from public,anon,authenticated,service_role;
grant execute on function public.save_social_draft(uuid,uuid,text,text,text,integer,uuid[],text) to service_role;
revoke all on function public.save_social_draft(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_social_draft(uuid,uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
