begin;
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
    -- Stale edits are user conflicts, not retryable database serialization failures.
    raise exception 'Template changed. Reload the saved version before editing.' using errcode='PT409';
  end if;
  if jsonb_typeof(p_values)<>'object'
    or coalesce(length(trim(p_values->>'name')),0) not between 1 and 150
    or coalesce(p_values->>'category','') not in ('First contact','Appointments','Information','Quotes','Closing','Reconnect')
    or coalesce(length(trim(p_values->>'subject')),0) not between 1 and 1000
    or coalesce(length(trim(p_values->>'email_body')),0) not between 1 and 10000
    or coalesce(length(trim(p_values->>'sms_body')),0) not between 1 and 1000
    or jsonb_typeof(p_values->'archived') is distinct from 'boolean' then
    raise exception 'Provide valid template fields' using errcode='22023';
  end if;
  insert into sales_templates(id,name,category,subject,email_body,sms_body,archived,revision,updated_by)
    values(p_id,p_values->>'name',p_values->>'category',p_values->>'subject',p_values->>'email_body',
      p_values->>'sms_body',(p_values->>'archived')::boolean,p_expected+1,p_actor)
    on conflict(id) do update set name=excluded.name,category=excluded.category,subject=excluded.subject,
      email_body=excluded.email_body,sms_body=excluded.sms_body,archived=excluded.archived,
      revision=excluded.revision,updated_by=p_actor,updated_at=clock_timestamp()
    returning * into saved;
  insert into sales_template_revisions(template_id,revision,snapshot,actor_id)
    values(p_id,saved.revision,to_jsonb(saved),p_actor);
  return to_jsonb(saved);
end;
$$;
revoke all on function public.save_sales_template(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_sales_template(uuid,text,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
