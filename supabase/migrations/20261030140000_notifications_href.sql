-- Actionable notifications: each item can deep-link to the thing it's about.
alter table if exists public.notifications
  add column if not exists href text;
