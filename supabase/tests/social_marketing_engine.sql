begin;
do $test$
declare actor uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); post_id uuid:=gen_random_uuid();
  intent uuid:=gen_random_uuid(); retry_id uuid:=gen_random_uuid(); uncertain_id uuid:=gen_random_uuid(); crash_id uuid:=gen_random_uuid();
  result jsonb; lease uuid; version integer; scenario text;
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (actor,'social-engine-agent-'||actor||'@example.invalid',now()),(reviewer,'social-engine-admin-'||reviewer||'@example.invalid',now());
  insert into agency_members(user_id,email,role) select id,email,case when id=reviewer then 'admin' else 'agent' end from auth.users where id in(actor,reviewer);
  perform save_social_draft(actor,post_id,'create','Engine test','Review your coverage.');
  begin
    perform command_social_engine(actor,jsonb_build_object('action','prepare','id',intent,'post_id',post_id,'revision',1,'scenario','success'));
    raise exception 'Unapproved content accepted';
  exception when sqlstate 'PT409' then null; end;
  perform review_social_draft(actor,post_id,'submit',1,0);
  perform review_social_draft(reviewer,post_id,'approve',1,1);
  result:=command_social_engine(actor,jsonb_build_object('action','prepare','id',intent,'post_id',post_id,'revision',1,'scenario','success'));
  if result->>'state'<>'awaiting_approval' then raise exception 'Destination not gated'; end if;
  begin
    perform command_social_engine(actor,jsonb_build_object('action','approve','id',intent,'expected_version',1));
    raise exception 'Agent approved destination';
  exception when insufficient_privilege then null; end;
  perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',intent,'expected_version',1));
  perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',intent,'expected_version',2,'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  if claim_social_intent(intent,3) is not null then raise exception 'Paused worker dispatched'; end if;
  perform command_social_engine(reviewer,'{"action":"pause","paused":false}'::jsonb);
  if not exists(select 1 from jsonb_array_elements(reconcile_social_engine()) j where j->>'id'=intent::text) then raise exception 'Lost queue not restored'; end if;
  result:=claim_social_intent(intent,3); lease:=(result->>'lease_id')::uuid;
  if result is null or claim_social_intent(intent,3) is not null then raise exception 'Duplicate claim'; end if;
  if not start_social_intent(intent,lease) or start_social_intent(intent,lease) then raise exception 'Duplicate start'; end if;
  result:=command_social_engine(actor,jsonb_build_object('action','prepare','id',intent,'post_id',post_id,'revision',1,'scenario','success'));
  if result ? 'lease_id' or result ? 'lease_until' then raise exception 'Prepare replay exposed worker lease'; end if;
  if (list_social_engine(actor)#>>'{intents,0,title}')<>'Engine test' then raise exception 'Calendar missing immutable revision title'; end if;
  begin
    perform command_social_engine(actor,jsonb_build_object('action','cancel','id',intent,'expected_version',4));
    raise exception 'Inflight cancellation pretended successful';
  exception when sqlstate 'PT409' then null; end;
  result:=execute_social_test(intent,lease);
  if execute_social_test(intent,lease)<>result then raise exception 'Test adapter acceptance not idempotent'; end if;
  begin
    perform finish_social_intent(intent,lease,'retry');
    raise exception 'Accepted dispatch scheduled retry';
  exception when sqlstate 'PT409' then null; end;
  if not finish_social_intent(intent,lease,result->>'outcome') then raise exception 'Finish failed'; end if;
  if (select state from social_intents where id=intent)<>'simulated' or (select count(*) from social_test_receipts where intent_id=intent)<>1 then raise exception 'Receipt missing'; end if;
  if finish_social_intent(intent,lease,'accepted') then raise exception 'Stale finish accepted'; end if;

  perform command_social_engine(reviewer,jsonb_build_object('action','prepare','id',retry_id,'post_id',post_id,'revision',1,'scenario','retry_once'));
  perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',retry_id,'expected_version',1));
  perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',retry_id,'expected_version',2,'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  result:=claim_social_intent(retry_id,3); lease:=(result->>'lease_id')::uuid;
  perform start_social_intent(retry_id,lease);
  result:=execute_social_test(retry_id,lease);
  perform finish_social_intent(retry_id,lease,result->>'outcome');
  if (select state from social_intents where id=retry_id)<>'retry_wait' or exists(select 1 from social_test_receipts where intent_id=retry_id) then raise exception 'Unsafe retry'; end if;
  if (select scheduled_at from social_intents where id=retry_id) not between clock_timestamp()+interval '29 seconds' and clock_timestamp()+interval '35 seconds' then raise exception 'Retry backoff outside bound'; end if;
  update social_intents set scheduled_at=clock_timestamp()-interval '1 second' where id=retry_id;
  result:=claim_social_intent(retry_id,5); lease:=(result->>'lease_id')::uuid;
  perform start_social_intent(retry_id,lease);
  perform finish_social_intent(retry_id,lease,execute_social_test(retry_id,lease)->>'outcome');
  if (select state from social_intents where id=retry_id)<>'simulated' then raise exception 'Retry failed'; end if;

  perform command_social_engine(reviewer,jsonb_build_object('action','prepare','id',uncertain_id,'post_id',post_id,'revision',1,'scenario','uncertain'));
  perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',uncertain_id,'expected_version',1));
  perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',uncertain_id,'expected_version',2,'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  result:=claim_social_intent(uncertain_id,3); lease:=(result->>'lease_id')::uuid;
  perform start_social_intent(uncertain_id,lease);
  perform finish_social_intent(uncertain_id,lease,execute_social_test(uncertain_id,lease)->>'outcome');
  if (select state from social_intents where id=uncertain_id)<>'confirming' then raise exception 'Acceptance timeout retried blindly'; end if;
  if exists(select 1 from social_outbox where intent_id=uncertain_id) then raise exception 'Manual uncertainty spins queue'; end if;
  if claim_social_intent(uncertain_id,5) is not null then raise exception 'Uncertain intent retried'; end if;
  perform command_social_engine(reviewer,jsonb_build_object('action','confirm','id',uncertain_id,'expected_version',5));
  if (select state from social_intents where id=uncertain_id)<>'simulated' then raise exception 'Receipt confirmation failed'; end if;

  perform command_social_engine(reviewer,jsonb_build_object('action','prepare','id',crash_id,'post_id',post_id,'revision',1,'scenario','success'));
  perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',crash_id,'expected_version',1));
  perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',crash_id,'expected_version',2,'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  result:=claim_social_intent(crash_id,3); lease:=(result->>'lease_id')::uuid;
  perform start_social_intent(crash_id,lease); perform execute_social_test(crash_id,lease);
  update social_intents set lease_until=clock_timestamp()-interval '1 second' where id=crash_id;
  perform reconcile_social_engine(); perform claim_social_intent(crash_id,5);
  if (select state from social_intents where id=crash_id)<>'simulated' or (select count(*) from social_attempts where intent_id=crash_id)<>1 then raise exception 'Accepted crash duplicated'; end if;
  if exists(select 1 from social_attempts where intent_id=crash_id and finished_at is null) then raise exception 'Expired attempt history unfinished'; end if;

  for scenario in select unnest(array['success','permanent_failure']) loop
    intent:=gen_random_uuid();
    perform command_social_engine(reviewer,jsonb_build_object('action','prepare','id',intent,'post_id',post_id,'revision',1,'scenario',scenario));
    perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',intent,'expected_version',1));
    perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',intent,'expected_version',2,'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
    result:=claim_social_intent(intent,3); lease:=(result->>'lease_id')::uuid;
    perform command_social_engine(reviewer,'{"action":"pause","paused":true}'::jsonb);
    if start_social_intent(intent,lease) or (select attempt_count from social_intents where id=intent)<>0 then raise exception 'Pause consumed dispatch attempt'; end if;
    perform command_social_engine(reviewer,'{"action":"pause","paused":false}'::jsonb);
    result:=claim_social_intent(intent,5); lease:=(result->>'lease_id')::uuid;
    update social_intents set lease_until=clock_timestamp()-interval '1 second' where id=intent;
    perform reconcile_social_engine();
    if (select attempt_count from social_intents where id=intent)<>0 then raise exception 'Prestart crash consumed budget'; end if;
    result:=claim_social_intent(intent,7); lease:=(result->>'lease_id')::uuid;
    perform start_social_intent(intent,lease);
    perform finish_social_intent(intent,lease,execute_social_test(intent,lease)->>'outcome');
    if (select state from social_intents where id=intent)<>(case when scenario='success' then 'simulated' else 'failed' end) then raise exception 'Unexpected terminal outcome'; end if;
    if scenario='permanent_failure' then
      for version in select unnest(array[9,12]) loop
        perform command_social_engine(reviewer,jsonb_build_object('action','retry','id',intent,'expected_version',version));
        result:=claim_social_intent(intent,version+1); lease:=(result->>'lease_id')::uuid;
        perform start_social_intent(intent,lease);
        perform finish_social_intent(intent,lease,execute_social_test(intent,lease)->>'outcome');
      end loop;
      begin
        perform command_social_engine(reviewer,jsonb_build_object('action','retry','id',intent,'expected_version',15));
        raise exception 'Retry budget unlimited';
      exception when sqlstate 'PT409' then null; end;
    end if;
  end loop;

  intent:=gen_random_uuid();
  perform command_social_engine(reviewer,jsonb_build_object('action','prepare','id',intent,'post_id',post_id,'revision',1,'scenario','success'));
  begin
    perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',intent,'expected_version',null));
    raise exception 'Null concurrency bypassed';
  exception when sqlstate 'PT409' then null; end;
  perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',intent,'expected_version',1));
  perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',intent,'expected_version',2,'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  update agency_members set active=false where user_id=reviewer;
  result:=claim_social_intent(intent,3);
  if result is not null or (select state from social_intents where id=intent)<>'blocked' then raise exception 'Revoked destination reviewer dispatched'; end if;
  update agency_members set active=true where user_id=reviewer;

  intent:=gen_random_uuid();
  perform command_social_engine(actor,jsonb_build_object('action','prepare','id',intent,'post_id',post_id,'revision',1,'scenario','success'));
  perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',intent,'expected_version',1));
  perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',intent,'expected_version',2,'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  perform command_social_engine(actor,jsonb_build_object('action','cancel','id',intent,'expected_version',3));
  if claim_social_intent(intent,3) is not null then raise exception 'Canceled stale job executed'; end if;
  if (select created_by from social_intents where id=intent)<>actor
    or not exists(select 1 from social_intent_events e where e.intent_id=intent and e.version=2 and e.actor_id=reviewer) then raise exception 'Creator or reviewer audit corrupted'; end if;

  intent:=gen_random_uuid();
  perform command_social_engine(reviewer,jsonb_build_object('action','prepare','id',intent,'post_id',post_id,'revision',1,'scenario','success'));
  perform command_social_engine(reviewer,jsonb_build_object('action','approve','id',intent,'expected_version',1));
  perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',intent,'expected_version',2,'scheduled_at',clock_timestamp(),'timezone','America/Phoenix'));
  perform command_social_engine(reviewer,jsonb_build_object('action','schedule','id',intent,'expected_version',3,'scheduled_at',clock_timestamp()+interval '1 hour','timezone','America/Phoenix'));
  if claim_social_intent(intent,3) is not null then raise exception 'Obsolete job dispatched'; end if;
  perform save_social_draft(actor,post_id,'update','Engine test','Review your coverage.',1);
  if (select state from social_intents where id=intent)<>'scheduled' then raise exception 'Noop invalidated destination'; end if;
  perform save_social_draft(actor,post_id,'update','Engine test','Changed content',1);
  if (select state from social_intents where id=intent)<>'blocked' or exists(select 1 from social_outbox where intent_id=intent) then raise exception 'Edit retained destination approval'; end if;
  if has_function_privilege('service_role','public.execute_social_test(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.command_social_engine(uuid,jsonb)','execute')
    or has_table_privilege('service_role','public.social_intents','update') then raise exception 'Worker authority exposed'; end if;
end;
$test$;
rollback;
