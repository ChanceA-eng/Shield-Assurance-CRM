begin;
do $test$
declare actor uuid:=gen_random_uuid(); results jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,'browse-'||actor||'@example.invalid',now());
 insert into agency_members(user_id,email,role,active) values(actor,'browse-'||actor||'@example.invalid','agent',true);
 update business_research_settings set enabled=true;
 update business_research_sources set enabled=true,retained_rights=true where provider='osm';
 update business_research_partitions set active_version=null,building_version=null where provider='osm';
 insert into business_research_partitions(provider,state,active_version,status) values
  ('osm','AZ','synthetic-browse','complete'),('osm','CA','synthetic-browse','complete')
 on conflict(provider,state) do update set active_version=excluded.active_version;
 insert into business_research_directory_records(provider,state,version,record_id,name,city,zip,latitude,longitude,observation)
 select 'osm',case when i<=30 then 'AZ' else 'CA' end,'synthetic-browse','node/'||i,'Synthetic browse '||i,
  case when i<=5 then 'PHOENIX' else 'TUCSON' end,case when i<=10 then '85001' else '85705' end,32.2,-110.9,
  jsonb_build_object('source','osm','record_id','node/'||i,'values',jsonb_build_object('name','Synthetic browse '||i,
   'state',case when i<=30 then 'AZ' else 'CA' end,'city',case when i<=5 then 'Phoenix' else 'Tucson' end,
   'zip',case when i<=10 then '85001' else '85705' end,
   'phone',case when i%2=0 then '5205550101' else null end,
   'map_tags',jsonb_build_object('craft',case when i<=10 then 'electrician' else 'plumber' end)))
 from generate_series(1,60) i;
 insert into business_research_directory_records(provider,state,version,record_id,name,city,zip,latitude,longitude,observation)
 select provider,'CA',version,record_id,name,city,zip,latitude,longitude,observation
 from business_research_directory_records where provider='osm' and state='AZ' and version='synthetic-browse' and record_id='node/11';
 if (select count(*) from browse_business_research_map_index(actor,'','',null,'',null,null,'','',null,null,null,0))<>25
  or (select count(*) from browse_business_research_map_index(actor,'','',null,'',null,null,'','',null,null,null,1))<>25
  or (select count(*) from browse_business_research_map_index(actor,'','',null,'',null,null,'','',null,null,null,2))<>10 then
  raise exception 'Unfiltered browse lost pagination, deduplication or current-version isolation'; end if;
 if (select count(*) from browse_business_research_map_index(actor,'AZ','Tucson',null,'','craft','^(plumber|hvac)$','85705','phone',null,null,null,0))<>10 then
  raise exception 'Optional city/ZIP/category/contact filters were not applied before pagination'; end if;
 if (select count(*) from browse_business_research_map_index(actor,'AZ','',null,'',null,null,'','',null,null,null,1))<>5 then
  raise exception 'State-only browsing required additional fields or lost results'; end if;
 if exists(select 1 from browse_business_research_map_index(actor,'AZ','Phoenix',null,'','craft','^plumber$','85705','',null,null,null,0)) then
  raise exception 'No-match filters were silently broadened'; end if;
 begin
  perform browse_business_research_map_index(gen_random_uuid(),'','',null,'',null,null,'','',null,null,null,0);
  raise exception 'Unauthorized unfiltered browse';
 exception when insufficient_privilege then null; end;
 update business_research_sources set retained_rights=false where provider='osm';
 begin
  perform browse_business_research_map_index(actor,'','',null,'',null,null,'','',null,null,null,0);
  raise exception 'Withdrawn rights still exposed browse data';
 exception when insufficient_privilege then null; end;
 if has_function_privilege('authenticated','public.browse_business_research_map_index(uuid,text,text,jsonb,text,text,text,text,text,double precision,double precision,double precision,integer)','EXECUTE') then
  raise exception 'Browser can bypass browse scopes'; end if;
end;
$test$;
rollback;
