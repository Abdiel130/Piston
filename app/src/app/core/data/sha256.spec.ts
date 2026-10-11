import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256, sha256Hex } from './sha256';

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const text = (value: string) => new TextEncoder().encode(value);

describe('sha256', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('coincide con los vectores de FIPS 180-4', () => {
    expect(hex(sha256(text('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(text('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('da lo mismo que crypto.subtle en bloques de cualquier tamaño', async () => {
    for (const size of [55, 56, 63, 64, 65, 1000, 100_003]) {
      const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff);
      const native = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      expect(hex(sha256(bytes))).toBe(hex(native));
    }
  });

  it('sin contexto seguro (http por IP) sigue sacando el checksum', async () => {
    const file = new Blob(['%PDF-poliza']);
    const expected = await sha256Hex(file);
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });

    expect(await sha256Hex(file)).toBe(expected);
  });
});
