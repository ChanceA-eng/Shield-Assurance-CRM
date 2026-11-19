begin;
do $test$
declare
  actor uuid:=gen_random_uuid();
  prospect uuid:=gen_random_uuid();
  campaign uuid:=gen_random_uuid();
  address text:='instantly-'||prospect||'@example.invalid';
  reply_key text:=repeat('a',64);
  interest_key text:=repeat('b',64);
  work_key text:='instantly:interest:'||campaign||':'||prospect;
begin
  insert into auth.users(id,email,email_confirmed_at)
    values(actor,'instantly-owner-'||actor||'@example.invalid',now());
  insert into leads(id,full_name,email,status,business)
    values(prospect,'Instantly fixture prospect',address,'new','Fixture contractor');
  insert into instantly_campaigns(id,created_by,name,daily_limit)
    values(campaign,actor,'Fixture campaign',5);
  insert into instantly_campaign_leads(campaign_id,lead_id,email,draft_subject,draft_body)
    values(campaign,prospect,address,'Fixture subject','Fixture body');
  if has_table_privilege('authenticated','public.instantly_campaigns','SELECT')
    or has_table_privilege('anon','public.instantly_campaign_leads','SELECT')
    or has_function_privilege('authenticated','public.record_instantly_campaign_event(text,uuid,uuid,text,text,text,text,text,timestamptz,text)','EXECUTE') then
    raise exception 'Private campaign access was exposed';
  end if;
  perform record_instantly_campaign_event(reply_key,campaign,prospect,'reply_received',address,
    'sender@example.invalid','Re: fixture','Please send details.',now(),'fixture-reply');
  if exists(select 1 from tasks where automation_key=work_key) then
    raise exception 'Generic reply generated a warm-prospect task';
  end if;
  if record_instantly_campaign_event(reply_key,campaign,prospect,'reply_received',address,
    null,null,'Please send details.',now(),'fixture-reply') then
    raise exception 'Duplicate reply was accepted';
  end if;
  if (select count(*) from communication_log where inbound_event_key='instantly:'||reply_key)<>1 then
    raise exception 'Reply was not recorded exactly once';
  end if;
  perform record_instantly_campaign_event(interest_key,campaign,prospect,'lead_interested',address,
    null,null,null,now(),null);
  perform record_instantly_campaign_event(repeat('c',64),campaign,prospect,'lead_interested',address,
    null,null,null,now(),null);
  if (select count(*) from tasks where automation_key=work_key)<>1
    or (select count(*) from notifications where automation_key=work_key)<>1 then
    raise exception 'Interest must create exactly one task and notification';
  end if;
  perform record_instantly_campaign_event(repeat('d',64),campaign,prospect,'lead_unsubscribed',address,
    null,null,null,now(),null);
  if not exists(select 1 from outreach_opt_outs where email=address) then
    raise exception 'Unsubscribe did not suppress the address';
  end if;
  perform record_instantly_campaign_event(repeat('e',64),campaign,prospect,'email_bounced',address,
    null,null,null,now(),null);
  if not exists(select 1 from email_suppressions where email=address) then
    raise exception 'Bounce did not suppress the address';
  end if;
  begin
    perform record_instantly_campaign_event(repeat('f',64),campaign,prospect,'reply_received',
      'wrong@example.invalid',null,null,null,now(),null);
    raise exception 'Mismatched recipient was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$test$;
rollback;
