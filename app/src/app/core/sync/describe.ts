import { EMPTY, formatKm, formatLiters, formatMoney, formatShortDate } from '../format';
import type { DomainTable, OutboxOp } from '../models';

/** Nombre en singular de cada tabla, para personas. */
export const TABLE_LABEL: Readonly<Record<DomainTable, string>> = {
  vehicles: 'Vehículo',
  gauge_calibration_points: 'Calibración del tanque',
  odometer_readings: 'Lectura de odómetro',
  fuel_stations: 'Gasolinera',
  fuel_station_prices: 'Precio de gasolinera',
  fuel_entries: 'Carga de combustible',
  service_types: 'Tipo de servicio',
  service_records: 'Servicio',
  service_record_items: 'Concepto de servicio',
  service_parts: 'Refacción',
  maintenance_schedules: 'Plan de mantenimiento',
  issues: 'Falla',
  issue_service_links: 'Falla ligada a servicio',
  reminders: 'Recordatorio',
  expense_categories: 'Categoría de gasto',
  recurring_expenses: 'Gasto recurrente',
  expenses: 'Gasto',
  documents: 'Documento',
  trips: 'Viaje',
  attachments: 'Foto o archivo',
};

export const OP_LABEL: Readonly<Record<OutboxOp | 'upload', string>> = {
  insert: 'Nuevo',
  update: 'Editado',
  delete: 'Borrado',
  upload: 'Archivo',
};

/**
 * Título y detalle legibles de una fila: "Carga de combustible", "30.5 L · 12 sep".
 *
 * Se usa en la lista de cambios y se congela en el historial, así que no debe
 * depender de consultar otras tablas.
 */
export function describeRow(
  table: DomainTable,
  row: Record<string, unknown> | null,
): { title: string; detail: string } {
  const title = TABLE_LABEL[table] ?? table;
  if (!row) {
    return { title, detail: '' };
  }

  const parts = detailParts(table, row).filter((part): part is string => !!part);
  return { title, detail: parts.join(' · ') };
}

/** Una sola línea: "Carga de combustible · 30.5 L · 12 sep". */
export function rowLabel(table: DomainTable, row: Record<string, unknown> | null): string {
  const { title, detail } = describeRow(table, row);
  return detail ? `${title} · ${detail}` : title;
}

function detailParts(table: DomainTable, row: Record<string, unknown>): (string | null)[] {
  switch (table) {
    case 'vehicles':
      return [
        str(row['nickname']) ?? join(row['make'], row['model']),
        str(row['license_plate']),
        num(row['year'])?.toString() ?? null,
      ];
    case 'odometer_readings':
      return [km(row['km']), date(row['read_at'])];
    case 'fuel_entries':
      return [
        liters(row['liters']) ?? money(row['amount_paid']),
        km(row['odometer_km']),
        date(row['filled_at']),
      ];
    case 'service_records':
      return [str(row['shop_name']), money(row['total_cost']), date(row['performed_at'])];
    case 'service_record_items':
      return [str(row['description']), money(row['cost'])];
    case 'service_parts':
      return [str(row['name']), str(row['part_number'])];
    case 'expenses':
      return [str(row['description']), money(row['amount']), date(row['spent_at'])];
    case 'recurring_expenses':
      return [str(row['name']), money(row['amount_estimate'])];
    case 'issues':
      return [str(row['title']), date(row['noticed_at'])];
    case 'documents':
      return [str(row['title']) ?? str(row['type']), date(row['expires_at'])];
    case 'trips':
      return [join(row['origin'], row['destination'], ' → '), date(row['started_at'])];
    case 'reminders':
      return [str(row['title']), date(row['due_date'])];
    case 'attachments':
      return [str(row['file_name'])];
    case 'fuel_stations':
    case 'service_types':
    case 'expense_categories':
      return [str(row['name'])];
    case 'fuel_station_prices':
      return [money(row['price']), date(row['observed_at'])];
    case 'gauge_calibration_points':
      return [num(row['segment']) !== null ? `Rayita ${row['segment']}` : null, liters(row['liters'])];
    default:
      return [];
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function join(a: unknown, b: unknown, separator = ' '): string | null {
  const parts = [str(a), str(b)].filter(Boolean);
  return parts.length ? parts.join(separator) : null;
}

function orNull(text: string): string | null {
  return text === EMPTY ? null : text;
}

function date(value: unknown): string | null {
  return orNull(formatShortDate(value));
}

function km(value: unknown): string | null {
  return orNull(formatKm(value));
}

function liters(value: unknown): string | null {
  return orNull(formatLiters(value));
}

function money(value: unknown): string | null {
  return orNull(formatMoney(value));
}
