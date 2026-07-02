import { NextResponse } from 'next/server';
import type { ZodSchema } from 'zod';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export function corsOptionsResponse() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export function jsonWithCors(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...corsHeaders
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
