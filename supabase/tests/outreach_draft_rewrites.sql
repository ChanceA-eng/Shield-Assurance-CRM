begin;
do $test$
declare
  l uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
  revision integer; original_cap integer;
begin
  select daily_send_cap into original_cap from outreach_settings where id=1;
  update outreach_settings set daily_send_cap=200000 where id=1;
  insert into leads(id,full_name,email,status) values(l,'Rewrite QA','rewrite-qa@example.invalid','new');
  if to_regclass('public.resend_send_attempts') is not null then
    insert into marketing_email_consents(email,source,consented_at) values('rewrite-qa@example.invalid','Fixture explicit opt-in',now())
      on conflict(email) do update set revoked_at=null;
  end if;
  insert into outreach_outbox(id,lead_id,step_number,to_email,subject,body,cited_signals)
    values(o,l,1,'rewrite-qa@example.invalid','Original','Original body','["Recorded fact"]');
  revision:=rewrite_outreach_draft(o,actor,0,'Revised','Revised body','["Recorded fact"]');
  if revision<>1 or not exists(select 1 from outreach_outbox where id=o and subject='Revised'
    and body='Revised body' and draft_revision=1 and requires_manual_approval
    and status='pending_approval' and sent_at is null) then raise exception 'Rewrite was not persisted for review'; end if;
  begin
    perform rewrite_outreach_draft(o,actor,0,'Stale','Stale body','["Recorded fact"]');
    raise exception 'Stale rewrite accepted';
  exception when sqlstate 'PT409' then null; end;
  if claim_outreach_send(o,'Automatic','Automatic body') then raise exception 'Rewrite automatically sent'; end if;
  if claim_outreach_send(o,'Stale approval','Stale body',0) then raise exception 'Stale approval accepted'; end if;
  if not claim_outreach_send(o,'Approved','Approved body',1) then raise exception 'Current approval rejected'; end if;
  begin
    perform rewrite_outreach_draft(o,actor,1,'Too late','Too late body','["Recorded fact"]');
    raise exception 'Sending draft rewritten';
  exception when sqlstate 'PT409' then null; end;
  if exists(select 1 from communication_log where metadata->>'outbox_id'=o::text) then raise exception 'Rewrite sent or logged an email'; end if;
  if has_function_privilege('authenticated','public.rewrite_outreach_draft(uuid,uuid,integer,text,text,jsonb)','execute')
    or has_function_privilege('anon','public.claim_outreach_send(uuid,text,text,integer)','execute') then
    raise exception 'Private rewrite/send RPC exposed'; end if;
  update outreach_settings set daily_send_cap=original_cap where id=1;
end;
$test$;
rollback;
