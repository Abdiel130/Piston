import { formatKm, formatLongDate } from '../../core/format';
import type { MaintenanceSchedule, ScheduleStatus } from '../../core/models';

/** Cómo se pinta el estado GUARDADO de un plan. El estado lo calcula el motor, no la pantalla. */
export const SCHEDULE_TONE: Readonly<
  Record<ScheduleStatus, { tone: 'good' | 'warn' | 'bad' | 'idle'; label: string }>
> = {
  optimal: { tone: 'good', label: 'En regla' },
  warning: { tone: 'warn', label: 'Próximo' },
  urgent: { tone: 'bad', label: 'Vencido' },
  unknown: { tone: 'idle', label: 'Sin datos' },
};

/**
 * "A los 49,130 km o el 12 mar 2027": lo guardado en el plan, tal cual.
 * `distance` presenta los km en la unidad del usuario.
 */
export function scheduleDue(
  schedule: MaintenanceSchedule,
  distance: (km: number) => string = formatKm,
): string {
  const parts = [
    schedule.next_due_km !== null ? `a los ${distance(schedule.next_due_km)}` : null,
    schedule.next_due_date ? `el ${formatLongDate(schedule.next_due_date)}` : null,
  ].filter(Boolean);
  return parts.length ? `Toca ${parts.join(' o ')}` : 'Sin fecha ni kilometraje de referencia';
}
