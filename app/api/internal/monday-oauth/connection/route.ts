import { NextResponse } from 'next/server';

import { disconnectMondayOAuthConnection } from '@/lib/monday/oauth';
import { validateAdminRequest } from '@/lib/security/config';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function DELETE(request: Request) {
  const auth = validateAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: NO_STORE });
  try {
    await disconnectMondayOAuthConnection();
    return NextResponse.json({ ok: true, message: 'Monday connection revoked' }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'Monday OAuth revocation unavailable' }, { status: 503, headers: NO_STORE });
  }
}
