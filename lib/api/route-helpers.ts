import { NextResponse } from 'next/server';
import type { ZodSchema } from 'zod';
import { isAllowedOrigin, getAllowedOrigins } from '@/lib/security/origin';

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };

  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin!;
  } else {
    headers['Access-Control-Allow-Origin'] = getAllowedOrigins()[0];
  }

  return headers;
}

export function corsOptionsResponse(origin: string | null = null) {
  return new NextResponse(null, { status: 204, headers: buildCorsHeaders(origin) });
}

export function jsonWithCors(body: unknown, init?: ResponseInit, origin: string | null = null) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...buildCorsHeaders(origin)
    }
  });
}

export async function parseRequestBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let json: unknown;

  try {
    json = await request.json();
  } catch {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Invalid JSON body' }, { status: 400 })
    };
  }

  const result = schema.safeParse(json);

  if (!result.success) {
    return {
      ok: false,
      response: jsonWithCors(
        { error: 'Invalid request payload', issues: result.error.issues },
        { status: 400 }
      )
    };
  }

  return { ok: true, data: result.data };
}
