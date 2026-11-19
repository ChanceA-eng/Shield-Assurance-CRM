begin;
alter table public.business_research_sources drop constraint business_research_sources_provider_check;
alter table public.business_research_sources add constraint business_research_sources_provider_check
 check(provider in ('fmcsa_census','osm','irs','dol_5500'));
insert into public.business_research_sources(provider,reference) values
 ('dol_5500','https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/public-disclosure/foia/form-5500-datasets');

create table public.business_research_partitions (
 provider text not null references public.business_research_sources(provider),
 state text not null check(state ~ '^[A-Z]{2}$'),
 active_version text,
 building_version text,
 cursor bigint not null default 0 check(cursor>=0),
 status text not null default 'pending' check(status in ('pending','processing','complete','failed')),
 lease uuid,
 lease_until timestamptz,
 attempts integer not null default 0,
 error text,
 due_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(provider,state)
);
create table public.business_research_directory_records (
 provider text not null,
 state text not null,
 version text not null,
 record_id text not null,
 name text not null,
 city text,
 zip text,
 business_code text,
 received_on date,
 latitude double precision check(latitude between -90 and 90),
 longitude double precision check(longitude between -180 and 180),
 observation jsonb not null,
 primary key(provider,state,version,record_id),
 foreign key(provider,state) references public.business_research_partitions(provider,state) on delete cascade
);
create index business_research_directory_search on public.business_research_directory_records(provider,state,version,city,business_code,record_id);
create index business_research_directory_map on public.business_research_directory_records(provider,state,version,latitude,longitude) where provider='osm';
alter table public.business_research_partitions enable row level security;
alter table public.business_research_directory_records enable row level security;
revoke all on public.business_research_partitions,public.business_research_directory_records from public,anon,authenticated,service_role;
grant select on public.business_research_partitions,public.business_research_directory_records to service_role;

create function public.queue_business_research_partition(p_actor uuid,p_provider text,p_state text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result business_research_partitions;
begin
 if not exists(select 1 from agency_members where user_id=p_actor and active) then raise exception 'Active agency access required' using errcode='42501'; end if;
 if not(select enabled from business_research_settings where id=1) or not exists(
  select 1 from business_research_sources where provider=p_provider and enabled and retained_rights) then
  raise exception 'Directory source is not enabled for retained research' using errcode='42501'; end if;
 if p_provider is null or p_state is null or p_provider not in ('irs','dol_5500','osm') or p_state not in
  ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR') then
  raise exception 'Choose a supported directory and U.S. state' using errcode='22023'; end if;
 insert into business_research_partitions(provider,state) values(p_provider,p_state) on conflict do nothing;
 update business_research_partitions set status='pending',attempts=0,due_at=clock_timestamp()
  where provider=p_provider and state=p_state and status='complete' and due_at<=clock_timestamp();
 select * into result from business_research_partitions where provider=p_provider and state=p_state;
 return to_jsonb(result);
end $$;

create function public.claim_business_research_partition()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result business_research_partitions;
begin
 if not(select enabled from business_research_settings where id=1) then return null; end if;
 update business_research_partitions set status='failed',lease=null,lease_until=null,error='Directory lease expired after its final attempt.',updated_at=clock_timestamp()
  where status='processing' and lease_until<clock_timestamp() and attempts>=5;
 select p.* into result from business_research_partitions p join business_research_sources s on s.provider=p.provider
  where s.enabled and s.retained_rights and p.attempts<5 and p.due_at<=clock_timestamp()
   and (p.status in ('pending','failed','complete') or p.status='processing' and p.lease_until<clock_timestamp())
  order by p.updated_at,p.provider,p.state for update of p skip locked limit 1;
 if result.provider is null then return null; end if;
 if not research_request_slot('directory:'||result.provider,45) then return null; end if;
 update business_research_partitions set status='processing',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '55 seconds',
  attempts=attempts+1,updated_at=clock_timestamp() where provider=result.provider and state=result.state returning * into result;
 return to_jsonb(result);
end $$;

create function public.finish_business_research_partition(p_provider text,p_state text,p_lease uuid,p_version text,p_cursor bigint,p_complete boolean,p_items jsonb,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
declare part business_research_partitions; item jsonb; v jsonb; previous bigint;
begin
 select * into part from business_research_partitions where provider=p_provider and state=p_state for update;
 if part.provider is null or part.status<>'processing' or part.lease is distinct from p_lease or part.lease_until<clock_timestamp() then
  raise exception 'Directory lease expired' using errcode='PT409'; end if;
 if not(select enabled from business_research_settings where id=1) or not exists(select 1 from business_research_sources
  where provider=p_provider and enabled and retained_rights) then
  update business_research_partitions set status='pending',lease=null,lease_until=null where provider=p_provider and state=p_state; return false;
 end if;
 if p_error is not null then
  update business_research_partitions set status='failed',error=left(p_error,1000),lease=null,lease_until=null,
   due_at=clock_timestamp()+make_interval(mins=>least(60,attempts*attempts)),updated_at=clock_timestamp() where provider=p_provider and state=p_state;
  return false;
 end if;
 if nullif(p_version,'') is null or length(p_version)>300 or p_cursor is null or p_cursor<0
  or p_cursor>(case when p_provider='osm' then 8589934592 else 1500000 end) or p_complete is null
  or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>2500 then
  raise exception 'Invalid directory checkpoint' using errcode='22023'; end if;
 previous:=case when part.building_version=p_version then part.cursor else 0 end;
 if p_cursor<previous then raise exception 'Directory checkpoint moved backwards' using errcode='PT409'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  v:=item->'values';
  if item->>'source' is distinct from p_provider
   or (case when p_provider='osm' then item->>'index_partition' is distinct from p_state
    or (v->>'state' is not null and upper(v->>'state')<>p_state)
    or v->>'latitude' is null or v->>'longitude' is null
    else v->>'state' is distinct from p_state end)
   or nullif(item->>'record_id','') is null
   or nullif(v->>'name','') is null or length(v->>'name')>300 then raise exception 'Invalid directory observation' using errcode='22023'; end if;
  insert into business_research_directory_records(provider,state,version,record_id,name,city,zip,business_code,received_on,latitude,longitude,observation)
   values(p_provider,p_state,p_version,item->>'record_id',v->>'name',upper(v->>'city'),left(v->>'zip',5),
    v->'benefits'->>'business_code',nullif(v->'benefits'->>'received_on','')::date,
    (v->>'latitude')::double precision,(v->>'longitude')::double precision,item)
  on conflict(provider,state,version,record_id) do update set
   name=excluded.name,city=excluded.city,zip=excluded.zip,business_code=excluded.business_code,received_on=excluded.received_on,
   latitude=excluded.latitude,longitude=excluded.longitude,observation=excluded.observation
   where excluded.received_on is null or business_research_directory_records.received_on is null
    or excluded.received_on>=business_research_directory_records.received_on;
 end loop;
 if (select count(*) from business_research_directory_records where provider=p_provider and state=p_state and version=p_version)>50000 then
  raise exception 'Directory partition exceeds the approved bounded index budget' using errcode='54000'; end if;
 update business_research_partitions set building_version=p_version,cursor=p_cursor,
  active_version=case when p_complete then p_version else active_version end,
  status=case when p_complete then 'complete' else 'pending' end,error=null,attempts=0,lease=null,lease_until=null,
  due_at=case when p_complete then clock_timestamp()+interval '30 days' else clock_timestamp() end,updated_at=clock_timestamp()
  where provider=p_provider and state=p_state;
 if p_complete then
  delete from business_research_directory_records where provider=p_provider and state=p_state and version<>p_version;
  update business_research_entities set updated_at=clock_timestamp() where id in (
   select distinct o.business_id from business_research_observations o
    join business_research_directory_records d on d.provider=o.provider and d.record_id=o.record_id
    where d.provider=p_provider and d.state=p_state and d.version=p_version
     and o.observation->'values' is distinct from d.observation->'values'
     and not exists(select 1 from business_research_observations newer
      where newer.business_id=o.business_id and newer.provider=o.provider and newer.record_id=o.record_id
       and (newer.fetched_at,newer.id)>(o.fetched_at,o.id))
     and exists(select 1 from business_research_links l where l.business_id=o.business_id)
  );
  update business_research_jobs j set result=null,due_at=clock_timestamp(),updated_at=clock_timestamp(),
   state=case when state='processing' then state else 'pending' end,attempts=case when state='processing' then attempts else 0 end
   where exists(select 1 from business_research_observations o join business_research_directory_records d
    on d.provider=o.provider and d.record_id=o.record_id
    where o.business_id=j.business_id and d.provider=p_provider and d.state=p_state and d.version=p_version
     and o.observation->'values' is distinct from d.observation->'values'
     and not exists(select 1 from business_research_observations newer where newer.business_id=o.business_id
      and newer.provider=o.provider and newer.record_id=o.record_id and (newer.fetched_at,newer.id)>(o.fetched_at,o.id)))
    and exists(select 1 from business_research_links l where l.business_id=j.business_id);
 end if;
 return true;
end $$;
create function public.search_business_research_map_index(p_actor uuid,p_state text,p_bounds jsonb,p_query text,p_tag_key text,p_tag_pattern text,
 p_zip text,p_contact text,p_latitude double precision,p_longitude double precision,p_radius_miles double precision,p_page integer)
returns table(observation jsonb) language plpgsql security definer set search_path=public as $$
declare indexed_version text; south double precision:=(p_bounds->>'south')::double precision; west double precision:=(p_bounds->>'west')::double precision;
 north double precision:=(p_bounds->>'north')::double precision; east double precision:=(p_bounds->>'east')::double precision;
begin
 if not exists(select 1 from agency_members where user_id=p_actor and active) then raise exception 'Active agency access required' using errcode='42501'; end if;
 if not(select enabled from business_research_settings where id=1) or not exists(select 1 from business_research_sources
  where provider='osm' and enabled and retained_rights) then raise exception 'Open-map source is not enabled for retained research' using errcode='42501'; end if;
 if south is null or west is null or north is null or east is null or south < -90 or north>90 or west < -180 or east>180
  or south>=north or west>=east or north-south>2 or east-west>2 or p_page is null or p_page not between 0 and 250
  or p_contact is null or p_contact not in ('','any','phone','email','website') or p_query is null or length(p_query)>150
  or p_zip is null or (p_zip<>'' and p_zip !~ '^\d{5}$')
  or p_tag_key is not null and (p_tag_key not in ('shop','craft','office','amenity','tourism','man_made') or p_tag_pattern is null or length(p_tag_pattern)>150)
  or p_radius_miles is not null and (p_radius_miles not in (5,10,25,50) or p_latitude is null or p_longitude is null
   or p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
  raise exception 'Invalid indexed map filters' using errcode='22023'; end if;
 select coalesce(active_version,building_version) into indexed_version from business_research_partitions where provider='osm' and state=p_state;
 if indexed_version is null then raise exception 'Open-map state is still indexing' using errcode='PT409'; end if;
 return query select d.observation from business_research_directory_records d
  where d.provider='osm' and d.state=p_state and d.version=indexed_version
   and d.latitude between south and north and d.longitude between west and east
   and (p_query='' or strpos(lower(d.name),lower(p_query))>0)
   and (p_zip='' or d.zip=p_zip)
   and (p_tag_key is null or d.observation->'values'->'map_tags'->>p_tag_key ~ p_tag_pattern)
   and (p_contact='' or p_contact='phone' and d.observation->'values'->>'phone' is not null
    or p_contact='email' and d.observation->'values'->>'email' is not null
    or p_contact='website' and d.observation->'values'->>'website' is not null
    or p_contact='any' and (d.observation->'values'->>'phone' is not null or d.observation->'values'->>'email' is not null or d.observation->'values'->>'website' is not null))
   -- A millimetre tolerance preserves inclusive radius edges despite acos roundoff.
   and (p_radius_miles is null or 6371*acos(greatest(-1.0,least(1.0,
    sin(radians(p_latitude))*sin(radians(d.latitude))+cos(radians(p_latitude))*cos(radians(d.latitude))*cos(radians(d.longitude-p_longitude)))))<=p_radius_miles*1.609344+0.000001)
  order by d.record_id offset p_page*25 limit 25;
end $$;
create function public.retry_business_research_partition(p_actor uuid,p_provider text,p_state text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from agency_members where user_id=p_actor and active and role='owner') then raise exception 'Owner access required' using errcode='42501'; end if;
 update business_research_partitions set status='pending',attempts=0,error=null,lease=null,lease_until=null,due_at=clock_timestamp(),updated_at=clock_timestamp()
  where provider=p_provider and state=p_state and status='failed';
 if not found then raise exception 'This directory is not failed. Reload its status.' using errcode='PT409'; end if;
 insert into business_research_setting_events(actor_id,snapshot) values(p_actor,jsonb_build_object('retry_directory',p_provider,'state',p_state));
end $$;
revoke all on function public.queue_business_research_partition(uuid,text,text),public.claim_business_research_partition(),
 public.retry_business_research_partition(uuid,text,text),
 public.finish_business_research_partition(text,text,uuid,text,bigint,boolean,jsonb,text) from public,anon,authenticated;
revoke all on function public.search_business_research_map_index(uuid,text,jsonb,text,text,text,text,text,double precision,double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.queue_business_research_partition(uuid,text,text),public.claim_business_research_partition(),
 public.retry_business_research_partition(uuid,text,text),
 public.finish_business_research_partition(text,text,uuid,text,bigint,boolean,jsonb,text) to service_role;
grant execute on function public.search_business_research_map_index(uuid,text,jsonb,text,text,text,text,text,double precision,double precision,double precision,integer) to service_role;
notify pgrst, 'reload schema';
commit;
