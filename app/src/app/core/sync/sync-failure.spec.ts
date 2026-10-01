import { describe, expect, it } from 'vitest';
import { AuthRequiredError, PermanentApiError, RetriableApiError } from '../api/api.service';
import { classify, fromRejection, isTransient } from './sync-failure';

describe('classify', () => {
  it('distingue "sin conexión" de "el servidor no respondió"', () => {
    const error = new RetriableApiError('Http failure', 0, { requestId: 'r1' });

    expect(classify(error, false).kind).toBe('offline');
    expect(classify(error, true)).toMatchObject({ kind: 'server_unreachable', request_id: 'r1', http_status: null });
  });

  it('un timeout conserva el request id aunque no haya respuesta', () => {
    const error = new RetriableApiError('tarde', 0, { requestId: 'r2', timedOut: true, durationMs: 30_000 });

    expect(classify(error, true)).toMatchObject({ kind: 'timeout', request_id: 'r2', duration_ms: 30_000 });
  });

  it.each([
    [500, 'server_error'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [429, 'rate_limited'],
    [404, 'endpoint_missing'],
  ] as const)('HTTP %i es %s y es transitorio', (status, kind) => {
    const attempt = classify(new RetriableApiError('x', status), true);
    expect(attempt).toMatchObject({ kind, http_status: status });
    expect(isTransient(attempt.kind)).toBe(true);
  });

  it('respeta el Retry-After del servidor', () => {
    expect(classify(new RetriableApiError('x', 429, { retryAfter: 30 }), true).retry_after_s).toBe(30);
  });

  it('los rechazos definitivos llevan el código y los campos', () => {
    const attempt = classify(
      new PermanentApiError('Hay datos que corregir.', 422, {
        code: 'validation_failed',
        errors: { year: ['inválido'] },
      }),
      true,
    );

    expect(attempt).toMatchObject({ kind: 'validation', field_errors: { year: ['inválido'] } });
    expect(isTransient(attempt.kind)).toBe(false);
    expect(classify(new PermanentApiError('grande', 413), true).kind).toBe('payload_too_large');
  });

  it('un 401 es una pausa por sesión', () => {
    expect(classify(new AuthRequiredError('expiró'), true).kind).toBe('auth');
  });

  it('un rechazo por fila usa el request id del lote', () => {
    const attempt = fromRejection(
      { table: 'vehicles', id: 'a', code: 'parent_missing', message: 'falta' },
      'req-lote',
      12,
    );
    expect(attempt).toMatchObject({ kind: 'parent_missing', request_id: 'req-lote', http_status: 200 });
  });
});
