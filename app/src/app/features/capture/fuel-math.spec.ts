import { describe, expect, it } from 'vitest';
import { deduceGaugeBefore, exceedsTank, resolveTrio } from './fuel-math';

describe('resolveTrio', () => {
  it('calcula la cantidad con monto y precio', () => {
    const { values, sources } = resolveTrio({ amount: 500, price: 25, liters: null }, null);
    expect(values.liters).toBe(20);
    expect(sources).toEqual({ amount: 'typed', price: 'typed', liters: 'derived' });
  });

  it('usa el precio sugerido si no hay otro', () => {
    const { values, sources } = resolveTrio({ amount: 480, price: null, liters: null }, 24);
    expect(values).toEqual({ amount: 480, price: 24, liters: 20 });
    expect(sources.price).toBe('suggested');
    expect(sources.liters).toBe('derived');
  });

  it('prefiere el precio real de monto y cantidad sobre el sugerido', () => {
    const { values, sources } = resolveTrio({ amount: 500, price: null, liters: 20 }, 24);
    expect(values.price).toBe(25);
    expect(sources.price).toBe('derived');
  });

  it('calcula el monto con cantidad y precio', () => {
    const { values, sources } = resolveTrio({ amount: null, price: 23.459, liters: 30 }, null);
    expect(values.amount).toBe(703.77);
    expect(sources.amount).toBe('derived');
  });

  it('lo escrito manda aunque no cuadre', () => {
    const { values, sources } = resolveTrio({ amount: 500, price: 30, liters: 20 }, 24);
    expect(values).toEqual({ amount: 500, price: 30, liters: 20 });
    expect(sources).toEqual({ amount: 'typed', price: 'typed', liters: 'typed' });
  });

  it('no divide entre cero ni deduce con negativos', () => {
    expect(resolveTrio({ amount: 500, price: 0, liters: null }, null).values.liters).toBeNull();
    expect(resolveTrio({ amount: -5, price: 20, liters: null }, null).values.liters).toBeNull();
    expect(resolveTrio({ amount: null, price: null, liters: null }, null).sources).toEqual({
      amount: null,
      price: null,
      liters: null,
    });
  });
});

describe('deduceGaugeBefore', () => {
  it('deduce las rayitas con las que arrancó', () => {
    expect(deduceGaugeBefore(30, 40, 8)).toEqual({ gauge: 2, litersBefore: 10 });
  });

  it('no baja de cero si entró más que la capacidad', () => {
    expect(deduceGaugeBefore(45, 40, 8)).toEqual({ gauge: 0, litersBefore: 0 });
  });

  it('sin cantidad o sin capacidad no deduce nada', () => {
    expect(deduceGaugeBefore(null, 40, 8)).toBeNull();
    expect(deduceGaugeBefore(30, 0, 8)).toBeNull();
  });
});

describe('exceedsTank', () => {
  it('tolera un poco más de la capacidad nominal', () => {
    expect(exceedsTank(43, 40)).toBe(false);
    expect(exceedsTank(50, 40)).toBe(true);
    expect(exceedsTank(50, null)).toBe(false);
  });
});
