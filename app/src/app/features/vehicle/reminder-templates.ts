import type { RepeatAnchor, RepeatUnit } from '../../core/models';
import type { IconName } from '../../shared/icon/icon.component';

/**
 * Recordatorios comunes de un auto. Solo prellenan el formulario: todo se
 * puede cambiar antes de guardar, y después.
 *
 * Los de fecha fija (`due`) son trámites con fecha del calendario; los de
 * periodo (`done`) son revisiones que cuentan desde la última vez.
 */
export interface ReminderTemplate {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  readonly repeat_every: number | null;
  readonly repeat_unit: RepeatUnit | null;
  readonly repeat_km: number | null;
  readonly repeat_anchor: RepeatAnchor;
  readonly notify_days_before: number;
  readonly notify_km_before: number;
  /** El vencimiento sale del calendario de verificación del vehículo. */
  readonly emissions?: boolean;
}

export const REMINDER_TEMPLATES: readonly ReminderTemplate[] = [
  {
    id: 'ownership-tax',
    title: 'Pago de refrendo',
    icon: 'receipt',
    repeat_every: 1,
    repeat_unit: 'year',
    repeat_km: null,
    repeat_anchor: 'due',
    notify_days_before: 30,
    notify_km_before: 500,
  },
  {
    id: 'emissions',
    title: 'Verificación',
    icon: 'document',
    repeat_every: 6,
    repeat_unit: 'month',
    repeat_km: null,
    repeat_anchor: 'due',
    notify_days_before: 30,
    notify_km_before: 500,
    emissions: true,
  },
  {
    id: 'oil',
    title: 'Revisar nivel de aceite',
    icon: 'droplet',
    repeat_every: 2,
    repeat_unit: 'month',
    repeat_km: null,
    repeat_anchor: 'done',
    notify_days_before: 7,
    notify_km_before: 500,
  },
  {
    id: 'coolant',
    title: 'Revisar anticongelante',
    icon: 'droplet',
    repeat_every: 1,
    repeat_unit: 'month',
    repeat_km: null,
    repeat_anchor: 'done',
    notify_days_before: 5,
    notify_km_before: 500,
  },
  {
    id: 'tire-pressure',
    title: 'Presión de llantas',
    icon: 'tire',
    repeat_every: 2,
    repeat_unit: 'week',
    repeat_km: null,
    repeat_anchor: 'done',
    notify_days_before: 2,
    notify_km_before: 500,
  },
  {
    id: 'tire-rotation',
    title: 'Rotación de llantas',
    icon: 'tire',
    repeat_every: null,
    repeat_unit: null,
    repeat_km: 10_000,
    repeat_anchor: 'done',
    notify_days_before: 15,
    notify_km_before: 500,
  },
  {
    id: 'brake-fluid',
    title: 'Revisar líquido de frenos',
    icon: 'wrench',
    repeat_every: 6,
    repeat_unit: 'month',
    repeat_km: null,
    repeat_anchor: 'done',
    notify_days_before: 7,
    notify_km_before: 500,
  },
  {
    id: 'battery',
    title: 'Revisar batería',
    icon: 'spark',
    repeat_every: 6,
    repeat_unit: 'month',
    repeat_km: null,
    repeat_anchor: 'done',
    notify_days_before: 7,
    notify_km_before: 500,
  },
];

export function reminderTemplate(id: string | null | undefined): ReminderTemplate | null {
  return REMINDER_TEMPLATES.find((template) => template.id === id) ?? null;
}
