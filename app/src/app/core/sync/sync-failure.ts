import { ApiError, AuthRequiredError, PermanentApiError, RetriableApiError } from '../api/api.service';
import type { ApiCode, SyncAttempt, SyncFailureKind, SyncRejectedRow } from '../models';

/** Transitorios: se reintentan solos, sin límite de intentos. */
const TRANSIENT: ReadonlySet<SyncFailureKind> = new Set([
  'offline',
  'server_unreachable',
  'timeout',
  'server_error',
  'unavailable',
  'rate_limited',
  'endpoint_missing',
]);

export function isTransient(kind: SyncFailureKind): boolean {
  return TRANSIENT.has(kind);
}

/**
 * Convierte cualquier error de una petición en un intento diagnosticado.
 *
 * `online` viene de `navigator.onLine`: un status 0 con el dispositivo sin red
 * es "sin conexión"; con red, es que el servidor no contestó (caído, DNS,
 * CORS), que es un problema distinto y así se le explica al usuario.
 */
export function classify(error: unknown, online: boolean): SyncAttempt {
  const at = new Date().toISOString();

  if (!(error instanceof ApiError)) {
    return attempt(at, online ? 'client_bug' : 'offline', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const base = {
    http_status: error.status === 0 ? null : error.status,
    code: error.code,
    message: error.message,
    request_id: error.requestId,
    field_errors: error.errors,
    duration_ms: error.durationMs,
    retry_after_s: error.retryAfter,
  };

  return attempt(at, kindOf(error, online), base);
}

/** Un rechazo por fila dentro de un push que sí respondió 200. */
export function fromRejection(
  rejected: SyncRejectedRow,
  requestId: string,
  durationMs: number,
): SyncAttempt {
  return attempt(new Date().toISOString(), kindOfCode(rejected.code), {
    http_status: 200,
    code: rejected.code,
    message: rejected.message,
    request_id: requestId,
    field_errors: rejected.errors ?? null,
    duration_ms: durationMs,
  });
}

function kindOf(error: ApiError, online: boolean): SyncFailureKind {
  if (error instanceof AuthRequiredError) {
    return 'auth';
  }
  if (error.timedOut) {
    return 'timeout';
  }
  if (error.status === 0) {
    return online ? 'server_unreachable' : 'offline';
  }
  if (error instanceof RetriableApiError) {
    if (error.status === 429) return 'rate_limited';
    if (error.status === 404 || error.status === 501) return 'endpoint_missing';
    if (error.status === 408) return 'timeout';
    if (error.status === 502 || error.status === 503 || error.status === 504) return 'unavailable';
    return 'server_error';
  }
  if (error instanceof PermanentApiError) {
    if (error.status === 413) return 'payload_too_large';
    return error.code ? kindOfCode(error.code) : error.status === 403 ? 'forbidden' : 'validation';
  }
  return 'client_bug';
}

function kindOfCode(code: ApiCode): SyncFailureKind {
  switch (code) {
    case 'forbidden':
    case 'client_header_missing':
      return 'forbidden';
    case 'conflict':
      return 'conflict';
    case 'parent_missing':
      return 'parent_missing';
    case 'payload_too_large':
      return 'payload_too_large';
    case 'unknown_table':
      return 'client_bug';
    default:
      return 'validation';
  }
}

function attempt(
  at: string,
  kind: SyncFailureKind,
  fields: Partial<Omit<SyncAttempt, 'at' | 'kind'>> & { message: string },
): SyncAttempt {
  return {
    at,
    kind,
    http_status: null,
    code: null,
    request_id: null,
    field_errors: null,
    duration_ms: null,
    retry_after_s: null,
    ...fields,
  };
}
