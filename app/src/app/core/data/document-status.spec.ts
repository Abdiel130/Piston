import { describe, expect, it } from 'vitest';
import type { VehicleDocument } from '../models';
import { addMonths, daysUntil, documentStatus, expiryLabel, isCurrent } from './document-status';

const TODAY = '2026-10-10';

describe('documentStatus', () => {
  it('sin vencimiento no avisa', () => {
    expect(documentStatus(null, TODAY)).toBe('ok');
  });

  it('con más de 30 días queda en ok', () => {
    expect(documentStatus('2026-11-10', TODAY)).toBe('ok');
  });

  it('a 30 días o menos está por vencer', () => {
    expect(documentStatus('2026-11-09', TODAY)).toBe('expiring');
    expect(documentStatus('2026-10-11', TODAY)).toBe('expiring');
  });

  it('el día en que vence todavía vale', () => {
    expect(documentStatus(TODAY, TODAY)).toBe('expiring');
  });

  it('al día siguiente ya venció', () => {
    expect(documentStatus('2026-10-09', TODAY)).toBe('expired');
  });

  it('cuenta días completos aunque cruce el cambio de horario', () => {
    expect(daysUntil('2026-11-02', '2026-10-25')).toBe(8);
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
  });
});

describe('expiryLabel', () => {
  it('habla en días hacia adelante y hacia atrás', () => {
    expect(expiryLabel(TODAY, TODAY)).toBe('Vence hoy');
    expect(expiryLabel('2026-10-11', TODAY)).toBe('Vence mañana');
    expect(expiryLabel('2026-10-22', TODAY)).toBe('Vence en 12 días');
    expect(expiryLabel('2026-10-09', TODAY)).toBe('Venció ayer');
    expect(expiryLabel('2026-10-07', TODAY)).toBe('Venció hace 3 días');
  });
});

describe('isCurrent', () => {
  const doc = (fields: Partial<VehicleDocument>) =>
    ({ deleted_at: null, renewed_by_id: null, ...fields }) as VehicleDocument;

  it('solo el que no fue renovado ni borrado es vigente', () => {
    expect(isCurrent(doc({}))).toBe(true);
    expect(isCurrent(doc({ renewed_by_id: 'otro' }))).toBe(false);
    expect(isCurrent(doc({ deleted_at: '2026-10-01T00:00:00Z' }))).toBe(false);
  });
});

describe('addMonths', () => {
  it('suma meses respetando el fin de mes', () => {
    expect(addMonths('2026-11-01', 12)).toBe('2027-11-01');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });
});
