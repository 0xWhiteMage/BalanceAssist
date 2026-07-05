-- Schedule request state for /schedule command
-- Run in Supabase SQL editor

alter table public.sessions
  add column if not exists schedule_request_open boolean not null default false;
