-- Unread tracking for conversations: inbound messages are unread until viewed.
alter table if exists public.communication_log
  add column if not exists read_at timestamptz;

-- Start clean: everything that already exists is considered read.
update public.communication_log set read_at = coalesce(sent_at, now()) where read_at is null;

create index if not exists communication_log_unread_idx
  on public.communication_log (client_id) where read_at is null;
