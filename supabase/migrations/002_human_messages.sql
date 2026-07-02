-- Human handoff messages
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/vbdqjgwcmckutwehrbvo/sql/new

create table if not exists public.human_messages (
  id bigserial primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  sender text not null check (sender in ('user', 'team')),
  text text not null,
  telegram_message_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists human_messages_session_id_idx on public.human_messages (session_id);
create index if not exists human_messages_session_id_id_idx on public.human_messages (session_id, id);
create index if not exists human_messages_telegram_message_id_idx on public.human_messages (telegram_message_id);