import { describe, expect, it } from 'vitest';
import type { StickerColor } from '../../core/models';
import { emissionsPeriod, nextEmissionsDeadline, periodLabel } from './emissions-calendar';

const vehicle = (emissions_sticker: StickerColor, plate_last_digit: number | null = null) => ({
  emissions_sticker,
  plate_last_digit,
});

describe('emissionsPeriod', () => {
  it('usa el engomado', () => {
    expect(emissionsPeriod(vehicle('yellow'))?.months).toEqual([[1, 2], [7, 8]]);
    expect(emissionsPeriod(vehicle('pink'))?.months).toEqual([[2, 3], [8, 9]]);
    expect(emissionsPeriod(vehicle('red'))?.months).toEqual([[3, 4], [9, 10]]);
    expect(emissionsPeriod(vehicle('green'))?.months).toEqual([[4, 5], [10, 11]]);
    expect(emissionsPeriod(vehicle('blue'))?.months).toEqual([[5, 6], [11, 12]]);
  });

  it('sin engomado lo deduce del último dígito de la placa', () => {
    expect(emissionsPeriod(vehicle('none', 5))?.sticker).toBe('yellow');
    expect(emissionsPeriod(vehicle('none', 8))?.sticker).toBe('pink');
    expect(emissionsPeriod(vehicle('none', 3))?.sticker).toBe('red');
    expect(emissionsPeriod(vehicle('none', 1))?.sticker).toBe('green');
    expect(emissionsPeriod(vehicle('none', 0))?.sticker).toBe('blue');
  });

  it('el engomado manda sobre la placa', () => {
    expect(emissionsPeriod(vehicle('red', 5))?.sticker).toBe('red');
  });

  it('sin engomado ni placa no sugiere nada', () => {
    expect(emissionsPeriod(vehicle('none'))).toBeNull();
    expect(emissionsPeriod(null)).toBeNull();
  });
});

describe('nextEmissionsDeadline', () => {
  it('hecha dentro de su periodo vale hasta el fin del siguiente', () => {
    expect(nextEmissionsDeadline(vehicle('yellow'), '2026-07-15')).toBe('2027-02-28');
    expect(nextEmissionsDeadline(vehicle('yellow'), '2027-01-20')).toBe('2027-08-31');
  });

  it('al renovar desde el vencimiento anterior salta al siguiente periodo', () => {
    expect(nextEmissionsDeadline(vehicle('yellow'), '2026-08-31')).toBe('2027-02-28');
    expect(nextEmissionsDeadline(vehicle('blue'), '2026-12-31')).toBe('2027-06-30');
  });

  it('cae en febrero bisiesto', () => {
    expect(nextEmissionsDeadline(vehicle('yellow'), '2027-08-01')).toBe('2028-02-29');
  });

  it('sin datos del vehículo, null', () => {
    expect(nextEmissionsDeadline(vehicle('none'), '2026-10-10')).toBeNull();
  });
});

describe('periodLabel', () => {
  it('nombra meses y engomado', () => {
    expect(periodLabel(emissionsPeriod(vehicle('yellow'))!)).toBe('enero–febrero y julio–agosto (engomado amarillo)');
  });
});
