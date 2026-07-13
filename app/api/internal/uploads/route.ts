import { jsonWithCors } from '@/lib/api/route-helpers';
import { validateAdminRequest } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { UPLOAD_BUCKET_NAME } from '@/lib/uploads/file-policy';

export async function GET(request: Request) {
  const authResult = validateAdminRequest(request);
  if (!authResult.ok) {
    return jsonWithCors({ ok: false, error: authResult.error }, { status: authResult.status });
  }

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return jsonWithCors({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('uploaded_files')
    .select('id, session_id, storage_path, name, original_name, mime, mime_type, size_bytes, status, created_at, sessions(status, contact_name, contact_company)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return jsonWithCors({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: number;
    session_id: string;
    storage_path: string | null;
    name?: string | null;
    original_name?: string | null;
    mime?: string | null;
    mime_type?: string | null;
    status?: string | null;
    size_bytes: number;
    created_at: string;
    sessions?: { status?: string; contact_name?: string | null; contact_company?: string | null } | null;
  }>;

  const signed = await Promise.all(
    rows.map(async (row) => {
      const signedData = row.storage_path
        ? (await supabase.storage
            .from(UPLOAD_BUCKET_NAME)
            .createSignedUrl(row.storage_path, 60 * 60)).data
        : null;

      return {
        id: row.id,
        sessionId: row.session_id,
        fileName: row.original_name ?? row.name ?? '',
        mimeType: row.mime_type ?? row.mime ?? null,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        status: row.sessions?.status ?? null,
        uploadStatus: row.status ?? null,
        contactName: row.sessions?.contact_name ?? null,
        contactCompany: row.sessions?.contact_company ?? null,
        downloadUrl: signedData?.signedUrl ?? null
      };
    })
  );

  return jsonWithCors({ ok: true, uploads: signed });
}
