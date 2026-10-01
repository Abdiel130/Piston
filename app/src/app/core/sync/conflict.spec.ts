import { describe, expect, it } from 'vitest';
import type { OutboxEntry, SyncConflict } from '../models';
import { changedFields, conflictView, resolvedRow, sameValue } from './conflict';

function entry(base: object | null, mine: object, conflict: Partial<SyncConflict>, op: OutboxEntry['op'] = 'update'): OutboxEntry {
  return {
    id: 'e-1',
    table_name: 'vehicles',
    row_id: 'v-1',
    op,
    payload: JSON.stringify(mine),
    base_rev: 100,
    base: base ? JSON.stringify(base) : null,
    resolve: null,
    conflict: {
      kind: 'edit_edit',
      fields: [],
      server_row: null,
      server_rev: 200,
      detected_at: '2026-09-30T00:00:00.000Z',
      request_id: null,
      ...conflict,
    } as SyncConflict,
    status: 'conflict',
    attempts: 1,
    last_attempt: null,
    blocked_by: null,
    next_retry_at: '2026-09-30T00:00:00.000Z',
    created_at: '2026-09-30T00:00:00.000Z',
  };
}

describe('conflict', () => {
  it('compara con la misma tolerancia que el servidor', () => {
    expect(sameValue(12.5, '12.50')).toBe(true);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue('2026-09-28T14:03:00.123Z', '2026-09-28T14:03:00.123000Z')).toBe(true);
    expect(sameValue(0, null)).toBe(false);
    expect(sameValue('ABC', 'abc')).toBe(false);
  });

  it('ignora las columnas del sync al buscar cambios', () => {
    expect(changedFields({ notes: 'a', rev: 1, client_updated_at: 'x' }, { notes: 'b', rev: 2, client_updated_at: 'y' })).toEqual([
      'notes',
    ]);
  });

  it('separa lo que chocó de lo que se combinó solo', () => {
    const base = { license_plate: 'A', notes: null, color: null };
    const mine = { license_plate: 'MIA', notes: 'mía', color: null };
    const theirs = { license_plate: 'SRV', notes: null, color: 'Azul', rev: 200 };
    const view = conflictView(entry(base, mine, { fields: ['license_plate'], server_row: theirs as never }))!;

    expect(view.fields).toEqual(['license_plate']);
    expect(view.fromMine).toEqual(['notes']);
    expect(view.fromTheirs).toEqual(['color']);
  });

  it('la versión resuelta parte del servidor y conserva mis cambios sin choque', () => {
    const base = { license_plate: 'A', notes: null, color: null };
    const mine = { license_plate: 'MIA', notes: 'mía', color: null, local_blob_key: 'k' };
    const theirs = { license_plate: 'SRV', notes: null, color: 'Azul' };
    const view = conflictView(entry(base, mine, { fields: ['license_plate'], server_row: theirs as never }))!;

    expect(resolvedRow(view, { license_plate: 'theirs' })).toEqual({
      license_plate: 'SRV',
      notes: 'mía',
      color: 'Azul',
      local_blob_key: 'k',
    });
    expect(resolvedRow(view, {})['license_plate']).toBe('MIA');
  });

  it('sin base, compara contra el servidor', () => {
    const view = conflictView(
      entry(null, { notes: 'mía' }, { fields: ['notes'], server_row: { notes: 'suya' } as never }),
    )!;
    expect(view.fromMine).toEqual([]);
    expect(view.fromTheirs).toEqual([]);
  });

  it('si mi cambio es un borrado no hay versión mía que mostrar', () => {
    const view = conflictView(
      entry({ notes: null }, { notes: null, deleted_at: 'x' }, { kind: 'edit_delete', fields: ['notes'], server_row: { notes: 'editada' } as never }, 'delete'),
    )!;
    expect(view.mine).toBeNull();
    expect(view.fromTheirs).toEqual(['notes']);
  });
});
