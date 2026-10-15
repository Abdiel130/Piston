import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/piston-db';
import type { Reminder } from '../models';
import { ReminderService, type ReminderFields } from './reminder.service';

const VEHICLE = '0190a000-0000-7000-8000-000000000001';

function fields(overrides: Partial<ReminderFields> = {}): ReminderFields {
  return {
    vehicle_id: VEHICLE,
    title: ' Revisar aceite ',
    due_date: '2026-10-01',
    due_odometer_km: null,
    notify_days_before: 7,
    notify_km_before: 500,
    repeat_every: 2,
    repeat_unit: 'month',
    repeat_km: null,
    repeat_anchor: 'done',
    notes: '  ',
    notify_enabled: true,
    ...overrides,
  };
}

describe('ReminderService', () => {
  let service: ReminderService;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ReminderService);
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  const live = async () => (await db.reminders.toArray()).filter((row) => !row.deleted_at);

  it('guarda pendiente, personalizado y con textos normalizados', async () => {
    const reminder = await service.create(fields({ repeat_unit: null }));

    expect(reminder.title).toBe('Revisar aceite');
    expect(reminder.notes).toBeNull();
    expect(reminder.kind).toBe('custom');
    expect(reminder.status).toBe('pending');
    expect(reminder.repeat_every).toBeNull();
  });

  it('cada 2 meses, marcado hecho hoy, vence en 2 meses y el anterior pasa a la bitácora', async () => {
    const reminder = await service.create(fields());

    const next = await service.complete(reminder.id, {
      done_at: '2026-10-14',
      done_odometer_km: 52_000,
      notes: 'Cambié filtro',
    });

    expect(next).toMatchObject({ status: 'pending', due_date: '2026-12-14', title: 'Revisar aceite', notes: null });
    const done = (await db.reminders.get(reminder.id)) as Reminder;
    expect(done).toMatchObject({
      status: 'done',
      done_at: '2026-10-14',
      done_odometer_km: 52_000,
      notes: 'Cambié filtro',
    });
    expect(await live()).toHaveLength(2);
  });

  it('sin repetición solo pasa a la bitácora', async () => {
    const reminder = await service.create(fields({ repeat_every: null, repeat_unit: null }));

    expect(await service.complete(reminder.id, { done_at: '2026-10-14', done_odometer_km: null })).toBeNull();
    expect((await live()).map((row) => row.status)).toEqual(['done']);
  });

  it('descartar se salta esta vez y sigue el calendario original', async () => {
    const reminder = await service.create(fields());

    const next = await service.dismiss(reminder.id, '2026-10-14');

    expect(next?.due_date).toBe('2026-12-01');
    expect((await db.reminders.get(reminder.id))?.status).toBe('dismissed');
  });

  it('no se marca dos veces', async () => {
    const reminder = await service.create(fields());
    await service.complete(reminder.id, { done_at: '2026-10-14', done_odometer_km: null });

    await expect(service.complete(reminder.id, { done_at: '2026-10-14', done_odometer_km: null })).rejects.toThrow(
      'bitácora',
    );
  });

  it('cambiar el vencimiento de uno ya notificado lo reabre', async () => {
    const reminder = await service.create(fields());
    await db.reminders.update(reminder.id, { status: 'notified' });

    const updated = await service.update(reminder.id, fields({ due_date: '2026-11-01' }));

    expect(updated.status).toBe('pending');
    expect(updated.due_date).toBe('2026-11-01');
  });
});
