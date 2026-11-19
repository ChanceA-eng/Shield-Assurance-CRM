begin;

create or replace function public.record_resend_event(p_event_id text,p_provider_id text,p_type text,p_occurred_at timestamptz,p_attempt_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare attempt public.resend_send_attempts%rowtype;
begin
  if p_type not in ('email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed','email.opened')
    then raise exception 'Unsupported email event.' using errcode='22023'; end if;
  select * into attempt from resend_send_attempts where provider_id=p_provider_id or id=p_attempt_id for update;
  if not found then return; end if;
  if attempt.provider_id is not null and attempt.provider_id<>p_provider_id
    then raise exception 'Email receipt does not match this send.' using errcode='22023'; end if;
  insert into resend_delivery_events(event_id,attempt_id,type,occurred_at)
    values(p_event_id,attempt.id,p_type,p_occurred_at) on conflict do nothing;
  if not found then return; end if;
  update resend_send_attempts set status='accepted',provider_id=p_provider_id where id=attempt.id;
  if p_type in ('email.bounced','email.complained','email.suppressed') then
    insert into email_suppressions(email,reason) values(attempt.to_email,p_type) on conflict(email) do nothing;
    perform public.process_outreach_reply(null,attempt.to_email,null,'unsubscribe',null);
  end if;
  update outreach_outbox set status='accepted_by_provider',provider='resend',sent_at=coalesce(sent_at,attempt.created_at),error=null
    where 'outreach:'||id::text=attempt.request_key and status in ('sending','acceptance_unknown');
end;
$$;

commit;
