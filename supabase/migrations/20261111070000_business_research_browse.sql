begin;

create function public.browse_business_research_map_index(p_actor uuid,p_state text,p_city text,p_bounds jsonb,p_query text,
 p_tag_key text,p_tag_pattern text,p_zip text,p_contact text,p_latitude double precision,p_longitude double precision,
 p_radius_miles double precision,p_page integer)
returns table(observation jsonb) language plpgsql security definer set search_path=public as $$
declare south double precision:=(p_bounds->>'south')::double precision; west double precision:=(p_bounds->>'west')::double precision;
 north double precision:=(p_bounds->>'north')::double precision; east double precision:=(p_bounds->>'east')::double precision;
begin
 if not exists(select 1 from agency_members where user_id=p_actor and active) then raise exception 'Active agency access required' using errcode='42501'; end if;
 if not(select enabled from business_research_settings where id=1) or not exists(select 1 from business_research_sources
  where provider='osm' and enabled and retained_rights) then raise exception 'Open-map source is not enabled for retained research' using errcode='42501'; end if;
 if p_state is null or (p_state<>'' and not exists(select 1 from business_research_partitions where provider='osm' and state=p_state))
  or p_city is null or length(p_city)>120
  or p_bounds is not null and (south is null or west is null or north is null or east is null or south < -90 or north>90 or west < -180 or east>180
   or south>=north or west>=east or north-south>2 or east-west>2)
  or p_page is null or p_page not between 0 and 250
  or p_contact is null or p_contact not in ('','any','phone','email','website') or p_query is null or length(p_query)>150
  or p_zip is null or (p_zip<>'' and p_zip !~ '^\d{5}$')
  or p_tag_key is not null and (p_tag_key not in ('shop','craft','office','amenity','tourism','man_made') or p_tag_pattern is null or length(p_tag_pattern)>150)
  or p_radius_miles is not null and (p_radius_miles not in (5,10,25,50) or p_latitude is null or p_longitude is null
   or p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
  raise exception 'Invalid indexed business filters' using errcode='22023'; end if;
 return query
 select matched.observation from (
  select distinct on (d.record_id) d.record_id,d.observation
  from business_research_directory_records d join business_research_partitions p on p.provider=d.provider and p.state=d.state
  where d.provider='osm' and (p_state='' or d.state=p_state) and d.version=coalesce(p.active_version,p.building_version)
   and (p_city='' or d.city=upper(p_city))
   and (p_bounds is null or d.latitude between south and north and d.longitude between west and east)
   and (p_query='' or strpos(lower(d.name),lower(p_query))>0)
   and (p_zip='' or d.zip=p_zip)
   and (p_tag_key is null or d.observation->'values'->'map_tags'->>p_tag_key ~ p_tag_pattern)
   and (p_contact='' or p_contact='phone' and d.observation->'values'->>'phone' is not null
    or p_contact='email' and d.observation->'values'->>'email' is not null
    or p_contact='website' and d.observation->'values'->>'website' is not null
    or p_contact='any' and (d.observation->'values'->>'phone' is not null or d.observation->'values'->>'email' is not null or d.observation->'values'->>'website' is not null))
   and (p_radius_miles is null or 6371*acos(greatest(-1.0,least(1.0,
    sin(radians(p_latitude))*sin(radians(d.latitude))+cos(radians(p_latitude))*cos(radians(d.latitude))*cos(radians(d.longitude-p_longitude)))))<=p_radius_miles*1.609344+0.000001)
  order by d.record_id,(d.observation->'values'->>'state'=d.state) desc nulls last,d.state
 ) matched order by matched.record_id offset p_page*25 limit 25;
end $$;

revoke all on function public.browse_business_research_map_index(uuid,text,text,jsonb,text,text,text,text,text,double precision,double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.browse_business_research_map_index(uuid,text,text,jsonb,text,text,text,text,text,double precision,double precision,double precision,integer) to service_role;
notify pgrst, 'reload schema';
commit;
