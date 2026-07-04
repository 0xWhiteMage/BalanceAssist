-- Uploaded file metadata for Balance Assist

create table if not exists public.uploaded_files (
  id bigserial primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  mime_type text,
  size_bytes bigint not null,
  telegram_message_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists uploaded_files_session_id_idx on public.uploaded_files (session_id);
create index if not exists uploaded_files_created_at_idx on public.uploaded_files (created_at desc);
