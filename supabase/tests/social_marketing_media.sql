begin;
do $test$
declare actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); workspace uuid;
  media_id uuid; second_id uuid; third_id uuid; draft_id uuid:=gen_random_uuid(); result jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,'social-media-'||actor||'@example.invalid',now()),
    (other_actor,'social-media-other-'||other_actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role,active) select id,email,'agent',id=actor from auth.users where id in (actor,other_actor);
  begin
    perform reserve_social_media(other_actor,'photo.png','Agency image','Agency-owned');
    raise exception 'Inactive member reserved media';
  exception when insufficient_privilege then null; end;
  result:=reserve_social_media(actor,'photo.png','Agency building','Agency-owned photo');
  media_id:=(result->>'id')::uuid; workspace:=(result->>'workspace_id')::uuid;
  if result->>'status'<>'processing' then raise exception 'Reservation not processing'; end if;
  begin
    perform save_social_draft(actor,draft_id,'create','With media','',null,array[media_id]);
    raise exception 'Unready media attached';
  exception when invalid_parameter_value then null; end;
  begin
    perform complete_social_media(actor,media_id,640,480,1000);
    raise exception 'Missing storage accepted';
  exception when invalid_parameter_value then null; end;
  insert into storage.objects(bucket_id,name) values
    ('social-marketing-media',workspace::text||'/'||media_id::text||'/image.jpg'),
    ('social-marketing-media',workspace::text||'/'||media_id::text||'/thumbnail.jpg');
  result:=complete_social_media(actor,media_id,640,480,1000);
  if result->>'status'<>'ready' then raise exception 'Image not ready'; end if;
  begin
    perform complete_social_media(actor,media_id,640,480,1000);
    raise exception 'Ready media overwritten';
  exception when invalid_parameter_value then null; end;
  result:=save_social_draft(actor,draft_id,'create','With media','',null,array[media_id]);
  if result->'media_ids'<>jsonb_build_array(media_id) then raise exception 'Attachment missing'; end if;
  perform save_social_draft(actor,draft_id,'update','With media','Legacy edit',1);
  if (select media_ids from social_posts where id=draft_id)<>array[media_id] then raise exception 'Legacy edit removed media'; end if;
  perform save_social_draft(actor,draft_id,'update','With media','Legacy edit',2,'{}'::uuid[]);
  if (select revision from social_posts where id=draft_id)<>3 or (select cardinality(media_ids) from social_posts where id=draft_id)<>0 then
    raise exception 'Media-only edit was not revisioned'; end if;
  if not exists(select 1 from social_post_revisions where post_id=draft_id and revision=1 and media_ids=array[media_id])
    or (select count(*) from social_revision_media where post_id=draft_id)<>2 then raise exception 'Immutable attachment history lost'; end if;
  begin
    delete from social_media_assets where id=media_id;
    raise exception 'Referenced media deleted';
  exception when foreign_key_violation then null; end;
  begin
    perform save_social_draft(actor,draft_id,'update','With media','Legacy edit',3,array[gen_random_uuid()]);
    raise exception 'Unknown media attached';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_social_draft(actor,draft_id,'update','With media','Legacy edit',3,array[media_id,media_id]);
    raise exception 'Multiple attachments accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_social_draft(actor,draft_id,'update','With media','Legacy edit',3,array[null::uuid]);
    raise exception 'Null media accepted';
  exception when invalid_parameter_value then null; end;
  result:=reserve_social_media(actor,'second.png','Second','Agency-owned');
  second_id:=(result->>'id')::uuid;
  result:=reserve_social_media(actor,'third.png','Third','Agency-owned');
  third_id:=(result->>'id')::uuid;
  begin
    perform reserve_social_media(actor,'fourth.png','Fourth','Agency-owned');
    raise exception 'Processing concurrency limit bypassed';
  exception when sqlstate 'PT429' then null; end;
  update social_media_assets set expires_at=now()-interval '1 minute' where id=second_id;
  perform reserve_social_media(actor,'fourth.png','Fourth','Agency-owned');
  if (select status from social_media_assets where id=second_id)<>'failed' then raise exception 'Expired reservation not reclaimed'; end if;
  update agency_members set active=false where user_id=actor;
  perform fail_social_media(actor,third_id,'Upload canceled after access was revoked.');
  if (select status from social_media_assets where id=third_id)<>'failed' then raise exception 'Revoked cleanup failed'; end if;
  begin
    perform list_social_media(actor,0,media_id);
    raise exception 'Revoked member read media';
  exception when insufficient_privilege then null; end;
  if (select public from storage.buckets where id='social-marketing-media') then raise exception 'Media bucket is public'; end if;
  if has_table_privilege('authenticated','public.social_media_assets','select')
    or has_table_privilege('service_role','public.social_media_assets','update')
    or has_function_privilege('authenticated','public.reserve_social_media(uuid,text,text,text)','execute')
    or has_table_privilege('service_role','public.social_revision_media','delete') then
    raise exception 'Media grants unsafe'; end if;
end;
$test$;
rollback;
