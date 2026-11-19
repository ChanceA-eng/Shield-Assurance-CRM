begin;

create table if not exists public.instantly_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'creating'
    check (status in ('creating','setup_failed','creation_unknown','ready','starting','activation_unknown','active','pausing','pause_unknown','paused','completed')),
  provider_campaign_id text unique,
  provider_webhook_id text,
  sender_accounts text[] not null default '{}',
  daily_limit integer not null check (daily_limit between 1 and 50),
  steps jsonb not null default '[]'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.instantly_campaign_leads (
  campaign_id uuid not null references public.instantly_campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  email text not null,
  draft_subject text not null,
  draft_body text not null,
  cited_signals jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','synced','reply_received','interested','not_interested','meeting_booked','out_of_office','wrong_person','unsubscribed','bounced','failed','acceptance_unknown')),
  provider_lead_id text,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, lead_id)
);

create index if not exists instantly_campaign_leads_email_idx
  on public.instantly_campaign_leads (lower(email), status);

create table if not exists public.instantly_webhook_events (
  event_key text primary key,
  campaign_id uuid not null references public.instantly_campaigns(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  event_type text not null,
  received_at timestamptz not null default now()
);

create function public.record_instantly_campaign_event(
  p_event_key text,
  p_campaign_id uuid,
  p_lead_id uuid,
  p_event_type text,
  p_email text,
  p_email_account text,
  p_subject text,
  p_body text,
  p_event_at timestamptz,
  p_provider_message_id text
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  inserted_count integer;
  lead_account uuid;
  inbound jsonb;
  message_id uuid;
  interest_key text;
begin
  if p_event_key !~ '^[a-f0-9]{64}$' or p_event_type is null or length(p_event_type)>80 then
    raise exception 'Invalid Instantly event identity.' using errcode='22023';
  end if;
  if p_lead_id is not null and not exists(
    select 1 from instantly_campaign_leads
    where campaign_id=p_campaign_id and lead_id=p_lead_id
      and (p_email is null or lower(email)=lower(p_email))
  ) then
    raise exception 'Instantly event does not match a campaign lead.' using errcode='22023';
  end if;
  insert into instantly_webhook_events(event_key,campaign_id,lead_id,event_type)
    values(p_event_key,p_campaign_id,p_lead_id,p_event_type) on conflict(event_key) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count=0 then return false; end if;

  if p_lead_id is null then return true; end if;

  update instantly_campaign_leads set
    status=case p_event_type
      when 'reply_received' then 'reply_received'
      when 'lead_interested' then 'interested'
      when 'lead_not_interested' then 'not_interested'
      when 'lead_meeting_booked' then 'meeting_booked'
      when 'lead_meeting_completed' then 'meeting_booked'
      when 'lead_out_of_office' then 'out_of_office'
      when 'lead_wrong_person' then 'wrong_person'
      when 'lead_unsubscribed' then 'unsubscribed'
      when 'email_bounced' then 'bounced'
      else status
    end,
    updated_at=now()
    where campaign_id=p_campaign_id and lead_id=p_lead_id;

  if p_event_type='reply_received' and p_email is not null then
    select account_id into lead_account from leads where id=p_lead_id;
    inbound:=public.ingest_inbound_message(
      'instantly:'||p_event_key,lead_account,p_lead_id,'email',p_email,p_email_account,
      p_subject,coalesce(p_body,'Reply received via Instantly. Review the conversation in the CRM or Instantly.'),
      p_event_at,p_provider_message_id
    );
    message_id:=(inbound->>'id')::uuid;
    perform public.process_outreach_reply(lead_account,p_email,null,coalesce(p_body,''),message_id);
  elsif p_event_type='lead_unsubscribed' and p_email is not null then
    perform public.unsubscribe_marketing_email(p_email,'Unsubscribed through Instantly.');
  elsif p_event_type='email_bounced' and p_email is not null then
    insert into email_suppressions(email,reason)
      values(lower(trim(p_email)),'instantly_email_bounced') on conflict(email) do nothing;
    perform public.process_outreach_reply(null,p_email,null,'unsubscribe',null);
  elsif p_event_type='lead_interested' then
    select account_id into lead_account from leads where id=p_lead_id;
    interest_key:='instantly:interest:'||p_campaign_id::text||':'||p_lead_id::text;
    insert into tasks(subject,description,due_date,status,priority,related_type,related_id,account_id,automation_key,action_href,action_category)
      select 'Warm prospect: '||l.full_name,
        'Instantly marked this prospect interested. Review the conversation and follow up personally.',
        now()+interval '2 hours','open','high','lead',l.id,lead_account,interest_key,
        '/leads?lead='||l.id::text,'reply'
      from leads l where l.id=p_lead_id
      on conflict(automation_key) where automation_key is not null do nothing;
    insert into notifications(client_id,type,message,href,read,automation_key)
      select lead_account,'outreach',l.full_name||' is interested - follow up personally.',
        '/leads?lead='||l.id::text,false,interest_key
      from leads l where l.id=p_lead_id
      on conflict(automation_key) where automation_key is not null do nothing;
  end if;
  return true;
end;
$$;

alter table public.instantly_campaigns enable row level security;
alter table public.instantly_campaign_leads enable row level security;
alter table public.instantly_webhook_events enable row level security;
revoke all on public.instantly_campaigns,public.instantly_campaign_leads,public.instantly_webhook_events from public,anon,authenticated;
grant all on public.instantly_campaigns,public.instantly_campaign_leads,public.instantly_webhook_events to service_role;
revoke all on function public.record_instantly_campaign_event(text,uuid,uuid,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_instantly_campaign_event(text,uuid,uuid,text,text,text,text,text,timestamptz,text) to service_role;

commit;
