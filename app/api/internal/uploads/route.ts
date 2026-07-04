import { jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { UPLOAD_BUCKET_NAME } from '@/lib/uploads/file-policy';

export async function GET(request: Request) {
  const setupToken = process.env.SETUP_TOKEN;
  if (setupToken) {
    const auth = request.headers.get('authorization') ?? '';
    const provided = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : auth;
    if (provided !== setupToken) {
      return jsonWithCors({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
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
    .select('id, session_id, storage_path, original_name, mime_type, size_bytes, created_at, sessions(status, contact_name, contact_company)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return jsonWithCors({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: number;
    session_id: string;
    storage_path: string;
    original_name: string;
    mime_type: string | null;
    size_bytes: number;
    created_at: string;
    sessions?: { status?: string; contact_name?: string | null; contact_company?: string | null } | null;
  }>;

  const signed = await Promise.all(
    rows.map(async (row) => {
      const { data: signedData } = await supabase.storage
        .from(UPLOAD_BUCKET_NAME)
        .createSignedUrl(row.storage_path, 60 * 60);

      return {
        id: row.id,
        sessionId: row.session_id,
        fileName: row.original_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        status: row.sessions?.status ?? null,
        contactName: row.sessions?.contact_name ?? null,
        contactCompany: row.sessions?.contact_company ?? null,
        downloadUrl: signedData?.signedUrl ?? null
      };
    })
  );

  return jsonWithCors({ ok: true, uploads: signed });
}
