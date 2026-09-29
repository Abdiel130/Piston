/**
 * Sobre estándar de TODAS las respuestas de la API (ver ApiResponse en el
 * backend). El cliente decide por `code`, nunca por el texto de `message`.
 */

/** Catálogo de resultados. Mismos valores que el enum ApiCode del backend. */
export type ApiCode =
  | 'ok'
  | 'created'
  | 'bad_request'
  | 'validation_failed'
  | 'invalid_credentials'
  | 'unauthenticated'
  | 'refresh_invalid'
  | 'refresh_race'
  | 'client_header_missing'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'conflict'
  | 'payload_too_large'
  | 'too_many_requests'
  | 'parent_missing'
  | 'unknown_table'
  | 'server_error'
  | 'service_unavailable';

export interface ApiMeta {
  /** Mismo id que el header X-Request-Id y que los logs del servidor. */
  readonly request_id: string;
  readonly timestamp: string;
  readonly retry_after?: number | null;
  readonly [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly code: ApiCode;
  readonly message: string;
  readonly data: T;
  /** Solo en `validation_failed` / `invalid_credentials`: mensajes por campo. */
  readonly errors?: Readonly<Record<string, readonly string[]>>;
  readonly meta: ApiMeta;
}

/** Lo que trae `HttpErrorResponse.error` cuando la API respondió con su sobre. */
export type ApiErrorBody = ApiEnvelope<unknown> & { readonly success: false };

/** ¿El cuerpo de un error es el sobre de la API (y no HTML de un proxy, p. ej.)? */
export function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { success?: unknown }).success === false &&
    typeof (body as { code?: unknown }).code === 'string'
  );
}
