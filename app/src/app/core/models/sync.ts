import type { IsoDateTime, SyncFields, Uuid } from './domain';
import type { OutboxOp, OutboxStatus } from './enums';

/** Nombre de una tabla de dominio, tal como la conoce el servidor. */
export type DomainTable =
  | 'vehicles'
  | 'gauge_calibration_points'
  | 'odometer_readings'
  | 'fuel_stations'
  | 'fuel_station_prices'
  | 'fuel_entries'
  | 'service_types'
  | 'service_records'
  | 'service_record_items'
  | 'service_parts'
  | 'maintenance_schedules'
  | 'issues'
  | 'issue_service_links'
  | 'reminders'
  | 'expense_categories'
  | 'recurring_expenses'
  | 'expenses'
  | 'documents'
  | 'trips'
  | 'attachments';

/**
 * Orden de aplicación de las tablas.
 *
 * Los padres van antes que los hijos. Importa al empujar mutaciones: si un
 * `fuel_entry` llega antes que su `vehicle`, el servidor rechaza la FK. Con
 * UUID del cliente no hay que reescribir ids, pero el ORDEN sigue importando.
 */
export const TABLE_ORDER: readonly DomainTable[] = [
  'vehicles',
  'gauge_calibration_points',
  'odometer_readings',
  'fuel_stations',
  'service_types',
  'expense_categories',
  'fuel_entries',
  'fuel_station_prices',
  'service_records',
  'service_record_items',
  'service_parts',
  'maintenance_schedules',
  'issues',
  'issue_service_links',
  'recurring_expenses',
  'expenses',
  'documents',
  'trips',
  'reminders',
  'attachments',
];

/**
 * Una mutación esperando su turno. CLIENT-ONLY.
 *
 * Se guarda el registro COMPLETO, no un diff: si el usuario edita la misma
 * fila cinco veces sin conexión, la entrada se reemplaza en lugar de apilar
 * cinco parches que habría que reproducir en orden.
 */
export interface OutboxEntry {
  readonly id: Uuid;
  table_name: DomainTable;
  row_id: Uuid;
  op: OutboxOp;
  /** JSON del registro completo. NULL cuando `op === 'delete'`. */
  payload: string | null;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  /** Antes de esta hora no se reintenta. Así funciona el backoff. */
  next_retry_at: IsoDateTime;
  created_at: IsoDateTime;
}

/**
 * Cursor del sync delta. CLIENT-ONLY.
 *
 * La secuencia `rev` de Postgres es GLOBAL (una sola para las 20 tablas), así
 * que un único cursor basta. Se conserva la forma por tabla del schema para
 * poder sincronizar tablas por separado más adelante.
 */
export interface SyncState {
  readonly table_name: DomainTable | typeof GLOBAL_CURSOR;
  last_rev: number;
  last_synced_at: IsoDateTime | null;
}

/** Clave del cursor único que cubre todas las tablas. */
export const GLOBAL_CURSOR = '*' as const;

/** Lo que el cliente manda en `POST /api/sync`. */
export interface SyncPushMutation {
  readonly table: DomainTable;
  readonly id: Uuid;
  readonly op: OutboxOp;
  readonly payload: Record<string, unknown> | null;
}

/** Lo que el servidor responde a un push. */
export interface SyncPushResponse {
  /** Filas aplicadas, ya con el `rev` que les asignó el trigger. */
  readonly applied: readonly SyncAppliedRow[];
  /** Rechazos definitivos: reintentar no ayuda, hay que sacarlos de la cola. */
  readonly rejected: readonly SyncRejectedRow[];
  readonly server_rev: number;
}

export interface SyncAppliedRow {
  readonly table: DomainTable;
  readonly id: Uuid;
  readonly rev: number;
}

export interface SyncRejectedRow {
  readonly table: DomainTable;
  readonly id: Uuid;
  readonly reason: string;
}

/** Lo que el servidor responde a `GET /api/sync?since=<rev>`. */
export interface SyncPullResponse {
  /** Cambios por tabla, tombstones incluidos, ordenados por `rev`. */
  readonly changes: Partial<Record<DomainTable, readonly SyncFields[]>>;
  /** Cursor a guardar. */
  readonly server_rev: number;
  /** El servidor truncó la respuesta: hay que volver a pedir desde server_rev. */
  readonly has_more: boolean;
}
