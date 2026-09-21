import { describe, expect, it } from 'vitest';
import { isUuidV7, uuidV7, uuidV7Timestamp } from './uuid';

describe('uuidV7', () => {
  it('genera la forma y la versión de un UUIDv7', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isUuidV7(uuidV7())).toBe(true);
    }
  });

  it('no repite ids', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidV7()));
    expect(ids.size).toBe(10_000);
  });

  it('sale ordenado alfabéticamente por tiempo de creación', () => {
    // La propiedad que justifica usar v7: ordenar las cadenas ordena por
    // cronología, sin leer created_at y sin que el servidor intervenga.
    const ids = Array.from({ length: 5_000 }, () => uuidV7());
    expect([...ids].sort()).toEqual(ids);
  });

  it('embebe el instante de creación con precisión de milisegundos', () => {
    const before = Date.now();
    const at = uuidV7Timestamp(uuidV7()).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('rechaza un UUIDv4', () => {
    expect(isUuidV7('9f1b7a0e-3c2d-4f6a-9b8c-1d2e3f4a5b6c')).toBe(false);
  });
});
