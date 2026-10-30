-- Ensure realtime change events flow for the live badge and notification feed.
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;
