import { describe, expect, it } from 'vitest';
import {
  addPeriod,
  dueLabel,
  nextOccurrence,
  reminderState,
  repeatLabel,
  repeats,
  type ReminderTiming,
} from './reminder-schedule';

const TODAY = '2026-10-14';

const timing = (fields: Partial<ReminderTiming> = {}): ReminderTiming => ({
  due_date: null,
  due_odometer_km: null,
  notify_days_before: 15,
  notify_km_before: 500,
  repeat_every: null,
  repeat_unit: null,
  repeat_km: null,
  repeat_anchor: 'done',
  ...fields,
});

describe('addPeriod', () => {
  it('suma días, semanas, meses y años', () => {
    expect(addPeriod('2026-10-14', 10, 'day')).toBe('2026-10-24');
    expect(addPeriod('2026-12-28', 2, 'week')).toBe('2027-01-11');
    expect(addPeriod('2026-10-14', 2, 'month')).toBe('2026-12-14');
    expect(addPeriod('2028-02-29', 1, 'year')).toBe('2029-02-28');
  });

  it('fin de mes cae al último día del mes destino', () => {
    expect(addPeriod('2026-01-31', 1, 'month')).toBe('2026-02-28');
  });
});

describe('nextOccurrence', () => {
  it('cada 2 meses, hecho hoy, vence en 2 meses', () => {
    const next = nextOccurrence(
      timing({ due_date: '2026-09-01', repeat_every: 2, repeat_unit: 'month' }),
      TODAY,
      52_000,
    );

    expect(next).toEqual({ due_date: '2026-12-14', due_odometer_km: null });
  });

  it('con ancla en el vencimiento conserva la fecha aunque se haga tarde', () => {
    const refrendo = timing({ due_date: '2026-03-15', repeat_every: 1, repeat_unit: 'year', repeat_anchor: 'due' });

    expect(nextOccurrence(refrendo, '2026-04-02', null)?.due_date).toBe('2027-03-15');
    expect(nextOccurrence(refrendo, '2026-03-01', null)?.due_date).toBe('2027-03-15');
  });

  it('con ancla en el vencimiento salta los periodos que ya pasaron', () => {
    const quincenal = timing({ due_date: '2026-09-01', repeat_every: 2, repeat_unit: 'week', repeat_anchor: 'due' });

    expect(nextOccurrence(quincenal, TODAY, null)?.due_date).toBe('2026-10-27');
  });

  it('con ancla en el vencimiento no arrastra el fin de mes recortado', () => {
    const mensual = timing({ due_date: '2026-01-31', repeat_every: 1, repeat_unit: 'month', repeat_anchor: 'due' });

    expect(nextOccurrence(mensual, '2026-03-01', null)?.due_date).toBe('2026-03-31');
  });

  it('por km cuenta desde el odómetro con que se hizo', () => {
    const rotacion = timing({ due_odometer_km: 50_000, repeat_km: 10_000 });

    expect(nextOccurrence(rotacion, TODAY, 51_200)).toEqual({ due_date: null, due_odometer_km: 61_200 });
    expect(nextOccurrence(rotacion, TODAY, null)).toEqual({ due_date: null, due_odometer_km: 60_000 });
  });

  it('por fecha y km a la vez', () => {
    const aceite = timing({ repeat_every: 6, repeat_unit: 'month', repeat_km: 10_000 });

    expect(nextOccurrence(aceite, TODAY, 40_000)).toEqual({ due_date: '2027-04-14', due_odometer_km: 50_000 });
  });

  it('sin repetición no hay siguiente', () => {
    expect(repeats(timing({ due_date: TODAY }))).toBe(false);
    expect(nextOccurrence(timing({ due_date: TODAY }), TODAY, 1_000)).toBeNull();
  });
});

describe('reminderState', () => {
  it('con holgura o sin vencimiento está ok', () => {
    expect(reminderState(timing({ due_date: '2026-12-01' }), TODAY, null)).toBe('ok');
    expect(reminderState(timing(), TODAY, 10_000)).toBe('ok');
  });

  it('entra en la ventana de días o de km', () => {
    expect(reminderState(timing({ due_date: '2026-10-29' }), TODAY, null)).toBe('upcoming');
    expect(reminderState(timing({ due_date: TODAY }), TODAY, null)).toBe('upcoming');
    expect(reminderState(timing({ due_odometer_km: 10_400 }), TODAY, 10_000)).toBe('upcoming');
  });

  it('se pasa por fecha o por km, lo que llegue primero', () => {
    expect(reminderState(timing({ due_date: '2026-10-13' }), TODAY, null)).toBe('overdue');
    expect(reminderState(timing({ due_date: '2027-01-01', due_odometer_km: 9_999 }), TODAY, 10_000)).toBe('overdue');
  });

  it('usa la ventana por omisión cuando no trae una', () => {
    expect(reminderState(timing({ due_date: '2026-10-30', notify_days_before: null }), TODAY, null)).toBe('ok');
    expect(reminderState(timing({ due_date: '2026-10-29', notify_days_before: null }), TODAY, null)).toBe('upcoming');
  });
});

describe('dueLabel', () => {
  it('describe días y km', () => {
    expect(dueLabel(timing({ due_date: TODAY }), TODAY, null)).toBe('Toca hoy');
    expect(dueLabel(timing({ due_date: '2026-10-26' }), TODAY, null)).toBe('Toca en 12 días');
    expect(dueLabel(timing({ due_date: '2026-10-11' }), TODAY, null)).toBe('Se pasó por 3 días');
    expect(dueLabel(timing({ due_date: '2026-10-15', due_odometer_km: 10_300 }), TODAY, 10_000)).toBe(
      'Toca mañana · Faltan 300 km',
    );
    expect(dueLabel(timing({ due_odometer_km: 9_000 }), TODAY, 10_200)).toBe('Se pasó por 1,200 km');
  });
});

describe('repeatLabel', () => {
  it('nombra cada forma de repetir', () => {
    expect(repeatLabel(timing())).toBe('Una sola vez');
    expect(repeatLabel(timing({ repeat_every: 2, repeat_unit: 'month' }))).toBe('Cada 2 meses');
    expect(repeatLabel(timing({ repeat_every: 1, repeat_unit: 'year', repeat_anchor: 'due' }))).toBe(
      'Cada año en la misma fecha',
    );
    expect(repeatLabel(timing({ repeat_km: 10_000 }))).toBe('Cada 10,000 km');
    expect(repeatLabel(timing({ repeat_every: 6, repeat_unit: 'month', repeat_km: 10_000 }))).toBe(
      'Cada 6 meses o 10,000 km',
    );
  });
});
