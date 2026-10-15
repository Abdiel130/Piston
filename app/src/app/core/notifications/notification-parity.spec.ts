import { beforeAll, describe, expect, it } from 'vitest';
import { documentAlerts, reminderAlerts, type VehicleAlert } from '../data/vehicle-alerts.service';
import type { Reminder, Vehicle, VehicleDocument } from '../models';
import { DEFAULT_PREFS, dueNotifications, messagesFor } from './notification-rules';

/**
 * El service worker no puede importar TS: `public/piston-sw-alerts.js` copia
 * la lógica de avisos. Aquí se corren las dos con los mismos datos.
 */
interface SwAlerts {
  documentAlerts(documents: unknown[], today: string): VehicleAlert[];
  reminderAlerts(reminders: unknown[], vehicles: unknown[], today: string, distance: (km: number) => string): VehicleAlert[];
  dueNotifications(alerts: VehicleAlert[], prefs: unknown, notified: Set<string>): VehicleAlert[];
  messagesFor(alerts: VehicleAlert[], names: Map<string, string>): unknown[];
  distanceFormat(unit: string | undefined): (km: number) => string;
}

/** Los specs corren en Node, pero el proyecto no trae sus tipos: se importa sin ellos. */
async function loadWorker(): Promise<SwAlerts> {
  const fsModule = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: 'utf8'): string };
  const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
  const code = fs.readFileSync(`${cwd}/public/piston-sw-alerts.js`, 'utf8');
  const self: Record<string, unknown> = {};
  new Function('self', code)(self);
  return self['pistonAlerts'] as SwAlerts;
}

const TODAY = '2026-10-14';

const DOCUMENTS = [
  { id: 'd1', vehicle_id: 'car-1', type: 'insurance', title: null, expires_at: '2026-11-01', renewed_by_id: null, deleted_at: null },
  { id: 'd2', vehicle_id: 'car-1', type: 'driver_license', title: null, expires_at: '2026-10-01', renewed_by_id: null, deleted_at: null, notify_enabled: false },
  { id: 'd3', vehicle_id: 'car-2', type: 'other', title: 'Permiso', expires_at: '2026-10-14', renewed_by_id: null, deleted_at: null },
  { id: 'd4', vehicle_id: 'car-1', type: 'insurance', title: null, expires_at: '2026-10-01', renewed_by_id: 'd1', deleted_at: null },
  { id: 'd5', vehicle_id: 'car-1', type: 'warranty', title: null, expires_at: '2027-10-01', renewed_by_id: null, deleted_at: null },
] as unknown as VehicleDocument[];

const REMINDERS = [
  { id: 'r1', vehicle_id: 'car-1', title: 'Aceite', due_date: '2026-10-12', due_odometer_km: null, notify_days_before: 7, notify_km_before: 500, status: 'pending', deleted_at: null },
  { id: 'r2', vehicle_id: 'car-1', title: 'Rotación', due_date: null, due_odometer_km: 10_300, notify_days_before: 15, notify_km_before: 500, status: 'notified', deleted_at: null },
  { id: 'r3', vehicle_id: 'car-2', title: 'Refrendo', due_date: '2026-10-15', due_odometer_km: 20_000, notify_days_before: null, notify_km_before: null, status: 'pending', deleted_at: null },
  { id: 'r4', vehicle_id: 'car-1', title: 'Hecho', due_date: '2026-10-01', due_odometer_km: null, notify_days_before: 7, notify_km_before: 500, status: 'done', deleted_at: null },
  { id: 'r5', vehicle_id: 'car-1', title: 'Lejos', due_date: '2027-01-01', due_odometer_km: 9_000, notify_days_before: 7, notify_km_before: 500, status: 'pending', deleted_at: null },
] as unknown as Reminder[];

const VEHICLES = [
  { id: 'car-1', current_odometer_km: 10_000 },
  { id: 'car-2', current_odometer_km: 21_234 },
] as Vehicle[];

describe('paridad con el service worker', () => {
  let worker: SwAlerts;

  beforeAll(async () => {
    worker = await loadWorker();
  });

  it('los documentos dan los mismos avisos', () => {
    expect(worker.documentAlerts(DOCUMENTS, TODAY)).toEqual(documentAlerts(DOCUMENTS, TODAY));
  });

  it('los recordatorios dan los mismos avisos, en km y en millas', () => {
    for (const unit of ['km', 'mi']) {
      const distance = worker.distanceFormat(unit);
      expect(worker.reminderAlerts(REMINDERS, VEHICLES, TODAY, distance)).toEqual(
        reminderAlerts(REMINDERS, VEHICLES, TODAY, distance),
      );
    }
  });

  it('la distancia se escribe como en la app', () => {
    expect(worker.distanceFormat('km')(1_234)).toBe('1,234 km');
    expect(worker.distanceFormat('mi')(1_609.344)).toBe('1,000 mi');
  });

  it('suena lo mismo con el mismo texto', () => {
    const alerts = [...documentAlerts(DOCUMENTS, TODAY), ...reminderAlerts(REMINDERS, VEHICLES, TODAY)];
    const prefs = { ...DEFAULT_PREFS, documents: false };
    const notified = new Set([alerts[0].key]);
    const names = new Map([
      ['car-1', 'Vochito'],
      ['car-2', 'Tsuru'],
    ]);

    const due = dueNotifications(alerts, prefs, notified);
    expect(worker.dueNotifications(alerts, prefs, notified)).toEqual(due);
    expect(worker.messagesFor(due, names)).toEqual(messagesFor(due, names));
    expect(worker.messagesFor(alerts, names)).toEqual(messagesFor(alerts, names));
  });
});
