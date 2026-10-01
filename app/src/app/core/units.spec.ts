import { describe, expect, it } from 'vitest';
import {
  efficiencySymbol,
  fromBaseCostPerDistance,
  fromBaseDistance,
  fromBaseEfficiency,
  fromBasePricePerVolume,
  fromBaseVolume,
  toBaseDistance,
  toBaseEfficiency,
  toBaseOdometer,
  toBasePricePerVolume,
  toBaseVolume,
  type UnitPreferences,
} from './units';

const IMPERIAL: UnitPreferences = { distance: 'mi', volume: 'gal', currency: 'USD' };
const METRIC: UnitPreferences = { distance: 'km', volume: 'L', currency: 'MXN' };

describe('units', () => {
  it('la unidad base no cambia nada', () => {
    expect(toBaseDistance(123.4, 'km')).toBe(123.4);
    expect(fromBaseVolume(45, 'L')).toBe(45);
    expect(fromBaseEfficiency(14.2, METRIC)).toBe(14.2);
  });

  it('convierte con los factores exactos', () => {
    expect(toBaseDistance(1, 'mi')).toBe(1.609344);
    expect(toBaseVolume(1, 'gal')).toBe(3.785411784);
    expect(fromBaseDistance(1.609344, 'mi')).toBeCloseTo(1, 12);
    expect(fromBaseVolume(3.785411784, 'gal')).toBeCloseTo(1, 12);
  });

  it('un dato que falta sigue faltando', () => {
    expect(toBaseDistance(null, 'mi')).toBeNull();
    expect(fromBaseVolume(null, 'gal')).toBeNull();
    expect(fromBaseEfficiency(null, IMPERIAL)).toBeNull();
    expect(toBaseOdometer(null, 'mi')).toBeNull();
  });

  it('el odómetro se guarda en km enteros y vuelve igual', () => {
    const km = toBaseOdometer(30_000, 'mi');
    expect(km).toBe(48_280);
    expect(Math.round(fromBaseDistance(km, 'mi'))).toBe(30_000);
  });

  it('rendimiento: 10 km/L son ~23.52 mpg, ida y vuelta', () => {
    const mpg = fromBaseEfficiency(10, IMPERIAL)!;
    expect(mpg).toBeCloseTo(23.5215, 3);
    expect(toBaseEfficiency(mpg, IMPERIAL)).toBeCloseTo(10, 10);
  });

  it('precio por volumen y costo por distancia escalan al revés que la cantidad', () => {
    const perGallon = fromBasePricePerVolume(25, 'gal')!;
    expect(perGallon).toBeCloseTo(94.635, 3);
    expect(toBasePricePerVolume(perGallon, 'gal')).toBeCloseTo(25, 10);
    expect(fromBaseCostPerDistance(2, 'mi')).toBeCloseTo(3.218688, 6);
  });

  it('el símbolo de rendimiento sigue a las preferencias', () => {
    expect(efficiencySymbol(METRIC)).toBe('km/L');
    expect(efficiencySymbol(IMPERIAL)).toBe('mi/gal');
  });
});
