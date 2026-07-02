-- Capture contact name + company early on sessions
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/vbdqjgwcmckutwehrbvo/sql/new

alter table public.sessions
  add column if not exists contact_name text,
  add column if not exists contact_company text;