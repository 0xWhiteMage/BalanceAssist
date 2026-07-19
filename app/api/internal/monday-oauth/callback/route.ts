import { NextResponse } from 'next/server';

import { completeMondayOAuthCallback } from '@/lib/monday/oauth';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    await completeMondayOAuthCallback(
      url.searchParams.get('code') ?? '',
      url.searchParams.get('state') ?? '',
      url.searchParams.get('status') ?? ''
    );
    return NextResponse.json({ ok: true, message: 'Monday connection installed' }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, error: 'Monday OAuth callback failed' }, { status: 400, headers: NO_STORE });
  }
}
