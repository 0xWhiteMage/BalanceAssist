-- Balance Assist full schema (consolidated)
-- Run once in Supabase SQL editor: https://supabase.com/dashboard/project/vbdqjgwcmckutwehrbvo/sql/new

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  referrer text,
  utm jsonb,
  status text not null default 'open' check (status in ('open', 'completed', 'escalated', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_created_at_idx on public.sessions (created_at desc);
create index if not exists sessions_status_idx on public.sessions (status);

create table if not exists public.events (
  id bigserial primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  event_name text not null,
  properties jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_session_id_idx on public.events (session_id);
create index if not exists events_event_name_idx on public.events (event_name);
create index if not exists events_created_at_idx on public.events (created_at desc);

create table if not exists public.leads (
  id bigserial primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  qualification_status text not null check (qualification_status in ('qualified', 'needs_review', 'misfit', 'unqualified')),
  lead_draft jsonb not null,
  contact_name text,
  contact_email text,
  score integer,
  recommended_next_step text,
  created_at timestamptz not null default now()
);

create index if not exists leads_session_id_idx on public.leads (session_id);
create index if not exists leads_qualification_status_idx on public.leads (qualification_status);
create index if not exists leads_contact_email_idx on public.leads (contact_email);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

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

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
before update on public.sessions
for each row execute function public.set_updated_at();