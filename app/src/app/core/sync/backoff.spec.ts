import { describe, expect, it } from 'vitest';
import { backoffDelayMs, nextRetryAt } from './backoff';

describe('backoffDelayMs', () => {
  it('crece de forma exponencial', () => {
    // Con ±20% de jitter, el intento n siempre cae por debajo del n+1.
    expect(backoffDelayMs(1)).toBeLessThan(backoffDelayMs(4));
    expect(backoffDelayMs(4)).toBeLessThan(backoffDelayMs(7));
  });

  it('se mantiene dentro del ±20% de jitter', () => {
    for (let i = 0; i < 500; i += 1) {
      const delay = backoffDelayMs(1);
      expect(delay).toBeGreaterThanOrEqual(4_000);
      expect(delay).toBeLessThanOrEqual(6_000);
    }
  });

  it('nunca pasa del tope de 10 minutos', () => {
    // Sin tope, el intento 30 pediría esperar más que la edad del universo.
    for (const attempts of [20, 30, 100]) {
      expect(backoffDelayMs(attempts)).toBeLessThanOrEqual(600_000 * 1.2);
    }
  });

  it('aplica jitter: dos llamadas seguidas no dan el mismo valor', () => {
    const values = new Set(Array.from({ length: 50 }, () => backoffDelayMs(5)));
    expect(values.size).toBeGreaterThan(1);
  });

  it('nextRetryAt devuelve un ISO en el futuro', () => {
    const from = new Date('2026-09-20T00:00:00.000Z');
    expect(new Date(nextRetryAt(1, from)).getTime()).toBeGreaterThan(from.getTime());
  });
});
