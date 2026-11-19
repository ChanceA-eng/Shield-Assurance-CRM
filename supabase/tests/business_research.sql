begin;
do $test$
declare
 owner_id uuid:=gen_random_uuid(); agent_id uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
 business uuid; other_business uuid; saved jsonb; profile jsonb; observation jsonb; job jsonb; task uuid; linked uuid;
 existing uuid:=gen_random_uuid(); guide uuid:=gen_random_uuid(); conflicting uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values
  (owner_id,'research-owner-'||owner_id||'@example.invalid',now()),
  (agent_id,'research-agent-'||agent_id||'@example.invalid',now()),
  (stranger,'research-other-'||stranger||'@example.invalid',now());
 insert into agency_members(user_id,email,role) select id,email,case when id=owner_id then 'owner' else 'agent' end
  from auth.users where id in (owner_id,agent_id,stranger);
 begin
  perform save_business_research_settings(agent_id,0,'{"enabled":false,"tasks_enabled":false,"task_capacity":10,"task_due_days":1,"refresh_days":7}','[]');
  raise exception 'Agent changed research permissions';
 exception when insufficient_privilege then null; end;
 update business_research_sources set enabled=true,retained_rights=true;
 update business_research_settings set enabled=true,tasks_enabled=true,task_capacity=1;
 observation:=jsonb_build_object('source','fmcsa_census','record_id','999999987','url','https://example.invalid/synthetic-public-business',
  'fetched_at',clock_timestamp(),'source_as_of',null,'values',jsonb_build_object('name','Synthetic research '||owner_id,
   'street','123 Synthetic Street','city','Tucson','state','AZ','zip','85701','phone',null,'email',null,'dot','999999987','power_units',12));
 business:=retain_research_observation(agent_id,repeat('a',64),observation);
 if business is distinct from retain_research_observation(agent_id,repeat('a',64),observation||jsonb_build_object('fetched_at',clock_timestamp())) then raise exception 'Stable source identity changed'; end if;
 if (select count(*) from business_research_observations where business_id=business)<>1 then raise exception 'Unchanged evidence duplicated'; end if;
 other_business:=retain_research_observation(agent_id,repeat('a',64),
  jsonb_set(jsonb_set(observation,'{record_id}','"999999988"'),'{values,dot}','"999999988"'));
 if business=other_business then raise exception 'Conflicting DOT registrations merged'; end if;
 if exists(select 1 from business_research_links where business_id=business) then raise exception 'Search created a CRM record'; end if;
 job:=claim_business_research_jobs(business)->0;
 if job is null or job->>'state'<>'processing' then raise exception 'Research lease not claimed'; end if;
 if jsonb_array_length(claim_business_research_jobs(business))<>0 then raise exception 'Live lease claimed twice'; end if;
 if create_business_research_task(business,(job->>'lease')::uuid,'contact_research') is not null then raise exception 'Unsaved business received a task'; end if;
 profile:=get_business_research(agent_id,business);
 perform finish_business_research_job(business,(job->>'lease')::uuid,(profile->'business'->>'updated_at')::timestamptz,
  '{"insights":[],"context":[],"coverage":[],"market_fit":null}',null);
 if (select due_at from business_research_jobs where business_id=business)>
  (date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day') at time zone 'UTC' then raise exception 'Date-sensitive findings were cached beyond the UTC date boundary'; end if;
 update business_research_settings set enabled=false;
 if not (get_business_research(agent_id,business)->'job'->>'paused')::boolean then raise exception 'Paused engine was not exposed to the producer profile'; end if;
 update business_research_settings set enabled=true;
 update business_research_jobs set due_at=clock_timestamp()-interval '1 second' where business_id=business;
 profile:=get_business_research(agent_id,business);
 if profile->'job'->>'state'<>'pending' or profile->'job'->'result'<>'null'::jsonb then raise exception 'Expired findings remained current'; end if;
 job:=claim_business_research_jobs(business)->0;
 if job is null then raise exception 'Viewing expired unsaved research could not refresh it'; end if;
 insert into carrier_appetite_documents(id,created_by,file_name,storage_path,content_type,file_size,revision,state,approved_by,approved_at)
  values(guide,owner_id,'Synthetic guide.pdf','synthetic-research/'||guide,'application/pdf',1,1,'active',owner_id,clock_timestamp());
 if finish_business_research_job(business,(job->>'lease')::uuid,(profile->'business'->>'updated_at')::timestamptz,
  '{"insights":[],"context":[],"coverage":[],"market_fit":null}',null) then raise exception 'Changed appetite accepted an in-flight stale assessment'; end if;
 job:=claim_business_research_jobs(business)->0;
 profile:=get_business_research(agent_id,business);
 perform finish_business_research_job(business,(job->>'lease')::uuid,(profile->'business'->>'updated_at')::timestamptz,
  '{"insights":[],"context":[],"coverage":[],"market_fit":null}',null);
 update business_research_jobs set result=jsonb_set(result,'{coverage}','[{"source":"osha","state":"unavailable","message":"Synthetic unavailable source"}]')
  where business_id=business;
 perform retry_business_research_job(owner_id,business);
 if not exists(select 1 from business_research_jobs where business_id=business and state='pending' and result is null) then raise exception 'Owner could not retry completed-but-partial research'; end if;
 insert into leads(id,full_name,address,agent_user_id,form_payload) values(conflicting,observation->'values'->>'name',
  '123 Synthetic Street, Tucson, AZ, 85701',agent_id,'{"profile":{"dot":{"number":"999999985"}}}');
 if jsonb_array_length(research_match_context(agent_id,business)->'matches')<>0 then raise exception 'Exact name/address overrode a conflicting CRM DOT identity'; end if;
 saved:=save_research_business(agent_id,business);
 linked:=(saved->>'id')::uuid;
 if saved->>'type'<>'lead' or not exists(select 1 from leads where id=linked and email is null and phone is null and agent_user_id=agent_id) then
  raise exception 'Contactless selected business was not saved as a business lead'; end if;
 if (save_research_business(agent_id,business)->>'id')::uuid<>linked then raise exception 'Retry created a duplicate lead'; end if;
 if get_business_research(stranger,business)->'linked_record'<>'null'::jsonb then raise exception 'Other agent learned private CRM link'; end if;
 begin
  perform save_research_business(stranger,business);
  raise exception 'Other agent reused an assigned CRM link';
 exception when insufficient_privilege then null; end;
 job:=claim_business_research_jobs(business)->0;
 task:=create_business_research_task(business,(job->>'lease')::uuid,'contact_research');
 if task is null or task is distinct from create_business_research_task(business,(job->>'lease')::uuid,'contact_research') then raise exception 'Internal task is missing or not idempotent'; end if;
 if not exists(select 1 from tasks where id=task and assignee=(select email from agency_members where user_id=agent_id) and related_id=linked) then raise exception 'Task assignment lost'; end if;
 if exists(select 1 from sequence_enrollments where lead_id=linked) or exists(select 1 from outreach_outbox where lead_id=linked) then raise exception 'Research initiated customer outreach'; end if;
 if exists(select 1 from intelligence_dossier_confirmations where scope_key='lead:'||linked) then raise exception 'Public research fabricated a human confirmation'; end if;
 delete from tasks where id=task;
 if create_business_research_task(business,(job->>'lease')::uuid,'contact_research') is not null then raise exception 'Deleting an automatic task caused it to be recreated'; end if;
 if create_business_research_task(business,(job->>'lease')::uuid,'business_review') is not null then raise exception 'Daily creation cap was bypassed by deleting a task'; end if;
 profile:=get_record_business_research(agent_id,'lead',linked);
 if (profile->'business'->>'id')::uuid<>business then raise exception 'Existing profile lost shared research'; end if;
 update business_research_jobs set updated_at=clock_timestamp()-interval '1 day' where business_id=business;
 if finish_business_research_job(business,(job->>'lease')::uuid,(profile->'business'->>'updated_at')::timestamptz,
  '{"insights":[],"context":[],"coverage":[],"market_fit":null}',null) then raise exception 'Previous-day assessment was published after its date boundary'; end if;
 job:=claim_business_research_jobs(business)->0;
 begin
  perform finish_business_research_job(business,gen_random_uuid(),clock_timestamp(),'{}',null);
  raise exception 'Stale lease finished a research job';
 exception when sqlstate 'PT409' then null; end;
 perform finish_business_research_job(business,(job->>'lease')::uuid,(profile->'business'->>'updated_at')::timestamptz,null,'Synthetic research error');
 perform retry_business_research_job(owner_id,business);
 if not exists(select 1 from business_research_jobs where business_id=business and attempts=0 and state='pending') then raise exception 'Owner retry failed'; end if;
 insert into leads(id,full_name,address,agent_user_id,form_payload) values(existing,'Synthetic existing identity', '5 Existing Street, Tucson, AZ, 85701',agent_id,
  '{"profile":{"dot":{"number":"999999986"}}}');
 other_business:=retain_research_observation(agent_id,repeat('b',64),jsonb_set(jsonb_set(jsonb_set(observation,'{record_id}','"999999986"'),'{values,dot}','"999999986"'),'{values,name}','"Synthetic existing identity"'));
 perform retain_research_search(stranger,gen_random_uuid(),repeat('c',64),'{}',0,
  jsonb_build_array(jsonb_build_object('identity',repeat('b',64),'observation',
   jsonb_set(jsonb_set(jsonb_set(observation,'{record_id}','"999999986"'),'{values,dot}','"999999986"'),'{values,name}','"Synthetic existing identity"'))),'[]',false);
 if not exists(select 1 from business_research_links where business_id=other_business and lead_id=existing) then raise exception 'Search did not automatically link a strong existing identity'; end if;
 if get_business_research(stranger,other_business)->'linked_record'<>'null'::jsonb then raise exception 'Automatic matching disclosed an inaccessible CRM link'; end if;
 update business_research_jobs set actor_id=stranger where business_id=other_business;
 job:=claim_business_research_jobs(other_business)->0;
 if job->>'actor_id' is distinct from agent_id::text then raise exception 'Automatic matching did not hand processing to the responsible producer'; end if;
 if (save_research_business(agent_id,other_business)->>'id')::uuid<>existing then raise exception 'Existing full-book DOT match was duplicated'; end if;
 update business_research_sources set retained_rights=false,enabled=false where provider='fmcsa_census';
 begin
  perform get_business_research(agent_id,business);
  raise exception 'Withdrawn retained rights still exposed observations';
 exception when insufficient_privilege then null; end;
 if has_function_privilege('authenticated','public.save_research_business(uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.claim_business_research_jobs(uuid)','EXECUTE')
  or has_table_privilege('authenticated','public.business_research_observations','SELECT') then raise exception 'Browser can bypass business research API scopes'; end if;
end;
$test$;
rollback;
