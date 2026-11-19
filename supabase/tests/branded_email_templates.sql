begin;
do $test$
declare actor uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); saved jsonb; enrollment jsonb; plan jsonb; outbox uuid;
  design jsonb:='{"layout":"welcome","brand_name":"Example Agency","accent_color":"#1681a5","background_color":"#f3f5f7","logo_url":"","image_url":"","image_alt":"","heading":"Welcome","button_label":"Details","button_url":"https://example.invalid/details"}'::jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at) values(actor,'branded-fixture-'||actor||'@example.invalid',now());
  insert into agency_members(user_id,email,role,active) select id,email,'admin',true from auth.users where id=actor;
  saved=save_sales_template(actor,'fixture_branded_template',0,jsonb_build_object(
    'name','Branded fixture','category','First contact','subject','Hello','email_body','Hello {{contact_name}}',
    'sms_body','Hi {{contact_name}}','email_design',design,'archived',false));
  if saved->'email_design' is distinct from design or not exists(
    select 1 from sales_template_revisions where template_id='fixture_branded_template' and revision=1 and snapshot->'email_design'=design
  ) then raise exception 'Branded design not preserved in template revision'; end if;
  insert into leads(id,full_name,email,status,agent_user_id) values(lead,'Branded fixture','branded-fixture@example.invalid','new',actor);
  plan=jsonb_build_object('actor',actor,'preset','initial_contact','stage','new','assigned_agent',actor,
    'recipient','branded-fixture@example.invalid','auto_send',false,'steps',jsonb_build_array(
      jsonb_build_object('template',jsonb_build_object('id','fixture_branded_template','revision',1,'email_design',design),'requires_review',true),
      jsonb_build_object('template',jsonb_build_object('id','close_loop','revision',0),'requires_review',false)));
  enrollment=enroll_sales_sequence(actor,lead,plan,5);
  perform create_outreach_draft((enrollment->>'id')::uuid,1,'branded-fixture@example.invalid','Fixture subject','Fixture body','[]'::jsonb);
  select id into outbox from outreach_outbox where enrollment_id=(enrollment->>'id')::uuid;
  if not exists(select 1 from outreach_outbox where id=outbox and sales_template->'email_design'=design) then
    raise exception 'Sequence draft lost the reviewed design'; end if;
  saved=save_sales_template(actor,'fixture_branded_template',1,saved-'email_design');
  if saved->'email_design'<>'null'::jsonb then raise exception 'Switching to simple email did not remove the design'; end if;
end;
$test$;
rollback;
