import { describe, expect, it } from 'vitest';
import type { Reminder, Vehicle, VehicleDocument } from '../models';
import { documentAlerts, reminderAlerts, worstTone } from './vehicle-alerts.service';

const TODAY = '2026-10-10';

const doc = (fields: Partial<VehicleDocument>): VehicleDocument =>
  ({
    id: 'doc-1',
    vehicle_id: 'car-1',
    type: 'insurance',
    title: null,
    expires_at: '2027-01-01',
    renewed_by_id: null,
    deleted_at: null,
    ...fields,
  }) as VehicleDocument;

describe('documentAlerts', () => {
  it('una póliza con holgura o sin fecha no avisa', () => {
    expect(documentAlerts([doc({}), doc({ expires_at: null })], TODAY)).toEqual([]);
  });

  it('por vencer es warn y lleva a la vista de la póliza', () => {
    const [alert] = documentAlerts([doc({ expires_at: '2026-10-30' })], TODAY);

    expect(alert).toEqual({
      id: 'document:doc-1',
      vehicle_id: 'car-1',
      tone: 'warn',
      title: 'Póliza de seguro',
      detail: 'Vence en 20 días',
      route: '/vehicle/insurance',
    });
  });

  it('los demás documentos llevan a Documentos con su nombre o su tipo', () => {
    const alerts = documentAlerts(
      [
        doc({ id: 'doc-2', type: 'emissions_check', expires_at: '2026-10-30' }),
        doc({ id: 'doc-3', type: 'other', title: 'Permiso de carga', expires_at: '2026-10-01' }),
      ],
      TODAY,
    );

    expect(alerts.map(({ title, tone, route }) => ({ title, tone, route }))).toEqual([
      { title: 'Verificación', tone: 'warn', route: '/vehicle/documents' },
      { title: 'Permiso de carga', tone: 'bad', route: '/vehicle/documents' },
    ]);
  });

  it('vencida es bad', () => {
    const alerts = documentAlerts([doc({ expires_at: '2026-10-01' })], TODAY);

    expect(alerts[0].tone).toBe('bad');
    expect(worstTone(alerts)).toBe('bad');
  });

  it('renovada o borrada deja de avisar aunque esté vencida', () => {
    const alerts = documentAlerts(
      [
        doc({ expires_at: '2026-10-01', renewed_by_id: 'doc-2' }),
        doc({ expires_at: '2026-10-01', deleted_at: '2026-10-02T00:00:00Z' }),
      ],
      TODAY,
    );

    expect(alerts).toEqual([]);
  });
});

const reminder = (fields: Partial<Reminder>): Reminder =>
  ({
    id: 'rem-1',
    vehicle_id: 'car-1',
    title: 'Revisar aceite',
    due_date: '2027-01-01',
    due_odometer_km: null,
    notify_days_before: 15,
    notify_km_before: 500,
    status: 'pending',
    deleted_at: null,
    ...fields,
  }) as Reminder;

const CARS = [{ id: 'car-1', current_odometer_km: 10_000 } as Vehicle];

describe('reminderAlerts', () => {
  it('con holgura no avisa', () => {
    expect(reminderAlerts([reminder({})], CARS, TODAY)).toEqual([]);
  });

  it('vencido es bad y lleva a Recordatorios', () => {
    expect(reminderAlerts([reminder({ due_date: '2026-10-08' })], CARS, TODAY)).toEqual([
      {
        id: 'reminder:rem-1',
        vehicle_id: 'car-1',
        tone: 'bad',
        title: 'Revisar aceite',
        detail: 'Se pasó por 2 días',
        route: '/vehicle/reminders',
      },
    ]);
  });

  it('próximo por km con el odómetro del vehículo es warn', () => {
    const [alert] = reminderAlerts([reminder({ due_date: null, due_odometer_km: 10_300 })], CARS, TODAY);

    expect(alert.tone).toBe('warn');
    expect(alert.detail).toBe('Faltan 300 km');
  });

  it('hecho, descartado o borrado deja de avisar', () => {
    const alerts = reminderAlerts(
      [
        reminder({ due_date: '2026-10-01', status: 'done' }),
        reminder({ due_date: '2026-10-01', status: 'dismissed' }),
        reminder({ due_date: '2026-10-01', deleted_at: '2026-10-02T00:00:00Z' }),
      ],
      CARS,
      TODAY,
    );

    expect(alerts).toEqual([]);
  });
});
