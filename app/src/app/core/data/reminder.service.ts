import { Injectable, inject } from '@angular/core';
import type { IsoDate, Reminder, Uuid } from '../models';
import { OfflineStore, type NewRow } from './offline-store.service';
import { nextOccurrence } from './reminder-schedule';

/** Lo que captura el formulario. Estado y bitácora los lleva este servicio. */
export type ReminderFields = Omit<
  NewRow<Reminder>,
  'user_id' | 'kind' | 'source_id' | 'status' | 'last_notified_at' | 'done_at' | 'done_odometer_km'
>;

/** Lo que se anota en la bitácora al marcarlo hecho. */
export interface ReminderDone {
  readonly done_at: IsoDate;
  readonly done_odometer_km: number | null;
  /** Lo que se hizo. Nulo conserva las notas del recordatorio. */
  readonly notes?: string | null;
}

/**
 * Recordatorios del vehículo, estándar y personalizados.
 *
 * Marcar hecho nunca mueve el vencimiento: cierra la fila (`done`, con fecha
 * y km) y, si se repite, crea la siguiente con la misma configuración. Las
 * cerradas son la bitácora; solo las abiertas entran a `VehicleAlerts`.
 */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly store = inject(OfflineStore);

  create(fields: ReminderFields): Promise<Reminder> {
    return this.store.create<Reminder>('reminders', {
      ...normalize(fields),
      user_id: null,
      kind: 'custom',
      source_id: null,
      status: 'pending',
      last_notified_at: null,
      done_at: null,
      done_odometer_km: null,
    });
  }

  /**
   * Cambia la configuración. Si el vencimiento cambió, vuelve a `pending` para
   * que la siguiente fase pueda notificarlo otra vez.
   */
  async update(id: Uuid, fields: ReminderFields): Promise<Reminder> {
    return this.store.transaction(['reminders'], async () => {
      const reminder = await this.require(id);
      const next = normalize(fields);
      const moved = next.due_date !== reminder.due_date || next.due_odometer_km !== reminder.due_odometer_km;
      const reopen = moved && reminder.status === 'notified';
      await this.store.update<Reminder>('reminders', id, reopen ? { ...next, status: 'pending' } : next);
      return this.require(id);
    });
  }

  /** Lo pasa a la bitácora y programa el siguiente si se repite. Devuelve el siguiente. */
  async complete(id: Uuid, done: ReminderDone): Promise<Reminder | null> {
    return this.store.transaction(['reminders'], async () => {
      const reminder = await this.requireOpen(id);
      const notes = blankToNull(done.notes);
      await this.store.update<Reminder>('reminders', id, {
        status: 'done',
        done_at: done.done_at,
        done_odometer_km: done.done_odometer_km,
        ...(notes ? { notes } : {}),
      });
      const next = nextOccurrence(reminder, done.done_at, done.done_odometer_km);
      return next ? this.insertNext(reminder, next.due_date, next.due_odometer_km) : null;
    });
  }

  /**
   * Se salta esta vez: queda en la bitácora como descartado (`done_at` = el día
   * en que se descartó) y, si se repite, el siguiente sigue el calendario
   * original, como si se hubiera hecho a tiempo.
   */
  async dismiss(id: Uuid, today: IsoDate): Promise<Reminder | null> {
    return this.store.transaction(['reminders'], async () => {
      const reminder = await this.requireOpen(id);
      await this.store.update<Reminder>('reminders', id, { status: 'dismissed', done_at: today });
      const onSchedule = { ...reminder, repeat_anchor: reminder.due_date ? 'due' : reminder.repeat_anchor } as const;
      const next = nextOccurrence(onSchedule, today, null);
      return next ? this.insertNext(reminder, next.due_date, next.due_odometer_km) : null;
    });
  }

  /** Corrige una entrada de la bitácora. No toca al siguiente ya programado. */
  async updateLog(id: Uuid, entry: ReminderDone & { readonly title: string }): Promise<Reminder> {
    return this.store.transaction(['reminders'], async () => {
      await this.require(id);
      await this.store.update<Reminder>('reminders', id, {
        title: entry.title.trim(),
        done_at: entry.done_at,
        done_odometer_km: entry.done_odometer_km,
        notes: blankToNull(entry.notes),
      });
      return this.require(id);
    });
  }

  async remove(id: Uuid): Promise<void> {
    await this.store.remove('reminders', id);
  }

  private insertNext(previous: Reminder, dueDate: IsoDate | null, dueKm: number | null): Promise<Reminder> {
    return this.store.create<Reminder>('reminders', {
      user_id: null,
      vehicle_id: previous.vehicle_id,
      kind: previous.kind,
      source_id: previous.source_id,
      title: previous.title,
      due_date: dueDate,
      due_odometer_km: dueKm,
      notify_days_before: previous.notify_days_before,
      notify_km_before: previous.notify_km_before,
      status: 'pending',
      last_notified_at: null,
      repeat_every: previous.repeat_every,
      repeat_unit: previous.repeat_unit,
      repeat_km: previous.repeat_km,
      repeat_anchor: previous.repeat_anchor,
      notes: previous.notes,
      done_at: null,
      done_odometer_km: null,
    });
  }

  private async requireOpen(id: Uuid): Promise<Reminder> {
    const reminder = await this.require(id);
    if (reminder.status === 'done' || reminder.status === 'dismissed') {
      throw new Error('Este recordatorio ya está en la bitácora.');
    }
    return reminder;
  }

  private async require(id: Uuid): Promise<Reminder> {
    const reminder = await this.store.get<Reminder>('reminders', id);
    if (!reminder) {
      throw new Error('El recordatorio ya no existe.');
    }
    return reminder;
  }
}

/** Textos recortados, vacíos como null y repetición incompleta descartada. */
function normalize(fields: ReminderFields): ReminderFields {
  const byDate = !!fields.repeat_every && fields.repeat_every > 0 && !!fields.repeat_unit;
  return {
    ...fields,
    title: fields.title.trim(),
    notes: blankToNull(fields.notes),
    due_date: fields.due_date || null,
    repeat_every: byDate ? fields.repeat_every : null,
    repeat_unit: byDate ? fields.repeat_unit : null,
    repeat_km: fields.repeat_km && fields.repeat_km > 0 ? fields.repeat_km : null,
  };
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
