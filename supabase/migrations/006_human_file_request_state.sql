-- Human support file-request state
-- Run in Supabase SQL editor

alter table public.sessions
  add column if not exists file_request_open boolean not null default false,
  add column if not exists file_request_note text;
