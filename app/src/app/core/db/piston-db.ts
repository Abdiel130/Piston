import Dexie, { type Table } from 'dexie';
import type {
  Attachment,
  AttachmentBlob,
  Expense,
  ExpenseCategory,
  FuelEntry,
  FuelStation,
  FuelStationPrice,
  GaugeCalibrationPoint,
  Issue,
  IssueServiceLink,
  MaintenanceSchedule,
  OdometerReading,
  OutboxEntry,
  RecurringExpense,
  Reminder,
  ServicePart,
  ServiceRecord,
  ServiceRecordItem,
  ServiceType,
  SyncState,
  Trip,
  Uuid,
  Vehicle,
  VehicleDocument,
} from '../models';

/**
 * IndexedDB local. Es la fuente de verdad mientras no haya red.
 *
 * Dos decisiones que marcan todo lo demás:
 *
 * 1. La clave primaria es `id` (UUIDv7 del cliente), NUNCA `++id`. Un
 *    autoincremental local produce claves que colisionan entre dispositivos y
 *    obliga a mapear id-local → id-servidor al sincronizar.
 *
 * 2. Los índices llevan `deleted_at` en compuestos donde importa. Dexie no
 *    indexa `undefined`, pero aquí el tombstone se guarda como `null`, que sí
 *    es indexable; el filtrado de borrados vive en el repositorio para que
 *    ninguna consulta de pantalla tenga que acordarse.
 */
export class PistonDb extends Dexie {
  // ── Dominio (se sincronizan) ──────────────────────────────────────────
  vehicles!: Table<Vehicle, Uuid>;
  gauge_calibration_points!: Table<GaugeCalibrationPoint, Uuid>;
  odometer_readings!: Table<OdometerReading, Uuid>;
  fuel_stations!: Table<FuelStation, Uuid>;
  fuel_station_prices!: Table<FuelStationPrice, Uuid>;
  fuel_entries!: Table<FuelEntry, Uuid>;
  service_types!: Table<ServiceType, Uuid>;
  service_records!: Table<ServiceRecord, Uuid>;
  service_record_items!: Table<ServiceRecordItem, Uuid>;
  service_parts!: Table<ServicePart, Uuid>;
  maintenance_schedules!: Table<MaintenanceSchedule, Uuid>;
  issues!: Table<Issue, Uuid>;
  issue_service_links!: Table<IssueServiceLink, Uuid>;
  reminders!: Table<Reminder, Uuid>;
  expense_categories!: Table<ExpenseCategory, Uuid>;
  recurring_expenses!: Table<RecurringExpense, Uuid>;
  expenses!: Table<Expense, Uuid>;
  documents!: Table<VehicleDocument, Uuid>;
  trips!: Table<Trip, Uuid>;
  attachments!: Table<Attachment, Uuid>;

  // ── Solo cliente (no existen en Postgres) ─────────────────────────────
  sync_outbox!: Table<OutboxEntry, Uuid>;
  sync_state!: Table<SyncState, string>;
  attachment_blobs!: Table<AttachmentBlob, string>;

  constructor() {
    super('piston');

    this.version(1).stores({
      vehicles: 'id, status, is_primary, deleted_at, rev, [status+deleted_at]',
      gauge_calibration_points: 'id, vehicle_id, [vehicle_id+segment], rev',
      odometer_readings: 'id, vehicle_id, [vehicle_id+read_at], [vehicle_id+km], rev',
      fuel_stations: 'id, name, brand, external_ref, rev',
      fuel_station_prices: 'id, station_id, [station_id+fuel_grade+observed_at], fuel_entry_id, rev',
      fuel_entries: 'id, vehicle_id, [vehicle_id+filled_at], [vehicle_id+odometer_km], station_id, rev',
      service_types: 'id, category, is_system, applies_to, rev',
      service_records: 'id, vehicle_id, [vehicle_id+performed_at], [vehicle_id+odometer_km], rev',
      service_record_items: 'id, service_record_id, service_type_id, rev',
      service_parts: 'id, service_record_id, part_number, rev',
      maintenance_schedules: 'id, vehicle_id, [vehicle_id+service_type_id], [vehicle_id+status], rev',
      issues: 'id, vehicle_id, [vehicle_id+status], rev',
      issue_service_links: 'id, issue_id, service_record_id, [issue_id+service_record_id], rev',
      reminders: 'id, vehicle_id, status, [status+due_date], rev',
      expense_categories: 'id, is_system, rev',
      recurring_expenses: 'id, vehicle_id, next_due_date, rev',
      expenses: 'id, vehicle_id, [vehicle_id+spent_at], [vehicle_id+category_id], category_id, rev',
      documents: 'id, vehicle_id, [vehicle_id+type], expires_at, rev',
      trips: 'id, vehicle_id, [vehicle_id+started_at], rev',
      attachments: 'id, [owner_type+owner_id], upload_status, rev',

      sync_outbox: 'id, status, [status+next_retry_at], [table_name+row_id], created_at',
      sync_state: 'table_name',
      attachment_blobs: 'key, attachment_id',
    });
  }
}

/**
 * Instancia única, fuera de Angular a propósito.
 *
 * Dexie mantiene conexiones y transacciones abiertas; si la creara un servicio
 * inyectable, un test que reconstruye el inyector abriría una segunda conexión
 * contra la misma base y Dexie bloquearía el upgrade de versión.
 */
export const db = new PistonDb();
