begin;
do $test$
declare actor uuid:=gen_random_uuid(); part jsonb; observation jsonb; lease uuid; result boolean;
 map_items jsonb; map_result jsonb; business uuid:=gen_random_uuid(); linked uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,'directory-'||actor||'@example.invalid',now());
 insert into agency_members(user_id,email,role) values(actor,'directory-'||actor||'@example.invalid','owner');
 update business_research_settings set enabled=true;
 update business_research_sources set enabled=false;
 update business_research_sources set enabled=true,retained_rights=true where provider='dol_5500';
 begin
  perform queue_business_research_partition(gen_random_uuid(),'dol_5500','AZ');
  raise exception 'Unauthorized actor queued a directory';
 exception when insufficient_privilege then null; end;
 part:=queue_business_research_partition(actor,'dol_5500','AZ');
 if part->>'status'<>'pending' then raise exception 'Directory did not queue'; end if;
 delete from business_research_request_slots where name='directory:dol_5500';
 part:=claim_business_research_partition(); lease:=(part->>'lease')::uuid;
 if lease is null or part->>'state'<>'AZ' then raise exception 'Directory lease not claimed'; end if;
 if claim_business_research_partition() is not null then raise exception 'Concurrent live directory lease claimed twice'; end if;
 observation:='{"source":"dol_5500","record_id":"123456789:001:2025","url":"https://example.invalid/synthetic-filing","fetched_at":"2026-11-11T00:00:00Z","source_as_of":"2025-12-31","values":{"name":"Synthetic employer","state":"AZ","city":"Tucson","zip":"85701","ein":"123456789","naics":"332710","benefits":{"business_code":"332710","received_on":"2026-10-01","participants":21}}}';
 perform finish_business_research_partition('dol_5500','AZ',lease,'synthetic-v1',2500,false,jsonb_build_array(observation),null);
 if not exists(select 1 from business_research_partitions where provider='dol_5500' and state='AZ' and cursor=2500
  and status='pending' and building_version='synthetic-v1' and active_version is null) then raise exception 'Partial progress was not durable'; end if;
 delete from business_research_request_slots where name='directory:dol_5500';
 part:=claim_business_research_partition(); lease:=(part->>'lease')::uuid;
 begin
  perform finish_business_research_partition('dol_5500','AZ',gen_random_uuid(),'synthetic-v1',3000,true,'[]',null);
  raise exception 'Stale directory lease committed';
 exception when sqlstate 'PT409' then null; end;
 perform finish_business_research_partition('dol_5500','AZ',lease,'synthetic-v1',3000,true,jsonb_build_array(observation),null);
 if (select count(*) from business_research_directory_records where provider='dol_5500' and state='AZ')<>1 then raise exception 'Directory retry duplicated a filing'; end if;
 if not exists(select 1 from business_research_partitions where provider='dol_5500' and state='AZ' and status='complete' and active_version='synthetic-v1') then raise exception 'Completed directory version was not published'; end if;
 insert into business_research_entities(id,identity_key,name) values(business,repeat('d',64),'Synthetic employer');
 insert into leads(id,full_name,agent_user_id) values(linked,'Synthetic employer',actor);
 insert into business_research_links(business_id,lead_id,actor_id) values(business,linked,actor);
 insert into business_research_jobs(business_id,actor_id,state,result) values(business,actor,'complete','{}');
 insert into business_research_observations(business_id,provider,record_id,fingerprint,observation,fetched_at) values
  (business,'dol_5500',observation->>'record_id','synthetic-old',jsonb_set(observation,'{values,benefits,participants}','1'),clock_timestamp()-interval '1 day'),
  (business,'dol_5500',observation->>'record_id','synthetic-current',observation,clock_timestamp());
 update business_research_partitions set due_at=clock_timestamp()-interval '1 second' where provider='dol_5500' and state='AZ';
 delete from business_research_request_slots where name='directory:dol_5500';
 part:=claim_business_research_partition(); lease:=(part->>'lease')::uuid;
 if lease is null then raise exception 'Completed directory could not refresh automatically'; end if;
 perform finish_business_research_partition('dol_5500','AZ',lease,'synthetic-v2',100,false,jsonb_build_array(observation),null);
 if (select active_version from business_research_partitions where provider='dol_5500' and state='AZ')<>'synthetic-v1' then raise exception 'Partial refresh replaced complete source coverage'; end if;
 delete from business_research_request_slots where name='directory:dol_5500';
 part:=claim_business_research_partition(); lease:=(part->>'lease')::uuid;
 perform finish_business_research_partition('dol_5500','AZ',lease,'synthetic-v2',200,true,jsonb_build_array(observation),null);
 if (select state from business_research_jobs where business_id=business)<>'complete' then raise exception 'Historical snapshots caused redundant research invalidation'; end if;
 update business_research_partitions set due_at=clock_timestamp()-interval '1 second' where provider='dol_5500' and state='AZ';
 delete from business_research_request_slots where name='directory:dol_5500';
 part:=claim_business_research_partition(); lease:=(part->>'lease')::uuid;
 perform finish_business_research_partition('dol_5500','AZ',lease,'synthetic-v3',201,true,jsonb_build_array(jsonb_set(observation,'{values,benefits,participants}','22')),null);
 if (select state from business_research_jobs where business_id=business)<>'pending' then raise exception 'Changed current evidence did not invalidate research'; end if;
 update business_research_partitions set due_at=clock_timestamp()-interval '1 second' where provider='dol_5500' and state='AZ';
 delete from business_research_request_slots where name='directory:dol_5500';
 part:=claim_business_research_partition(); lease:=(part->>'lease')::uuid;
 update business_research_sources set retained_rights=false where provider='dol_5500';
 result:=finish_business_research_partition('dol_5500','AZ',lease,'synthetic-v4',200,true,'[]',null);
 if result then raise exception 'Withdrawn source rights still published a directory'; end if;
 update business_research_sources set enabled=true,retained_rights=true where provider='osm';
 update business_research_partitions set status='pending',lease=null,lease_until=null,due_at=clock_timestamp(),attempts=0 where provider='osm' and state='AZ';
 part:=queue_business_research_partition(actor,'osm','AZ');
 delete from business_research_request_slots where name='directory:osm';
 part:=claim_business_research_partition(); lease:=(part->>'lease')::uuid;
 select jsonb_agg(jsonb_build_object('source','osm','record_id','node/'||i,'index_partition','AZ','values',
  jsonb_build_object('name','Synthetic mapped business','state',null,'latitude',32.4,'longitude',-110.9747,'phone','5205550101','map_tags',jsonb_build_object('amenity','restaurant'))))
  into map_items from generate_series(1,26) i;
 map_items:=map_items||jsonb_build_array(
  '{"source":"osm","record_id":"node/97","index_partition":"AZ","values":{"name":"Synthetic different category","latitude":32.2226,"longitude":-110.9747,"phone":"5205550101","map_tags":{"office":"accountant"}}}'::jsonb,
  '{"source":"osm","record_id":"node/98","index_partition":"AZ","values":{"name":"Synthetic contactless","latitude":32.2226,"longitude":-110.9747,"map_tags":{"amenity":"restaurant"}}}'::jsonb,
  '{"source":"osm","record_id":"node/99","index_partition":"AZ","values":{"name":"Synthetic qualifying restaurant","latitude":32.2226,"longitude":-110.9747,"phone":"5205550101","map_tags":{"amenity":"restaurant"}}}'::jsonb);
 perform finish_business_research_partition('osm','AZ',lease,'synthetic-map-v1',3000000,true,map_items,null);
 select m.observation into map_result from search_business_research_map_index(actor,'AZ','{"south":32,"west":-111,"north":33,"east":-110}',
  '', 'amenity','^restaurant$','','phone',32.2226,-110.9747,5,0) m;
 if map_result->>'record_id' is distinct from 'node/99' then raise exception 'Indexed map filters were not applied before pagination'; end if;
 if exists(select 1 from search_business_research_map_index(actor,'AZ','{"south":32,"west":-111,"north":33,"east":-110}',
  '', 'amenity','^restaurant$','','phone',32.2226,-110.9747,5,1)) then raise exception 'Indexed map pagination ignored its filtered window'; end if;
 update business_research_directory_records d set latitude=32.2226+degrees(5*1.609344/6371),
  observation=jsonb_set(d.observation,'{values,latitude}',to_jsonb(32.2226+degrees(5*1.609344/6371)))
  where provider='osm' and state='AZ' and record_id='node/99';
 if not exists(select 1 from search_business_research_map_index(actor,'AZ','{"south":32,"west":-111,"north":33,"east":-110}',
  '', 'amenity','^restaurant$','','phone',32.2226,-110.9747,5,0)) then raise exception 'Exact five-mile radius edge was excluded'; end if;
 update business_research_directory_records d set latitude=32.2226+degrees((5*1.609344+0.001)/6371),
  observation=jsonb_set(d.observation,'{values,latitude}',to_jsonb(32.2226+degrees((5*1.609344+0.001)/6371)))
  where provider='osm' and state='AZ' and record_id='node/99';
 if exists(select 1 from search_business_research_map_index(actor,'AZ','{"south":32,"west":-111,"north":33,"east":-110}',
  '', 'amenity','^restaurant$','','phone',32.2226,-110.9747,5,0)) then raise exception 'Business one metre outside the radius was included'; end if;
 begin
  perform search_business_research_map_index(gen_random_uuid(),'AZ','{"south":32,"west":-111,"north":33,"east":-110}',
   '',null,null,'','',null,null,null,0);
  raise exception 'Unauthorized map index access';
 exception when insufficient_privilege then null; end;
 update business_research_sources set retained_rights=false where provider='osm';
 begin
  perform search_business_research_map_index(actor,'AZ','{"south":32,"west":-111,"north":33,"east":-110}',
   '',null,null,'','',null,null,null,0);
  raise exception 'Withdrawn source rights still exposed indexed maps';
 exception when insufficient_privilege then null; end;
 if has_table_privilege('authenticated','public.business_research_directory_records','SELECT')
  or has_function_privilege('authenticated','public.finish_business_research_partition(text,text,uuid,text,bigint,boolean,jsonb,text)','EXECUTE')
  or has_function_privilege('authenticated','public.search_business_research_map_index(uuid,text,jsonb,text,text,text,text,text,double precision,double precision,double precision,integer)','EXECUTE') then
  raise exception 'Browser can bypass directory scopes'; end if;
end;
$test$;
rollback;
