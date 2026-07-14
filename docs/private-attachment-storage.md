# Private Attachment Storage Setup

Database migrations do not create or manage the `temporary-attachments` Storage bucket. Create the bucket through the Supabase Storage API or Dashboard with public access disabled, then set `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` in the server environment.

Do not use SQL to create, alter, delete, grant access to, or add policies for `storage` relations. In particular, browser Storage policies are prohibited for this bucket. Service-role server code is the only writer, and the bucket must never expose public URLs.

Readiness is a read-only attestation: `private_attachment_storage_is_ready('temporary-attachments')` confirms that the expected bucket exists, is non-public, has Storage object RLS enabled, and has no browser-role policy. Any failed attestation disables uploads. Files are temporarily retained for up to 24 hours solely to analyse the current same-browser draft and are never sent to the Balance team or Telegram.
