begin;
do $test$
declare actor uuid:=gen_random_uuid(); saved jsonb; lead uuid:=gen_random_uuid(); enrollment jsonb; plan jsonb; outbox uuid;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'sales-fixture-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role,active) select id,email,'admin',true from auth.users where id=actor;
  saved=save_sales_template(actor,'fixture_sales_template',0,jsonb_build_object('name','Fixture template','category','First contact',
    'subject','Hello','email_body','Hello {{contact_name}}','sms_body','Hi {{contact_name}}','archived',false));
  if saved->>'revision'<>'1' or not exists(select 1 from sales_template_revisions where template_id='fixture_sales_template' and revision=1) then
    raise exception 'Template and immutable revision were not saved'; end if;
  begin
    perform save_sales_template(actor,'fixture_sales_template',0,saved);
    raise exception 'Stale template save was accepted';
  exception when sqlstate 'PT409' then null; end;
  saved=save_sales_template(actor,'fixture_sales_template',1,saved||'{"archived":true}'::jsonb);
  if saved->>'revision'<>'2' or (select count(*) from sales_template_revisions where template_id='fixture_sales_template')<>2 then
    raise exception 'Archive did not preserve revision history'; end if;
  if has_table_privilege('authenticated','public.sales_templates','UPDATE')
    or has_function_privilege('authenticated','public.save_sales_template(uuid,text,integer,jsonb)','EXECUTE') then
    raise exception 'Browser role may mutate shared templates'; end if;
  update agency_members set role='agent' where user_id=actor;
  begin
    perform save_sales_template(actor,'fixture_sales_template',2,saved);
    raise exception 'Agent saved a shared template';
  exception when insufficient_privilege then null; end;
  update agency_members set role='admin' where user_id=actor;
  saved=save_sales_template(actor,'fixture_sales_template',2,saved||'{"archived":false}'::jsonb);
  if saved->>'revision'<>'3' then raise exception 'Admin could not save shared template'; end if;
  insert into leads(id,full_name,email,status,agent_user_id) values(lead,'Synthetic sales fixture','sales-fixture@example.invalid','new',actor);
  plan=jsonb_build_object('actor',actor,'preset','initial_contact','stage','new','assigned_agent',actor,
    'recipient','sales-fixture@example.invalid','auto_send',true,'steps',jsonb_build_array(
      jsonb_build_object('template',jsonb_build_object('id','introduction','revision',0),'requires_review',true),
      jsonb_build_object('template',jsonb_build_object('id','close_loop','revision',0),'requires_review',false)));
  enrollment=enroll_sales_sequence(actor,lead,plan,5);
  if enrollment->'sales_plan'->>'auto_send'<>'false' then raise exception 'Enrollment enabled auto-send by default'; end if;
  perform create_outreach_draft((enrollment->>'id')::uuid,1,'sales-fixture@example.invalid','Fixture subject','Fixture body','[]'::jsonb);
  select id into outbox from outreach_outbox where enrollment_id=(enrollment->>'id')::uuid;
  if not exists(select 1 from outreach_outbox where id=outbox and requires_manual_approval
    and sales_template->>'id'='introduction') then raise exception 'Sales draft lost template or required approval'; end if;
  if claim_outreach_send(outbox,'Fixture subject','Fixture body',null) then raise exception 'First sales step sent without approval'; end if;
  update leads set status='contacted' where id=lead;
  if claim_outreach_send(outbox,'Fixture subject','Fixture body',1) then raise exception 'Changed-stage sales sequence was sendable'; end if;
  update leads set status='new' where id=lead;
  begin
    perform enroll_sales_sequence(actor,lead,plan,5);
    raise exception 'Duplicate enrollment was accepted';
  exception when unique_violation then null; end;
  perform set_sales_sequence_state(actor,(enrollment->>'id')::uuid,'pause');
  if not exists(select 1 from sequence_enrollments where id=(enrollment->>'id')::uuid and status='paused') then
    raise exception 'Sequence pause not saved'; end if;
  perform set_sales_sequence_state(actor,(enrollment->>'id')::uuid,'resume');
  if exists(select 1 from sequence_enrollments where id=(enrollment->>'id')::uuid and sales_plan->>'auto_send'<>'false') then
    raise exception 'Resume enabled automatic sending'; end if;
  perform set_sales_sequence_state(actor,(enrollment->>'id')::uuid,'cancel');
  if exists(select 1 from outreach_outbox where id=outbox and status='pending_approval') then raise exception 'Cancellation left a pending sales draft'; end if;
end;
$test$;
rollback;
