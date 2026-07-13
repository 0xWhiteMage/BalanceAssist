# Private Attachment Storage Setup

Migration `029_private_attachment_storage.sql` creates the `temporary-attachments` bucket when the Supabase `storage` schema is available. It is safe to rerun: the bucket is upserted and forced private.

If the migration runner cannot access the Supabase `storage` schema, run this idempotent SQL in the Supabase SQL Editor, then set `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` in the server environment:

```sql
insert into storage.buckets (id, name, public)
values ('temporary-attachments', 'temporary-attachments', false)
on conflict (id) do update set public = false;

select id, public
from storage.buckets
where id = 'temporary-attachments';
```

The validation query must return exactly one row with `public = false`. Migration `033_private_attachment_live_attestation.sql` checks the bucket, browser-role policies, and grants at upload time; any drift disables uploads. Service-role server code is the only writer; do not add browser policies or public URLs for this bucket. Files are temporarily retained solely to analyse the current draft and are never sent to the Balance team or Telegram.
