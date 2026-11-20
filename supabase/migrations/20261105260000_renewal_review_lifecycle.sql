begin;

create table if not exists public.renewal_reviews (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete restrict,
  account_id uuid not null references public.clients(id) on delete restrict,
  renewal_term date not null,
  status text not null check (status in ('in_review', 'remarketing', 'retained', 'renewed', 'non_renewed', 'cancelled')),
  assigned_to uuid,
  notes text,
  follow_up_date date,
  next_policy_id uuid references public.policies(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(policy_id, renewal_term),
  check ((status = 'renewed' and next_policy_id is not null) or (status <> 'renewed' and next_policy_id is null))
);

create index if not exists renewal_reviews_account_term_idx on public.renewal_reviews(account_id, renewal_term desc);
create index if not exists renewal_reviews_assignee_status_idx on public.renewal_reviews(assigned_to, status);

create table if not exists public.renewal_review_events (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.renewal_reviews(id) on delete restrict,
  actor_id uuid,
  event_type text not null check (event_type in ('created', 'updated', 'status_changed')),
  from_status text,
  to_status text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists renewal_review_events_review_idx on public.renewal_review_events(review_id, created_at, id);
revoke all on public.renewal_review_events from public, anon, authenticated;

create or replace function public.validate_renewal_review()
returns trigger language plpgsql set search_path=public as $$
declare source_policy public.policies%rowtype;
  next_policy public.policies%rowtype;
begin
  select * into source_policy from public.policies where id=new.policy_id;
  if source_policy.id is null
    or coalesce(source_policy.account_id, source_policy.client_id) is distinct from new.account_id
    or coalesce(source_policy.renewal_date, source_policy.expiration_date) is distinct from new.renewal_term
    or lower(source_policy.status) not in ('active', 'issued', 'bound', 'in_force', 'inforce') then
    raise exception 'The policy renewal term changed. Reload the renewal before saving.' using errcode='40001';
  end if;
  if new.status = 'renewed' then
    select * into next_policy from public.policies where id=new.next_policy_id;
    if next_policy.id is null
      or coalesce(next_policy.account_id, next_policy.client_id) is distinct from new.account_id
      or next_policy.prior_policy_id is distinct from new.policy_id then
      raise exception 'Link the renewed term created from this policy on the same account.' using errcode='23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function public.record_renewal_review_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare event_name text;
begin
  if tg_op='UPDATE' then
    event_name := case when old.status is distinct from new.status then 'status_changed' else 'updated' end;
    insert into public.renewal_review_events(review_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, new.updated_by, event_name, old.status, new.status,
      jsonb_build_object('renewal_term',new.renewal_term,'assigned_to',new.assigned_to,'notes',new.notes,
        'follow_up_date',new.follow_up_date,'next_policy_id',new.next_policy_id,'version',new.version));
  else
    insert into public.renewal_review_events(review_id, actor_id, event_type, from_status, to_status, snapshot)
    values(new.id, new.updated_by, 'created', null, new.status,
      jsonb_build_object('renewal_term',new.renewal_term,'assigned_to',new.assigned_to,'notes',new.notes,
        'follow_up_date',new.follow_up_date,'next_policy_id',new.next_policy_id,'version',new.version));
  end if;
  return null;
end;
$$;

create or replace function public.sync_renewal_review_task()
returns trigger language plpgsql security definer set search_path=public as $$
declare source_policy public.policies%rowtype;
  task_id uuid;
  account_name text;
  assignee_email text;
  terminal boolean;
begin
  select * into source_policy from public.policies where id=new.policy_id for update;
  if source_policy.id is null then return null; end if;
  select full_name into account_name from public.clients where id=new.account_id;
  select email into assignee_email from public.agency_members where user_id=new.assigned_to and active;
  terminal := new.status in ('retained','renewed','non_renewed','cancelled');
  select id into task_id from public.tasks
    where renewal_policy_id=new.policy_id and renewal_term=new.renewal_term and renewal_canonical for update;
  if task_id is null then
    insert into public.tasks(subject,description,due_date,status,priority,kind,related_type,related_id,account_id,assignee,
      renewal_policy_id,renewal_term,renewal_canonical,completed_at,automation_provenance)
    values('Renewal review: '||coalesce(account_name,'Account'),
      'Review renewal outcome and follow-up for term '||new.renewal_term::text||'.',
      coalesce(new.follow_up_date,new.renewal_term),
      case when terminal then 'completed' else 'open' end,
      case when new.renewal_term <= current_date + 15 then 'high' else 'medium' end,
      'task','client',new.account_id,new.account_id,assignee_email,new.policy_id,new.renewal_term,true,
      case when terminal then clock_timestamp() else null end,
      jsonb_build_object('source','renewal_review','review_id',new.id));
  else
    update public.tasks set
      status=case when terminal then 'completed' else 'open' end,
      completed_at=case when terminal then coalesce(completed_at,clock_timestamp()) else null end,
      due_date=coalesce(new.follow_up_date,new.renewal_term),
      assignee=assignee_email,account_id=new.account_id,related_type='client',related_id=new.account_id,
      automation_provenance=automation_provenance||jsonb_build_object('renewal_review_id',new.id,'renewal_review_status',new.status)
      where id=task_id;
  end if;
  return null;
end;
$$;

drop trigger if exists renewal_review_validate_trigger on public.renewal_reviews;
create trigger renewal_review_validate_trigger before insert or update on public.renewal_reviews
  for each row execute function public.validate_renewal_review();
drop trigger if exists renewal_review_event_trigger on public.renewal_reviews;
create trigger renewal_review_event_trigger after insert or update on public.renewal_reviews
  for each row execute function public.record_renewal_review_event();
drop trigger if exists renewal_review_task_trigger on public.renewal_reviews;
create trigger renewal_review_task_trigger after insert or update on public.renewal_reviews
  for each row execute function public.sync_renewal_review_task();

create or replace view public.renewals
with (security_invoker = true) as
select
  p.id,p.client_id,p.insured_name,p.phone,p.email,p.address,p.carrier,p.line_of_business,p.premium,p.policy_number,
  p.effective_date,p.renewal_date,p.status,p.created_at,p.account_id,p.sub_type,p.expiration_date,p.billing_type,p.source,p.prior_policy_id,
  case
    when coalesce(p.renewal_date,p.expiration_date) < current_date then 'overdue'
    when coalesce(p.renewal_date,p.expiration_date) <= current_date + interval '30 days' then '0-30'
    when coalesce(p.renewal_date,p.expiration_date) <= current_date + interval '60 days' then '31-60'
    when coalesce(p.renewal_date,p.expiration_date) <= current_date + interval '90 days' then '61-90'
    else 'future'
  end as renewal_bucket,
  coalesce(p.renewal_date,p.expiration_date) as renewal_on
from public.policies p
where lower(p.status) in ('active','issued','bound','in_force','inforce')
  and coalesce(p.renewal_date,p.expiration_date) is not null
  and coalesce(p.renewal_date,p.expiration_date) <= current_date + interval '90 days';

revoke all on function public.validate_renewal_review() from public, anon, authenticated;
revoke all on function public.record_renewal_review_event() from public, anon, authenticated;
revoke all on function public.sync_renewal_review_task() from public, anon, authenticated;

commit;
