import { EMPTY, formatKm, formatLiters, formatLongDate, formatMoney, formatNumber } from '../../core/format';
import type { DomainTable, SyncConflictKind, SyncTrigger } from '../../core/models';
import type { IconName } from '../../shared/icon/icon.component';

const exactFormat = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
});

const dayFormat = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "28 sept 2026, 21:03:12.345": lo que se busca en los logs del servidor, en hora local. */
export function exactLocal(iso: string | null | undefined): string {
  return iso ? exactFormat.format(new Date(iso)) : '—';
}

/** El mismo instante en UTC, que es como lo escribe el servidor en sus logs. */
export function exactUtc(iso: string | null | undefined): string {
  return iso ? new Date(iso).toISOString().replace('T', ' ').replace('Z', ' UTC') : '—';
}

export function clock(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** "Hoy", "Ayer" o "lunes 21 de septiembre". */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
  const label = dayFormat.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "hace un momento", "hace 5 min", "en 3 min". */
export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca';
  const diff = new Date(iso).getTime() - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const future = diff > 0;

  if (minutes < 1) return future ? 'en unos segundos' : 'hace un momento';
  if (minutes < 60) return future ? `en ${minutes} min` : `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `en ${hours} h` : `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return future ? `en ${days} d` : `hace ${days} d`;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const TABLE_ICON: Readonly<Partial<Record<DomainTable, IconName>>> = {
  vehicles: 'car',
  gauge_calibration_points: 'gauge',
  odometer_readings: 'road',
  fuel_stations: 'mapPin',
  fuel_station_prices: 'fuel',
  fuel_entries: 'fuel',
  service_types: 'wrench',
  service_records: 'wrench',
  service_record_items: 'wrench',
  service_parts: 'wrench',
  maintenance_schedules: 'calendar',
  issues: 'alert',
  issue_service_links: 'alert',
  reminders: 'bell',
  expense_categories: 'receipt',
  recurring_expenses: 'receipt',
  expenses: 'receipt',
  documents: 'document',
  trips: 'road',
  attachments: 'camera',
};

export const TRIGGER_LABEL: Readonly<Record<SyncTrigger, string>> = {
  startup: 'Al abrir la app',
  change: 'Por un cambio',
  online: 'Al volver la conexión',
  focus: 'Al volver a la app',
  interval: 'Revisión periódica',
  manual: 'Manual',
  login: 'Al iniciar sesión',
  background: 'En segundo plano',
};

/** Nombre legible de una columna: `odometer_km` → "Odometer km". Sin traducir, pero legible. */
export function fieldLabel(field: string): string {
  const known: Record<string, string> = {
    vehicle_id: 'Vehículo',
    make: 'Marca',
    model: 'Modelo',
    year: 'Año',
    liters: 'Litros',
    amount: 'Monto',
    amount_paid: 'Monto pagado',
    price_per_liter: 'Precio por litro',
    odometer_km: 'Odómetro (km)',
    km: 'Kilómetros',
    filled_at: 'Fecha de carga',
    spent_at: 'Fecha del gasto',
    performed_at: 'Fecha del servicio',
    category_id: 'Categoría',
    service_type_id: 'Tipo de servicio',
    tank_capacity_l: 'Capacidad del tanque (L)',
    gauge_before: 'Rayitas antes',
    gauge_after: 'Rayitas después',
    total_cost: 'Costo total',
    notes: 'Notas',
    description: 'Descripción',
    license_plate: 'Placa',
    nickname: 'Apodo',
    client_updated_at: 'Fecha de modificación',
    owner_id: 'Registro dueño',
    file: 'Archivo',
  };
  if (known[field]) return known[field];
  const text = field.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Causa corta de un conflicto, para la fila de la lista. */
export const CONFLICT_SHORT: Readonly<Record<SyncConflictKind, string>> = {
  edit_edit: 'Editado en otro dispositivo',
  edit_delete: 'Borrado en otro dispositivo',
  create_in_deleted_parent: 'Su registro se borró',
};

const dateTimeFormat = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Un valor de una columna como lo lee una persona: km, litros, pesos, fechas.
 * Se decide por el nombre de la columna, igual que en `fieldLabel`.
 */
export function fieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';

  const numeric = typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;
  if (typeof numeric === 'number') {
    if (field === 'km' || field.endsWith('_km')) return formatKm(numeric);
    if (field === 'liters' || field.endsWith('_l') || field.startsWith('liters_')) return formatLiters(numeric);
    if (/(amount|price|cost)/.test(field)) return formatMoney(numeric);
    return formatNumber(numeric);
  }

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatLongDate(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : dateTimeFormat.format(date);
    }
    return value;
  }
  return JSON.stringify(value);
}
