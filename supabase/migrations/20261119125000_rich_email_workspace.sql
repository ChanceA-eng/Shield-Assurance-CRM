begin;
alter table public.sales_templates drop constraint if exists sales_templates_email_design_check;
alter table public.sales_templates add constraint sales_templates_email_design_check
  check (email_design is null or (jsonb_typeof(email_design)='object' and octet_length(email_design::text)<=150000));

do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.save_sales_template(uuid,text,integer,jsonb)'::regprocedure);
  if strpos(definition,'12000')=0 then raise exception 'Template validation baseline changed'; end if;
  execute replace(definition,'12000','150000');
end;
$$;

create table public.email_signature_designs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=16000),
  rows jsonb check(rows is null or (jsonb_typeof(rows)='array' and octet_length(rows::text)<=24000)),
  updated_at timestamptz not null default now()
);
alter table public.email_signature_designs enable row level security;
revoke all on public.email_signature_designs from public,anon,authenticated;
grant select on public.email_signature_designs to service_role;

create function public.save_email_signature(p_actor uuid,p_text text,p_document jsonb,p_rows jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.agency_members where user_id=p_actor and active)
    or p_text is null or length(p_text)>2000 then
    raise exception 'Active membership and a signature under 2000 characters are required.' using errcode='42501';
  end if;
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('signature',p_text),updated_at=now() where id=p_actor;
  if not found then raise exception 'Your account could not be found.' using errcode='P0002'; end if;
  if p_document is null or length(trim(p_text))=0 then
    delete from public.email_signature_designs where user_id=p_actor;
  else
    insert into public.email_signature_designs(user_id,document,rows) values(p_actor,p_document,p_rows)
    on conflict(user_id) do update set document=excluded.document,rows=excluded.rows,updated_at=now();
  end if;
end;
$$;
revoke all on function public.save_email_signature(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_email_signature(uuid,text,jsonb,jsonb) to service_role;

alter table public.scheduled_messages add column body_document jsonb
  check(body_document is null or (jsonb_typeof(body_document)='object' and octet_length(body_document::text)<=150000));
alter table public.agent_email_attempts add column email_formatting jsonb
  check(email_formatting is null or (jsonb_typeof(email_formatting)='object' and octet_length(email_formatting::text)<=200000));
create function public.communication_email_formatting() returns trigger
language plpgsql security definer set search_path=public as $$
declare formatting jsonb;
begin
  if new.direction='outbound' and new.metadata->>'provider'='gmail' then
    select email_formatting into formatting from public.agent_email_attempts
      where rfc_message_id=new.metadata->>'rfc_message_id' limit 1;
    if formatting is not null then
      new.metadata=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('email_formatting',formatting);
    end if;
  end if;
  return new;
end;
$$;
create trigger communication_email_formatting before insert on public.communication_log
  for each row execute function public.communication_email_formatting();
revoke all on function public.communication_email_formatting() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
