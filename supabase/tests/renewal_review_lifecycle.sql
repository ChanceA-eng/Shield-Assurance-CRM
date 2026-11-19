do $$
declare
  v_account_id uuid := gen_random_uuid();
  v_policy_id uuid := gen_random_uuid();
  v_next_policy_id uuid := gen_random_uuid();
  v_review_id uuid := gen_random_uuid();
  v_term date := current_date + 20;
  v_version integer;
begin
  insert into public.clients(id,full_name,email,phone,address)
  values(v_account_id,'Renewal review fixture','renewal-fixture@example.test','5550101','Fixture address');
  insert into public.policies(id,client_id,account_id,insured_name,carrier,line_of_business,effective_date,renewal_date,expiration_date,status)
  values(v_policy_id,v_account_id,v_account_id,'Renewal review fixture','Fixture carrier','Commercial',current_date,v_term,v_term,'active');
  insert into public.renewal_reviews(id,policy_id,account_id,renewal_term,status,assigned_to,notes,updated_by)
  values(v_review_id,v_policy_id,v_account_id,v_term,'in_review',v_account_id,'Initial renewal review',v_account_id);
  if not exists(select 1 from public.renewal_review_events event where event.review_id=v_review_id
    and event.event_type='created' and event.to_status='in_review') then
    raise exception 'Renewal review creation must be retained';
  end if;
  if not exists(select 1 from public.tasks task where task.renewal_policy_id=v_policy_id
    and task.renewal_term=v_term and task.renewal_canonical and task.status='open'
    and task.related_type='client' and task.related_id=v_account_id) then
    raise exception 'Starting a renewal review must create one open, account-linked task';
  end if;

  update public.renewal_reviews set status='remarketing',notes='Market alternatives',updated_by=v_account_id
    where id=v_review_id;
  select version into v_version from public.renewal_reviews where id=v_review_id;
  if v_version<>2 then raise exception 'Renewal review updates must advance the version'; end if;

  insert into public.policies(id,client_id,account_id,insured_name,carrier,line_of_business,effective_date,renewal_date,expiration_date,status,prior_policy_id)
  values(v_next_policy_id,v_account_id,v_account_id,'Renewal review fixture','Fixture carrier','Commercial',v_term,v_term+365,v_term+365,'active',v_policy_id);
  update public.renewal_reviews set status='renewed',next_policy_id=v_next_policy_id,updated_by=v_account_id
    where id=v_review_id;
  if not exists(select 1 from public.renewal_review_events event where event.review_id=v_review_id
    and event.event_type='status_changed' and event.from_status='remarketing' and event.to_status='renewed'
    and event.snapshot->>'next_policy_id'=v_next_policy_id::text) then
    raise exception 'Renewal outcomes must preserve the linked next term in history';
  end if;
  if not exists(select 1 from public.tasks task where task.renewal_policy_id=v_policy_id
    and task.renewal_term=v_term and task.renewal_canonical and task.status='completed') then
    raise exception 'A completed renewal outcome must close its canonical task';
  end if;
  begin
    delete from public.renewal_reviews where id=v_review_id;
    raise exception 'Renewal reviews with history must not be deleted';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;
