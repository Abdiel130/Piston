import type { AttachmentOwner, DomainTable, RowRef } from '../models';

/**
 * Llaves foráneas de cada tabla (columna → tabla). Refleja `SyncRegistry` del
 * servidor.
 *
 * Con esto el motor sabe, antes de enviar, que una carga depende de un
 * vehículo que no ha podido subir: la deja `blocked` en vez de mandarla a que
 * el servidor la rechace, y la suelta sola cuando el vehículo sube.
 */
export const REFERENCES: Readonly<Partial<Record<DomainTable, Readonly<Record<string, DomainTable>>>>> = {
  gauge_calibration_points: { vehicle_id: 'vehicles' },
  odometer_readings: { vehicle_id: 'vehicles' },
  fuel_entries: { vehicle_id: 'vehicles', station_id: 'fuel_stations' },
  fuel_station_prices: { station_id: 'fuel_stations', fuel_entry_id: 'fuel_entries' },
  service_records: { vehicle_id: 'vehicles' },
  service_record_items: { service_record_id: 'service_records', service_type_id: 'service_types' },
  service_parts: { service_record_id: 'service_records' },
  maintenance_schedules: {
    vehicle_id: 'vehicles',
    service_type_id: 'service_types',
    last_service_record_id: 'service_records',
  },
  issues: { vehicle_id: 'vehicles' },
  issue_service_links: { issue_id: 'issues', service_record_id: 'service_records' },
  reminders: { vehicle_id: 'vehicles' },
  recurring_expenses: { vehicle_id: 'vehicles', category_id: 'expense_categories' },
  expenses: {
    vehicle_id: 'vehicles',
    category_id: 'expense_categories',
    recurring_expense_id: 'recurring_expenses',
  },
  documents: { vehicle_id: 'vehicles' },
  trips: { vehicle_id: 'vehicles' },
};

/** Tabla del dueño de un adjunto (`owner_type` no es una FK real en Postgres). */
export const ATTACHMENT_OWNER_TABLE: Readonly<Record<AttachmentOwner, DomainTable>> = {
  vehicle: 'vehicles',
  fuel_entry: 'fuel_entries',
  service_record: 'service_records',
  service_part: 'service_parts',
  expense: 'expenses',
  document: 'documents',
  issue: 'issues',
  trip: 'trips',
};

/** Las filas de las que depende `row` según su payload. */
export function parentsOf(table: DomainTable, row: Record<string, unknown> | null): RowRef[] {
  if (!row) {
    return [];
  }

  const refs: RowRef[] = [];
  for (const [column, parent] of Object.entries(REFERENCES[table] ?? {})) {
    const id = row[column];
    if (typeof id === 'string' && id) {
      refs.push({ table: parent, id });
    }
  }

  if (table === 'attachments' && typeof row['owner_id'] === 'string') {
    const owner = ATTACHMENT_OWNER_TABLE[row['owner_type'] as AttachmentOwner];
    if (owner) {
      refs.push({ table: owner, id: row['owner_id'] });
    }
  }

  return refs;
}

export function refKey(ref: RowRef): string {
  return `${ref.table}/${ref.id}`;
}
