begin;
do $test$
declare l uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); original jsonb;
begin
  insert into clients(id,full_name) values(a,'Marketing verification account');
  insert into leads(id,full_name,status) values(l,'Marketing verification lead','new');
  select sender_profile into original from outreach_settings where id=1;
  if jsonb_typeof(original)<>'object' or original->>'signature' is null then
    raise exception 'Sender profile default missing'; end if;
  insert into outreach_marketing_profiles(lead_id,profile)
    values(l,'{"interests":"Auto","source":"Customer call","confirmed_on":"2026-10-30"}');
  update leads set account_id=a where id=l;
  if not exists(select 1 from outreach_marketing_profiles p join leads on leads.id=p.lead_id
    where leads.account_id=a and p.profile->>'interests'='Auto') then
    raise exception 'Linked lead profile lost'; end if;
  insert into outreach_marketing_profiles(client_id,profile) values(a,'{"interests":"Home"}')
    on conflict(client_id) do update set profile=excluded.profile;
  insert into outreach_marketing_profiles(client_id,profile) values(a,'{"interests":"Home and auto"}')
    on conflict(client_id) do update set profile=excluded.profile;
  if (select count(*) from outreach_marketing_profiles where client_id=a)<>1 then
    raise exception 'Account profile upsert duplicated'; end if;
  begin
    insert into outreach_marketing_profiles(client_id,lead_id,profile) values(a,l,'{}');
    raise exception 'Ambiguous target accepted';
  exception when check_violation or unique_violation then null; end;
  begin
    insert into outreach_marketing_profiles(profile) values('{}');
    raise exception 'Missing target accepted';
  exception when check_violation then null; end;
  begin
    update outreach_marketing_profiles set profile='[]' where lead_id=l;
    raise exception 'Non-object profile accepted';
  exception when check_violation then null; end;
  if has_table_privilege('anon','public.outreach_marketing_profiles','SELECT')
    or has_table_privilege('authenticated','public.outreach_marketing_profiles','UPDATE') then
    raise exception 'Unauthenticated reads or direct mutations exposed'; end if;
  if exists(select 1 from sequence_enrollments where lead_id=l)
    or exists(select 1 from outreach_outbox where lead_id=l) then
    raise exception 'Profile changes initiated outreach'; end if;
end;
$test$;
rollback;
