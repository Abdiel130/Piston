import { describe, expect, it } from 'vitest';
import type { VehicleAlert } from '../data/vehicle-alerts.service';
import { DEFAULT_PREFS, dueNotifications, messagesFor } from './notification-rules';

const alert = (fields: Partial<VehicleAlert> = {}): VehicleAlert => ({
  id: 'document:doc-1',
  vehicle_id: 'car-1',
  tone: 'warn',
  title: 'Póliza de seguro',
  detail: 'Vence en 30 días',
  route: '/vehicle/insurance',
  category: 'insurance',
  key: 'document:doc-1:warn:2026-11-13',
  notify: true,
  ...fields,
});

describe('dueNotifications', () => {
  it('una póliza que entra en ventana suena una vez', () => {
    const policy = alert();

    expect(dueNotifications([policy], DEFAULT_PREFS, new Set())).toEqual([policy]);
    expect(dueNotifications([policy], DEFAULT_PREFS, new Set([policy.key]))).toEqual([]);
  });

  it('al vencer es otra llave y vuelve a sonar', () => {
    const expired = alert({ tone: 'bad', key: 'document:doc-1:bad:2026-11-13' });

    expect(dueNotifications([expired], DEFAULT_PREFS, new Set(['document:doc-1:warn:2026-11-13']))).toEqual([expired]);
  });

  it('respeta el interruptor general, el del tipo y el de la fila', () => {
    const reminder = alert({ id: 'reminder:r', category: 'reminders', key: 'reminder:r:warn::' });
    const muted = alert({ id: 'document:doc-2', key: 'document:doc-2:warn:x', notify: false });
    const all = [alert(), reminder, muted];

    expect(dueNotifications(all, { ...DEFAULT_PREFS, enabled: false }, new Set())).toEqual([]);
    expect(dueNotifications(all, { ...DEFAULT_PREFS, insurance: false }, new Set())).toEqual([reminder]);
    expect(dueNotifications(all, DEFAULT_PREFS, new Set())).toEqual([alert(), reminder]);
  });
});

describe('messagesFor', () => {
  it('una por aviso, con la vista y el vehículo', () => {
    expect(messagesFor([alert()], new Map([['car-1', 'Vochito']]))).toEqual([
      {
        title: 'Póliza de seguro',
        body: 'Vence en 30 días',
        tag: 'document:doc-1',
        url: '/vehicle/insurance?vehicle=car-1',
      },
    ]);
  });

  it('con varios vehículos el cuerpo dice de cuál', () => {
    const names = new Map([
      ['car-1', 'Vochito'],
      ['car-2', 'Tsuru'],
    ]);

    expect(messagesFor([alert()], names)[0].body).toBe('Vochito · Vence en 30 días');
  });

  it('muchos a la vez salen en un resumen que lleva al garage', () => {
    const many = [1, 2, 3, 4, 5].map((n) => alert({ id: `reminder:${n}`, title: `Recordatorio ${n}`, key: `k${n}` }));

    const [summary, ...rest] = messagesFor(many, new Map());

    expect(rest).toEqual([]);
    expect(summary.title).toBe('5 avisos de tus vehículos');
    expect(summary.body.split('\n')).toEqual([
      'Recordatorio 1: Vence en 30 días',
      'Recordatorio 2: Vence en 30 días',
      'Recordatorio 3: Vence en 30 días',
      'y 2 más',
    ]);
    expect(summary.url).toBe('/');
  });
});
