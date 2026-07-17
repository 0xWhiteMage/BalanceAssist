import { sanitizeObservabilityData } from '@/lib/observability/sanitize';

type LogLevel = 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateRequestId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

function emit(level: LogLevel, tag: string, message: string, context?: LogContext, requestId?: string) {
  const prefix = `[${tag}]`;
  const entry: Record<string, unknown> = { ts: new Date().toISOString() };
  if (requestId) entry.rid = requestId;
  if (context) Object.assign(entry, sanitizeObservabilityData(context));

  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[method](prefix, message, entry);
}

export function createLogger(tag: string, requestId?: string) {
  const rid = requestId ?? generateRequestId();

  return {
    info(message: string, context?: LogContext) {
      emit('info', tag, message, context, rid);
    },
    warn(message: string, context?: LogContext) {
      emit('warn', tag, message, context, rid);
    },
    error(message: string, context?: LogContext) {
      emit('error', tag, message, context, rid);
    },
    requestId: rid
  };
}

export function extractRequestId(request: Request): string {
  const requestId = request.headers.get('x-request-id');
  return requestId && CANONICAL_UUID_PATTERN.test(requestId) ? requestId : generateRequestId();
}

export function extractClientRequestId(request: Request): string | null {
  const requestId = request.headers.get('x-request-id');
  return requestId && CANONICAL_UUID_PATTERN.test(requestId) ? requestId : null;
}
