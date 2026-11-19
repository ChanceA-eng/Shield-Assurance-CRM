begin;
do $test$
declare actor uuid:=gen_random_uuid(); inactive_actor uuid:=gen_random_uuid(); unconfirmed uuid:=gen_random_uuid();
  draft_id uuid:=gen_random_uuid(); result jsonb; before_counts jsonb; after_counts jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,'social-active-'||actor||'@example.invalid',now()),
    (inactive_actor,'social-inactive-'||inactive_actor||'@example.invalid',now()),
    (unconfirmed,'social-unconfirmed-'||unconfirmed||'@example.invalid',null);
  insert into agency_members(user_id,email,role,active) select id,email,'agent',id=actor
    from auth.users where id in (actor,inactive_actor);
  select jsonb_build_object('events',(select count(*) from events),'tasks',(select count(*) from tasks),
    'outreach',(select count(*) from outreach_outbox)) into before_counts;

  begin
    perform list_social_drafts(inactive_actor);
    raise exception 'Inactive staff read marketing data';
  exception when insufficient_privilege then null; end;
  begin
    perform save_social_draft(unconfirmed,draft_id,'create','Idea','');
    raise exception 'Unconfirmed actor saved a draft';
  exception when insufficient_privilege then null; end;
  begin
    perform save_social_draft(null,draft_id,'create','Idea','');
    raise exception 'Anonymous actor saved a draft';
  exception when insufficient_privilege then null; end;

  result:=save_social_draft(actor,draft_id,'create',' First idea ','Line one'||chr(10)||'Line two');
  if result->>'title'<>'First idea' or (result->>'revision')::integer<>1 then raise exception 'Initial content incorrect'; end if;
  perform save_social_draft(actor,draft_id,'create',' First idea ','Line one'||chr(10)||'Line two');
  if (select count(*) from social_post_revisions r where r.post_id=draft_id)<>1 then raise exception 'Create retry duplicated history'; end if;
  perform save_social_draft(actor,draft_id,'update','First idea','Line one'||chr(10)||'Line two',1);
  if (select revision from social_posts where id=draft_id)<>1 then raise exception 'No-op edit advanced revision'; end if;
  result:=save_social_draft(actor,draft_id,'update','Updated idea','Updated caption',1);
  if (result->>'revision')::integer<>2 then raise exception 'Edit revision missing'; end if;
  begin
    perform save_social_draft(actor,draft_id,'update','Stale edit','Lost update',1);
    raise exception 'Stale edit overwrote content';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform save_social_draft(actor,draft_id,'archive',null,null,1);
    raise exception 'Stale archive succeeded';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform save_social_draft(actor,draft_id,'publish',null,null,2);
    raise exception 'Draft command published content';
  exception when invalid_parameter_value then null; end;
  begin
    perform save_social_draft(actor,draft_id,'update','Invalid caption',repeat('x',10001),2);
    raise exception 'Oversized caption saved';
  exception when invalid_parameter_value then null; end;
  result:=list_social_drafts(actor,'draft',0,draft_id);
  if jsonb_array_length(result->'history')<>2 or result#>>'{post,caption}'<>'Updated caption' then raise exception 'History detail incorrect'; end if;
  if not exists(select 1 from social_post_revisions r where r.post_id=draft_id and revision=1 and title='First idea') then
    raise exception 'Previous revision mutated'; end if;
  perform save_social_draft(actor,draft_id,'archive',null,null,2);
  if (select status from social_posts where id=draft_id)<>'archived'
    or (select count(*) from social_post_revisions r where r.post_id=draft_id)<>3 then raise exception 'Archive lost history'; end if;
  begin
    perform save_social_draft(actor,draft_id,'update','Cannot edit','Archive',3);
    raise exception 'Archived content changed';
  exception when invalid_parameter_value then null; end;
  update agency_members set active=false where user_id=actor;
  begin
    perform save_social_draft(actor,gen_random_uuid(),'create','Revoked','');
    raise exception 'Revoked membership retained access';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_social_draft'
    and has_function_privilege('authenticated',p.oid,'execute'))
    or has_function_privilege('service_role','public.social_marketing_workspace_for(uuid)','execute')
    or has_table_privilege('authenticated','public.social_posts','select')
    or has_table_privilege('service_role','public.social_posts','update')
    or has_table_privilege('service_role','public.social_post_revisions','insert') then
    raise exception 'Social draft command or history grants are unsafe'; end if;
  select jsonb_build_object('events',(select count(*) from events),'tasks',(select count(*) from tasks),
    'outreach',(select count(*) from outreach_outbox)) into after_counts;
  if before_counts<>after_counts then raise exception 'Draft work changed appointments/tasks/outreach'; end if;
end;
$test$;
rollback;
