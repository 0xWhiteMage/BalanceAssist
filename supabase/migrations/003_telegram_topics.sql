-- Telegram forum topic support
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/vbdqjgwcmckutwehrbvo/sql/new

alter table public.sessions
  add column if not exists telegram_thread_id bigint;

create unique index if not exists sessions_telegram_thread_id_idx
  on public.sessions (telegram_thread_id)
  where telegram_thread_id is not null;

alter table public.human_messages
  add column if not exists telegram_thread_id bigint;

create index if not exists human_messages_telegram_thread_id_idx
  on public.human_messages (telegram_thread_id)
  where telegram_thread_id is not null;