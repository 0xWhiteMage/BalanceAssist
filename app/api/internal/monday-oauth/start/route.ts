import { NextResponse } from 'next/server';

import { createMondayOAuthAttempt } from '@/lib/monday/oauth';
import { validateAdminRequest } from '@/lib/security/config';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const auth = validateAdminRequest(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: NO_STORE });
  try {
    const authorizeUrl = await createMondayOAuthAttempt();
    return NextResponse.json({ ok: true, authorizeUrl }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'Monday OAuth unavailable' }, { status: 503, headers: NO_STORE });
  }
}
