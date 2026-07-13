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

The validation query must return exactly one row with `public = false`. Until it does, the upload API returns `file_uploads_unavailable` and the upload selector remains disabled. Service-role server code is the only writer; do not add browser policies or public URLs for this bucket.
