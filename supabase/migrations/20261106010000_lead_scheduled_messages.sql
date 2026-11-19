begin;

alter table public.scheduled_messages
  add column lead_id uuid references public.leads(id) on delete cascade;
create index scheduled_messages_lead_send_idx
  on public.scheduled_messages(lead_id, send_at);

alter table public.scheduled_messages drop constraint scheduled_messages_status_check;
alter table public.scheduled_messages add constraint scheduled_messages_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled'));

notify pgrst, 'reload schema';
commit;
