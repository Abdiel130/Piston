import { describe, expect, it } from 'vitest';
import { describeRow, rowLabel } from './describe';

describe('describeRow', () => {
  it('describe una carga con litros, odómetro y fecha', () => {
    const { title, detail } = describeRow('fuel_entries', {
      liters: 30.5,
      odometer_km: 48_700,
      filled_at: '2026-09-12T18:00:00.000Z',
    });

    expect(title).toBe('Carga de combustible');
    expect(detail).toContain('30.5 L');
    expect(detail).toContain('48,700 km');
    expect(detail).toMatch(/12 sept?/);
  });

  it('una fecha sin hora no se corre al día anterior', () => {
    expect(describeRow('expenses', { amount: 100, spent_at: '2026-09-01' }).detail).toMatch(/1 sept?/);
  });

  it('sin payload solo da el nombre de la tabla', () => {
    expect(rowLabel('vehicles', null)).toBe('Vehículo');
  });
});
