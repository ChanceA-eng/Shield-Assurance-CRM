begin;
do $test$
declare actor uuid:=gen_random_uuid(); post_id uuid:=gen_random_uuid(); result jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at)
    values(actor,'social-links-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role)
    select id,email,'agent' from auth.users where id=actor;
  result:=save_social_draft(p_actor=>actor,p_id=>post_id,p_action=>'create',p_title=>'Link post',
    p_caption=>'Coverage resource',p_link_url=>'https://example.invalid/resource');
  if result->>'link_url'<>'https://example.invalid/resource' then raise exception 'Link was not persisted on the draft'; end if;
  result:=list_social_drafts(actor,'draft',0,post_id);
  if result->'post'->>'link_url'<>'https://example.invalid/resource'
    or result->'history'->0->>'link_url'<>'https://example.invalid/resource' then
    raise exception 'Link was not returned in draft history';
  end if;
  begin
    perform save_social_draft(p_actor=>actor,p_id=>gen_random_uuid(),p_action=>'create',p_title=>'Unsafe link',
      p_caption=>'Not allowed',p_link_url=>'http://example.invalid');
    raise exception 'Non-HTTPS link was accepted';
  exception when sqlstate '22023' then null; end;
  result:=save_social_draft(p_actor=>actor,p_id=>post_id,p_action=>'update',p_title=>'Link post',
    p_caption=>'Updated resource',p_link_url=>'https://example.invalid/updated',p_expected_revision=>1);
  if result->>'revision'<>'2' or result->>'link_url'<>'https://example.invalid/updated' then
    raise exception 'Link edit did not create an exact new revision';
  end if;
  result:=list_social_drafts(actor,'draft',0,post_id);
  if result->'history'->0->>'link_url'<>'https://example.invalid/updated'
    or result->'history'->1->>'link_url'<>'https://example.invalid/resource' then
    raise exception 'Immutable link revision history was not retained';
  end if;
end;
$test$;
rollback;
