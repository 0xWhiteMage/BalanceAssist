import { NextResponse } from 'next/server';
import type { ZodSchema } from 'zod';
import { isAllowedOrigin } from '@/lib/security/origin';

type CorsSource = Request | string | null | undefined;

function resolveOrigin(source: CorsSource): string | null {
  if (typeof source === 'string' || source === null) {
    return source;
  }

  if (!source) {
    return null;
  }

  return source.headers.get('origin');
}

function buildCorsHeaders(source: CorsSource): Record<string, string> {
  const origin = resolveOrigin(source);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-session-capability',
    'Vary': 'Origin'
  };

  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export function corsOptionsResponse(source: CorsSource = null) {
  return new NextResponse(null, { status: 204, headers: buildCorsHeaders(source) });
}

export function jsonWithCors(body: unknown, init?: ResponseInit, source: CorsSource = null) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...buildCorsHeaders(source)
    }
  });
}

export async function readJsonBodyLimited(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: unknown } | { ok: false; tooLarge: boolean }> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    return { ok: false, tooLarge: true };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, tooLarge: false };

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { ok: false, tooLarge: false };
  }
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
      response: jsonWithCors({ error: 'Invalid JSON body' }, { status: 400 }, request)
    };
  }

  const result = schema.safeParse(json);

  if (!result.success) {
    return {
      ok: false,
      response: jsonWithCors(
        { error: 'Invalid request payload', issues: result.error.issues },
        { status: 400 },
        request
      )
    };
  }

  return { ok: true, data: result.data };
}
