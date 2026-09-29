import type { ApiCode } from './api';
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
  /** JSON del registro completo (en `delete`, el tombstone). NULL en entradas anteriores a v3. */
  payload: string | null;
  status: OutboxStatus;
  attempts: number;
  /** Diagnóstico del último intento fallido. Es lo que ve el detalle del cambio. */
  last_attempt: SyncAttempt | null;
  /** Fila de la que depende y que no ha podido subir (solo con `status === 'blocked'`). */
  blocked_by: RowRef | null;
  /** Antes de esta hora no se reintenta. Así funciona el backoff. */
  next_retry_at: IsoDateTime;
  created_at: IsoDateTime;
}

export interface RowRef {
  readonly table: DomainTable;
  readonly id: Uuid;
}

/**
 * Por qué no subió algo. Decide si se reintenta solo y qué se le explica al
 * usuario (ver `core/sync/diagnosis.ts`).
 */
export type SyncFailureKind =
  // Transitorios: se reintentan solos con backoff, sin límite.
  | 'offline'
  | 'server_unreachable'
  | 'timeout'
  | 'server_error'
  | 'unavailable'
  | 'rate_limited'
  | 'endpoint_missing'
  // Pausa: falta iniciar sesión; no cuenta como intento.
  | 'auth'
  // Definitivos: el servidor rechazó el dato; reintentarlo igual no cambia nada.
  | 'validation'
  | 'forbidden'
  | 'conflict'
  | 'parent_missing'
  | 'payload_too_large'
  | 'client_bug';

/** Un intento fallido, con todo lo necesario para rastrearlo en los logs del servidor. */
export interface SyncAttempt {
  readonly at: IsoDateTime;
  readonly kind: SyncFailureKind;
  /** `null` = no hubo respuesta HTTP (sin red, timeout, servidor caído). */
  readonly http_status: number | null;
  readonly code: ApiCode | null;
  readonly message: string;
  /** El `X-Request-Id` que mandó el cliente. Existe aunque no haya llegado respuesta. */
  readonly request_id: string | null;
  readonly field_errors: Readonly<Record<string, readonly string[]>> | null;
  readonly duration_ms: number | null;
  readonly retry_after_s: number | null;
}

export type SyncTrigger =
  | 'startup'
  | 'change'
  | 'online'
  | 'focus'
  | 'interval'
  | 'manual'
  | 'login'
  /** El service worker, con la app cerrada (solo sube pendientes). */
  | 'background';

/** Un ciclo de sincronización. CLIENT-ONLY: es el "Historial". */
export interface SyncRun {
  readonly id: Uuid;
  readonly started_at: IsoDateTime;
  finished_at: IsoDateTime | null;
  readonly trigger: SyncTrigger;
  pushed: number;
  applied: number;
  stale: number;
  rejected: number;
  pulled: number;
  uploaded: number;
  outcome: 'ok' | 'partial' | 'failed' | 'auth' | 'running';
  /** El fallo que cortó el ciclo, si lo hubo. */
  error: SyncAttempt | null;
  request_ids: string[];
}

export type SyncLogOutcome = 'applied' | 'stale' | 'rejected' | 'discarded' | 'uploaded' | 'upload_failed';

/** Lo que pasó con un cambio concreto dentro de un ciclo. CLIENT-ONLY. */
export interface SyncLogEntry {
  readonly id: Uuid;
  readonly run_id: Uuid | null;
  readonly at: IsoDateTime;
  readonly table_name: DomainTable;
  readonly row_id: Uuid;
  readonly op: OutboxOp | 'upload';
  /** Descripción legible congelada al momento del evento (la fila puede cambiar después). */
  readonly label: string;
  readonly outcome: SyncLogOutcome;
  readonly request_id: string | null;
  readonly attempt: SyncAttempt | null;
}

/**
 * Cursor del sync delta. CLIENT-ONLY.
 *
 * `last_synced_at` de la fila GLOBAL_CURSOR es la hora del último ciclo que
 * terminó bien, aunque no haya traído nada.
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
  /** Informativo. NO es un cursor: usarlo como tal se saltaría cambios de otros dispositivos. */
  readonly server_rev: number;
}

export interface SyncAppliedRow {
  readonly table: DomainTable;
  readonly id: Uuid;
  /** 0 = borrado de algo que el servidor nunca tuvo. */
  readonly rev: number;
  /** El servidor tenía una versión más reciente y no la pisó; el pull la trae. */
  readonly stale?: boolean;
}

export interface SyncRejectedRow {
  readonly table: DomainTable;
  readonly id: Uuid;
  readonly code: ApiCode;
  readonly message: string;
  readonly errors?: Readonly<Record<string, readonly string[]>> | null;
}

/** Lo que el servidor responde a `GET /api/sync?since=<rev>`. */
export interface SyncPullResponse {
  /** Cambios por tabla, tombstones incluidos, ordenados por `rev`. */
  readonly changes: Partial<Record<DomainTable, readonly SyncFields[]>>;
  /** Cursor a guardar: el `rev` de la última fila entregada. */
  readonly server_rev: number;
  /** El servidor truncó la respuesta: hay que volver a pedir desde server_rev. */
  readonly has_more: boolean;
}
