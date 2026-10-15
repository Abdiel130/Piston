import { formatKm } from '../format';
import type { IsoDate, Reminder, RepeatUnit } from '../models';
import { addMonths, daysUntil } from './document-status';

/** `ok`: falta. `upcoming`: entró en la ventana de aviso. `overdue`: ya se pasó. */
export type ReminderState = 'ok' | 'upcoming' | 'overdue';

/** Lo que define cuándo toca. Lo comparten un recordatorio y su plantilla. */
export type ReminderTiming = Pick<
  Reminder,
  | 'due_date'
  | 'due_odometer_km'
  | 'notify_days_before'
  | 'notify_km_before'
  | 'repeat_every'
  | 'repeat_unit'
  | 'repeat_km'
  | 'repeat_anchor'
>;

/** Siguiente vencimiento al marcar hecho. Ambos nulos no pasa: sin repetición no hay siguiente. */
export interface NextOccurrence {
  readonly due_date: IsoDate | null;
  readonly due_odometer_km: number | null;
}

/** Ventanas de aviso cuando el recordatorio no trae las suyas. */
export const DEFAULT_NOTIFY_DAYS = 15;
export const DEFAULT_NOTIFY_KM = 500;

/** `YYYY-MM-DD` más N días, semanas, meses o años. Fin de mes cae al último día. */
export function addPeriod(day: IsoDate, every: number, unit: RepeatUnit): IsoDate {
  switch (unit) {
    case 'day':
    case 'week': {
      const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + every * (unit === 'week' ? 7 : 1));
      return date.toISOString().slice(0, 10);
    }
    case 'month':
      return addMonths(day, every);
    case 'year':
      return addMonths(day, every * 12);
  }
}

function repeatsByDate(timing: ReminderTiming): boolean {
  return !!timing.repeat_every && timing.repeat_every > 0 && !!timing.repeat_unit;
}

function repeatsByKm(timing: ReminderTiming): boolean {
  return !!timing.repeat_km && timing.repeat_km > 0;
}

/** Se repite por fecha, por km o por ambos. */
export function repeats(timing: ReminderTiming): boolean {
  return repeatsByDate(timing) || repeatsByKm(timing);
}

/**
 * Cuándo toca otra vez si se hizo el `doneAt` con `doneKm`.
 *
 * Con ancla `done` (aceite cada 2 meses) el periodo cuenta desde que se hizo.
 * Con ancla `due` (refrendo cada 15 de marzo) cuenta desde el vencimiento
 * anterior y salta los periodos que ya pasaron, para no dejar uno vencido.
 * Los km siempre cuentan desde el odómetro con que se hizo.
 */
export function nextOccurrence(timing: ReminderTiming, doneAt: IsoDate, doneKm: number | null): NextOccurrence | null {
  if (!repeats(timing)) return null;

  let dueDate: IsoDate | null = null;
  if (repeatsByDate(timing)) {
    const every = timing.repeat_every!;
    const unit = timing.repeat_unit!;
    if (timing.repeat_anchor === 'due' && timing.due_date) {
      dueDate = addPeriod(timing.due_date, every, unit);
      for (let step = 2; dueDate <= doneAt; step++) {
        // Desde el original y no encadenado: del 31 al 28 y de vuelta al 31.
        dueDate = addPeriod(timing.due_date, every * step, unit);
      }
    } else {
      dueDate = addPeriod(doneAt, every, unit);
    }
  }

  const base = doneKm ?? timing.due_odometer_km;
  const dueKm = repeatsByKm(timing) && base !== null ? base + timing.repeat_km! : null;

  return dueDate || dueKm !== null ? { due_date: dueDate, due_odometer_km: dueKm } : null;
}

/**
 * Lo que llegue primero manda: por fecha o por km. Toca el mismo día o justo
 * en el km todavía es `upcoming`; al siguiente, `overdue`.
 */
export function reminderState(timing: ReminderTiming, today: IsoDate, odometerKm: number | null): ReminderState {
  const days = timing.due_date ? daysUntil(timing.due_date, today) : null;
  const kmLeft = kmRemaining(timing, odometerKm);
  if ((days !== null && days < 0) || (kmLeft !== null && kmLeft < 0)) return 'overdue';
  const notifyDays = timing.notify_days_before ?? DEFAULT_NOTIFY_DAYS;
  const notifyKm = timing.notify_km_before ?? DEFAULT_NOTIFY_KM;
  if ((days !== null && days <= notifyDays) || (kmLeft !== null && kmLeft <= notifyKm)) return 'upcoming';
  return 'ok';
}

function kmRemaining(timing: ReminderTiming, odometerKm: number | null): number | null {
  return timing.due_odometer_km !== null && odometerKm !== null ? timing.due_odometer_km - odometerKm : null;
}

/** Distancia en la unidad del usuario: `UnitsService.formatDistance`. */
export type DistanceFormat = (km: number) => string;

/**
 * "Toca en 12 días · Faltan 300 km", "Se pasó por 3 días". Vacío si no tiene
 * vencimiento.
 */
export function dueLabel(
  timing: ReminderTiming,
  today: IsoDate,
  odometerKm: number | null,
  distance: DistanceFormat = formatKm,
): string {
  const parts: string[] = [];
  if (timing.due_date) {
    const days = daysUntil(timing.due_date, today);
    if (days === 0) parts.push('Toca hoy');
    else if (days === 1) parts.push('Toca mañana');
    else if (days === -1) parts.push('Se pasó por 1 día');
    else parts.push(days > 0 ? `Toca en ${days} días` : `Se pasó por ${-days} días`);
  }
  const kmLeft = kmRemaining(timing, odometerKm);
  if (kmLeft !== null) {
    if (kmLeft === 0) parts.push('Toca ya por km');
    else parts.push(kmLeft > 0 ? `Faltan ${distance(kmLeft)}` : `Se pasó por ${distance(-kmLeft)}`);
  } else if (timing.due_odometer_km !== null) {
    parts.push(`A los ${distance(timing.due_odometer_km)}`);
  }
  return parts.join(' · ');
}

const UNIT: Record<RepeatUnit, readonly [string, string]> = {
  day: ['día', 'días'],
  week: ['semana', 'semanas'],
  month: ['mes', 'meses'],
  year: ['año', 'años'],
};

/** "Cada 2 meses", "Cada año en la misma fecha", "Cada 10,000 km", "Una sola vez". */
export function repeatLabel(timing: ReminderTiming, distance: DistanceFormat = formatKm): string {
  const parts: string[] = [];
  if (repeatsByDate(timing)) {
    const every = timing.repeat_every!;
    const [one, many] = UNIT[timing.repeat_unit!];
    const unit = every === 1 ? `Cada ${one}` : `Cada ${every} ${many}`;
    parts.push(timing.repeat_anchor === 'due' ? `${unit} en la misma fecha` : unit);
  }
  if (repeatsByKm(timing)) {
    const km = distance(timing.repeat_km!);
    parts.push(parts.length ? `o ${km}` : `Cada ${km}`);
  }
  return parts.length ? parts.join(' ') : 'Una sola vez';
}
