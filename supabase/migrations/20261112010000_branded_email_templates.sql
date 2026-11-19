begin;

alter table public.sales_templates add column email_design jsonb
  check (email_design is null or (jsonb_typeof(email_design) = 'object' and octet_length(email_design::text) <= 12000));

create or replace function public.save_sales_template(p_actor uuid, p_id text, p_expected integer, p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.sales_templates;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin')) then
    raise exception 'Only owners and admins can save shared templates' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('sales-template:'||p_id));
  select * into saved from sales_templates where id=p_id for update;
  if coalesce(saved.revision,0) is distinct from p_expected then
    raise exception 'Template changed. Reload the saved version before editing.' using errcode='PT409';
  end if;
  if jsonb_typeof(p_values)<>'object'
    or coalesce(length(trim(p_values->>'name')),0) not between 1 and 150
    or coalesce(p_values->>'category','') not in ('First contact','Appointments','Information','Quotes','Closing','Reconnect')
    or coalesce(length(trim(p_values->>'subject')),0) not between 1 and 1000
    or coalesce(length(trim(p_values->>'email_body')),0) not between 1 and 10000
    or coalesce(length(trim(p_values->>'sms_body')),0) not between 1 and 1000
    or jsonb_typeof(p_values->'archived') is distinct from 'boolean'
    or (p_values->'email_design' is not null and p_values->'email_design'<>'null'::jsonb
      and (jsonb_typeof(p_values->'email_design')<>'object' or octet_length((p_values->'email_design')::text)>12000)) then
    raise exception 'Provide valid template fields' using errcode='22023';
  end if;
  insert into sales_templates(id,name,category,subject,email_body,sms_body,email_design,archived,revision,updated_by)
    values(p_id,p_values->>'name',p_values->>'category',p_values->>'subject',p_values->>'email_body',
      p_values->>'sms_body',nullif(p_values->'email_design','null'::jsonb),(p_values->>'archived')::boolean,p_expected+1,p_actor)
    on conflict(id) do update set name=excluded.name,category=excluded.category,subject=excluded.subject,
      email_body=excluded.email_body,sms_body=excluded.sms_body,email_design=excluded.email_design,archived=excluded.archived,
      revision=excluded.revision,updated_by=p_actor,updated_at=clock_timestamp()
    returning * into saved;
  insert into sales_template_revisions(template_id,revision,snapshot,actor_id)
    values(p_id,saved.revision,to_jsonb(saved),p_actor);
  return to_jsonb(saved);
end;
$$;
revoke all on function public.save_sales_template(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_sales_template(uuid,text,integer,jsonb) to service_role;

create or replace function public.stamp_sales_outreach() returns trigger language plpgsql set search_path=public as $$
declare plan jsonb; step jsonb;
begin
  select sales_plan into plan from sequence_enrollments where id=new.enrollment_id;
  if plan is not null then
    step=plan->'steps'->(new.step_number-1);
    new.sales_template=jsonb_strip_nulls(jsonb_build_object(
      'id',step->'template'->>'id','revision',step->'template'->'revision',
      'email_design',step->'template'->'email_design'));
    new.requires_manual_approval=coalesce((step->>'requires_review')::boolean,true);
  end if;
  return new;
end;
$$;

notify pgrst,'reload schema';
commit;
