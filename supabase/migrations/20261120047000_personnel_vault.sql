begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('personnel-documents','personnel-documents',false,26214400,
  array['application/pdf','image/jpeg','image/png','image/webp','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy personnel_documents_private on storage.objects as restrictive for all to anon,authenticated
  using(bucket_id<>'personnel-documents') with check(bucket_id<>'personnel-documents');

create table public.personnel_documents (
  id uuid primary key,
  member_id uuid not null references public.agency_members(user_id) on delete restrict,
  file_name text not null check(length(btrim(file_name)) between 1 and 255),
  storage_path text not null unique,
  content_type text not null check(content_type in ('application/pdf','image/jpeg','image/png','image/webp','text/plain')),
  file_size integer not null check(file_size between 1 and 26214400),
  shared boolean not null default false,
  retain_until date not null,
  state text not null default 'stored' check(state in ('stored','removing','removed')),
  version integer not null default 1,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
alter table public.personnel_documents enable row level security;
revoke all on public.personnel_documents from public,anon,authenticated,service_role;

create table public.personnel_uploads (
  id uuid primary key,
  actor_id uuid not null,
  member_id uuid not null,
  storage_path text not null unique,
  expires_at timestamptz not null,
  last_attempt_at timestamptz,
  state text not null default 'pending' check(state in ('pending','completed','cleaning'))
);
alter table public.personnel_uploads enable row level security;
revoke all on public.personnel_uploads from public,anon,authenticated,service_role;

create function public.personnel_manager(p_actor uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from agency_members m join auth.users u on u.id=m.user_id
    where m.user_id=p_actor and m.active and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
      and (m.role='owner' or m.direct_grants->>'personnel.manage'='agency'));
$$;

create function public.reserve_personnel_upload(p_actor uuid,p_member uuid,p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not personnel_manager(p_actor) then raise exception 'Personnel document management is required.' using errcode='42501'; end if;
  if p_id is null or p_member is null or not exists(select 1 from agency_members where user_id=p_member) then
    raise exception 'The team member is unavailable.' using errcode='P0002';
  end if;
  insert into personnel_uploads(id,actor_id,member_id,storage_path,expires_at)
    values(p_id,p_actor,p_member,p_member::text||'/'||p_id::text||'/document',now()+interval '2 hours 15 minutes');
end;
$$;

create function public.claim_expired_personnel_uploads()
returns table(id uuid,storage_path text)
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  delete from personnel_uploads u where u.state='completed' and u.expires_at<now();
  insert into personnel_uploads(id,actor_id,member_id,storage_path,expires_at,state)
    select split_part(o.name,'/',2)::uuid,split_part(o.name,'/',1)::uuid,split_part(o.name,'/',1)::uuid,
      o.name,now(),'cleaning' from storage.objects o
    where o.bucket_id='personnel-documents' and o.created_at<now()-interval '24 hours'
      and o.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/document$'
      and not exists(select 1 from personnel_uploads u where u.storage_path=o.name)
      and not exists(select 1 from personnel_documents d where d.storage_path=o.name and d.state<>'removed')
    order by o.created_at limit 25 on conflict do nothing;
  return query with candidates as (
    select u.id from personnel_uploads u
    where u.expires_at<=now() and u.state in ('pending','cleaning')
    order by u.last_attempt_at nulls first,u.expires_at,u.id limit 25
  )
  update personnel_uploads p set state='cleaning',last_attempt_at=clock_timestamp()
    from candidates c where p.id=c.id returning p.id,p.storage_path;
end;
$$;

create function public.finish_expired_personnel_upload(p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare item personnel_uploads;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  select * into item from personnel_uploads where id=p_id for update;
  if not found then return; end if;
  if item.state<>'cleaning' or exists(select 1 from personnel_documents where id=p_id and state<>'removed') then
    raise exception 'This upload cannot be cleaned.' using errcode='PT409';
  end if;
  if exists(select 1 from storage.objects where bucket_id='personnel-documents' and name=item.storage_path) then
    raise exception 'The stored upload has not been removed.' using errcode='PT409';
  end if;
  delete from personnel_uploads where id=p_id;
end;
$$;

create function public.list_personnel_documents(p_actor uuid,p_member uuid)
returns table(id uuid,member_id uuid,file_name text,content_type text,file_size integer,
  shared boolean,retain_until date,state text,version integer,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare manager boolean:=personnel_manager(p_actor);
begin
  if not manager and (p_actor<>p_member or not exists(select 1 from agency_members m join auth.users u on u.id=m.user_id
    where m.user_id=p_actor and m.active and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now()))) then
    raise exception 'Personnel documents are unavailable.' using errcode='42501';
  end if;
  return query select d.id,d.member_id,d.file_name,d.content_type,d.file_size,d.shared,d.retain_until,d.state,d.version,d.created_at
    from personnel_documents d where d.member_id=p_member and d.state<>'removed'
      and (manager or (d.shared and d.state='stored')) order by d.created_at desc,d.id;
end;
$$;

create function public.personnel_document_members(p_actor uuid)
returns table(user_id uuid,team_name text,email text)
language plpgsql stable security definer set search_path=public as $$
begin
  if not personnel_manager(p_actor) then raise exception 'Personnel document management is required.' using errcode='42501'; end if;
  return query select m.user_id,m.team_name,m.email from agency_members m order by coalesce(m.team_name,m.email),m.user_id;
end;
$$;

create function public.read_personnel_document(p_actor uuid,p_id uuid)
returns table(member_id uuid,file_name text,storage_path text,content_type text,file_size integer)
language plpgsql security definer set search_path=public as $$
begin
  return query select d.member_id,d.file_name,d.storage_path,d.content_type,d.file_size
    from personnel_documents d join agency_members m on m.user_id=p_actor
    join auth.users u on u.id=m.user_id
    where d.id=p_id and d.state='stored' and m.active and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now())
      and (personnel_manager(p_actor) or (d.member_id=p_actor and d.shared));
  if found then
    insert into agency_audit(actor_id,target_id,action,details)
      select p_actor,d.member_id,'personnel_document_access_requested',jsonb_build_object('document_id',p_id)
      from personnel_documents d where d.id=p_id;
  end if;
end;
$$;

create function public.save_personnel_document(p_actor uuid,p_id uuid,p_member uuid,p_name text,
  p_path text,p_type text,p_size integer,p_retain date,p_shared boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not personnel_manager(p_actor) then raise exception 'Personnel document management is required.' using errcode='42501'; end if;
  if p_id is null or p_member is null or p_name is null or length(btrim(p_name)) not between 1 and 255
    or p_path is distinct from p_member::text||'/'||p_id::text||'/document'
    or p_type is null or p_type not in ('application/pdf','image/jpeg','image/png','image/webp','text/plain')
    or p_size is null or p_size not between 1 and 26214400 or p_retain is null or p_shared is null then
    raise exception 'Choose valid document details and a retention date.' using errcode='22023';
  end if;
  if not exists(select 1 from agency_members where user_id=p_member) then
    raise exception 'The team member is unavailable.' using errcode='P0002';
  end if;
  if exists(select 1 from personnel_documents where id=p_id and member_id=p_member and file_name=btrim(p_name)
    and storage_path=p_path and content_type=p_type and file_size=p_size and retain_until=p_retain
    and uploaded_by=p_actor and state='stored') then return; end if;
  if not exists(select 1 from personnel_uploads where id=p_id and actor_id=p_actor and member_id=p_member
    and storage_path=p_path and state='pending' and expires_at>now() for update) then
    raise exception 'This upload is unavailable. Start a new upload.' using errcode='PT409';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='personnel-documents' and name=p_path
    and metadata->>'size'=p_size::text and metadata->>'mimetype'=p_type) then
    raise exception 'The uploaded file could not be verified. Upload it again.' using errcode='PT409';
  end if;
  insert into personnel_documents(id,member_id,file_name,storage_path,content_type,file_size,retain_until,shared,uploaded_by)
    values(p_id,p_member,btrim(p_name),p_path,p_type,p_size,p_retain,p_shared,p_actor);
  update personnel_uploads set state='completed' where id=p_id;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,p_member,'personnel_document_added',jsonb_build_object('document_id',p_id));
end;
$$;

create function public.change_personnel_document(p_actor uuid,p_id uuid,p_version integer,p_action text)
returns text language plpgsql security definer set search_path=public as $$
declare item personnel_documents;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not personnel_manager(p_actor) then raise exception 'Personnel document management is required.' using errcode='42501'; end if;
  select * into item from personnel_documents where id=p_id for update;
  if not found or item.state='removed' or item.version is distinct from p_version then
    raise exception 'This document changed. Reload before continuing.' using errcode='PT409';
  end if;
  if p_action in ('share','unshare') and item.state='stored' then
    update personnel_documents set shared=(p_action='share'),version=version+1 where id=p_id;
  elsif p_action='remove' and item.state in ('stored','removing') then
    if item.retain_until>=current_date then
      raise exception 'This document must be retained until its retention date.' using errcode='PT409';
    end if;
    if exists(select 1 from personnel_uploads where id=p_id and expires_at>=now()) then
      raise exception 'Wait for the upload link to expire before removing this document.' using errcode='PT409';
    end if;
    update personnel_documents set shared=false,state='removing',version=version+1 where id=p_id;
  else raise exception 'Choose a valid document action.' using errcode='22023';
  end if;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,item.member_id,'personnel_document_'||p_action,jsonb_build_object('document_id',p_id));
  return case when p_action='remove' then item.storage_path else null end;
end;
$$;

create function public.finish_personnel_document_removal(p_actor uuid,p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare item personnel_documents;
begin
  perform pg_advisory_xact_lock(hashtext('agency-membership'));
  if not personnel_manager(p_actor) then raise exception 'Personnel document management is required.' using errcode='42501'; end if;
  select * into item from personnel_documents where id=p_id for update;
  if not found or item.state<>'removing' then raise exception 'This removal is unavailable.' using errcode='PT409'; end if;
  if exists(select 1 from storage.objects where bucket_id='personnel-documents' and name=item.storage_path) then
    raise exception 'The stored file has not been removed. Retry removal.' using errcode='PT409';
  end if;
  update personnel_documents set state='removed',removed_at=now(),version=version+1 where id=p_id;
  insert into agency_audit(actor_id,target_id,action,details)
    values(p_actor,item.member_id,'personnel_document_removed',jsonb_build_object('document_id',p_id));
end;
$$;

revoke all on function public.personnel_manager(uuid),public.list_personnel_documents(uuid,uuid),
  public.reserve_personnel_upload(uuid,uuid,uuid),public.claim_expired_personnel_uploads(),public.finish_expired_personnel_upload(uuid),
  public.personnel_document_members(uuid),
  public.read_personnel_document(uuid,uuid),public.save_personnel_document(uuid,uuid,uuid,text,text,text,integer,date,boolean),
  public.change_personnel_document(uuid,uuid,integer,text),public.finish_personnel_document_removal(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.personnel_manager(uuid),public.list_personnel_documents(uuid,uuid),
  public.reserve_personnel_upload(uuid,uuid,uuid),public.claim_expired_personnel_uploads(),public.finish_expired_personnel_upload(uuid),
  public.personnel_document_members(uuid),
  public.read_personnel_document(uuid,uuid),public.save_personnel_document(uuid,uuid,uuid,text,text,text,integer,date,boolean),
  public.change_personnel_document(uuid,uuid,integer,text),public.finish_personnel_document_removal(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
