import type {
  AttachmentKind,
  AttachmentOwner,
  DocumentType,
  FuelEfficiencyMethod,
  FuelGrade,
  FuelInputMode,
  GaugePointSource,
  IssueSeverity,
  IssueStatus,
  OdometerSource,
  Periodicity,
  PriceSource,
  ReminderKind,
  ReminderStatus,
  ScheduleStatus,
  ServiceCategory,
  StickerColor,
  Transmission,
  TripPurpose,
  UploadStatus,
  VehicleStatus,
  VehicleType,
} from './enums';

/** UUIDv7 en texto. Lo genera el cliente, nunca el servidor. */
export type Uuid = string;

/** Timestamp ISO-8601 con zona (`2026-09-20T14:03:00.000Z`). */
export type IsoDateTime = string;

/** Fecha sin hora (`2026-09-20`). */
export type IsoDate = string;

/**
 * Lo que toda fila de dominio arrastra, en el cliente y en Postgres.
 *
 * `rev` es la posición en la secuencia global del servidor. Una fila creada
 * offline vale 0 hasta que el servidor la acepta: por eso `rev === 0` es la
 * señal de "esto todavía no existe allá".
 */
export interface SyncFields {
  readonly id: Uuid;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  /** Base del last-write-wins. Reloj del dispositivo que hizo el cambio. */
  client_updated_at: IsoDateTime;
  /** Tombstone. No-nulo = borrado; la fila se conserva para propagar el borrado. */
  deleted_at: IsoDateTime | null;
  rev: number;
}

export interface Vehicle extends SyncFields {
  user_id: Uuid | null;
  nickname: string | null;
  make: string;
  model: string;
  year: number;
  trim: string | null;
  vehicle_type: VehicleType;
  transmission: Transmission | null;
  engine_displacement_l: number | null;
  color: string | null;
  vin: string | null;
  license_plate: string | null;

  plate_last_digit: number | null;
  emissions_sticker: StickerColor;

  default_fuel_grade: FuelGrade;
  tank_capacity_l: number;
  /** Rayitas que dibuja el indicador. El diferenciador de la app. */
  gauge_total_segments: number;
  factory_km_per_liter: number | null;
  oil_capacity_l: number | null;
  oil_spec: string | null;
  tire_pressure_front_psi: number | null;
  tire_pressure_rear_psi: number | null;

  /** Caché de MAX(odometer_readings.km). La serie temporal manda. */
  current_odometer_km: number;

  purchase_date: IsoDate | null;
  purchase_price: number | null;
  purchase_odometer_km: number | null;
  sale_date: IsoDate | null;
  sale_price: number | null;
  sale_odometer_km: number | null;

  status: VehicleStatus;
  is_primary: boolean;
  notes: string | null;
}

export interface GaugeCalibrationPoint extends SyncFields {
  vehicle_id: Uuid;
  /** Posición de la aguja, 0..gauge_total_segments. Decimal: media rayita existe. */
  segment: number;
  /** Litros REALES en esa posición, según lo aprendido con cargas a tanque lleno. */
  liters: number;
  source: GaugePointSource;
  measured_at: IsoDateTime | null;
  sample_count: number;
}

export interface OdometerReading extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  read_at: IsoDateTime;
  km: number;
  source: OdometerSource;
  source_id: Uuid | null;
  /** Retrocede o salta de forma imposible. Se marca, no se rechaza. */
  is_suspect: boolean;
}

export interface FuelStation extends SyncFields {
  user_id: Uuid | null;
  brand: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  external_ref: string | null;
  notes: string | null;
}

export interface FuelStationPrice extends SyncFields {
  user_id: Uuid | null;
  station_id: Uuid;
  fuel_grade: FuelGrade;
  price: number;
  observed_at: IsoDateTime;
  source: PriceSource;
  fuel_entry_id: Uuid | null;
}

export interface FuelEntry extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  station_id: Uuid | null;

  filled_at: IsoDateTime;
  odometer_km: number;
  fuel_grade: FuelGrade;

  /** Qué escribió de verdad el usuario. Todo lo demás es derivado. */
  input_mode: FuelInputMode;
  amount_paid: number | null;
  price_per_liter: number | null;
  liters: number | null;
  gauge_before: number | null;
  gauge_after: number | null;
  gauge_total_segments: number | null;

  is_full_tank: boolean;
  is_partial: boolean;
  /** Rompe la cadena de cálculo en vez de ensuciar el promedio. */
  missed_previous: boolean;

  liters_before_est: number | null;
  liters_after_est: number | null;
  distance_km: number | null;
  km_per_liter: number | null;
  cost_per_km: number | null;
  efficiency_method: FuelEfficiencyMethod;
  is_efficiency_outlier: boolean;
  recomputed_at: IsoDateTime | null;

  notes: string | null;
}

export interface ServiceType extends SyncFields {
  user_id: Uuid | null;
  name: string;
  category: ServiceCategory;
  applies_to: VehicleType | null;
  default_interval_km: number | null;
  default_interval_months: number | null;
  icon: string | null;
  is_system: boolean;
}

export interface ServiceRecord extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  performed_at: IsoDate;
  odometer_km: number;
  shop_name: string | null;
  shop_phone: string | null;
  is_diy: boolean;
  labor_cost: number;
  parts_cost: number;
  total_cost: number;
  currency: string;
  notes: string | null;
}

export interface ServiceRecordItem extends SyncFields {
  service_record_id: Uuid;
  service_type_id: Uuid;
  description: string | null;
  cost: number | null;
}

export interface ServicePart extends SyncFields {
  service_record_id: Uuid;
  name: string;
  brand: string | null;
  part_number: string | null;
  quantity: number;
  unit: string | null;
  unit_cost: number;
  warranty_months: number | null;
  warranty_km: number | null;
}

export interface MaintenanceSchedule extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  service_type_id: Uuid;
  interval_km: number | null;
  interval_months: number | null;

  last_service_record_id: Uuid | null;
  last_done_at: IsoDate | null;
  last_done_km: number | null;

  next_due_km: number | null;
  next_due_date: IsoDate | null;
  /** Semáforo cacheado: depende del odómetro actual, se recalcula. */
  status: ScheduleStatus;
  is_active: boolean;
}

export interface Issue extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  noticed_at: IsoDate;
  noticed_odometer_km: number | null;
  resolved_at: IsoDate | null;
  resolved_odometer_km: number | null;
}

export interface IssueServiceLink extends SyncFields {
  issue_id: Uuid;
  service_record_id: Uuid;
  /** Saber qué NO arregló el síntoma vale tanto como saber qué sí. */
  resolved_it: boolean;
}

export interface Reminder extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  kind: ReminderKind;
  source_id: Uuid | null;
  title: string;
  due_date: IsoDate | null;
  due_odometer_km: number | null;
  notify_days_before: number | null;
  notify_km_before: number | null;
  status: ReminderStatus;
  last_notified_at: IsoDateTime | null;
}

export interface ExpenseCategory extends SyncFields {
  user_id: Uuid | null;
  name: string;
  icon: string | null;
  is_system: boolean;
}

export interface Expense extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  category_id: Uuid;
  recurring_expense_id: Uuid | null;
  spent_at: IsoDate;
  odometer_km: number | null;
  amount: number;
  currency: string;
  description: string | null;
  notes: string | null;
}

export interface RecurringExpense extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  category_id: Uuid;
  name: string;
  amount_estimate: number | null;
  periodicity: Periodicity;
  interval_days: number | null;
  next_due_date: IsoDate;
  auto_create: boolean;
  is_active: boolean;
}

export interface VehicleDocument extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  type: DocumentType;
  title: string | null;
  issuer: string | null;
  reference: string | null;
  coverage: string | null;
  issued_at: IsoDate | null;
  expires_at: IsoDate | null;
  cost: number | null;
  notes: string | null;
}

export interface Trip extends SyncFields {
  user_id: Uuid | null;
  vehicle_id: Uuid;
  started_at: IsoDateTime;
  ended_at: IsoDateTime | null;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
  distance_km: number | null;
  origin: string | null;
  destination: string | null;
  purpose: TripPurpose;
  notes: string | null;
}

export interface Attachment extends SyncFields {
  user_id: Uuid | null;
  owner_type: AttachmentOwner;
  owner_id: Uuid;
  kind: AttachmentKind;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  /** Ruta en el servidor. NULL mientras el binario no haya subido. */
  storage_path: string | null;
  /** Clave del Blob en IndexedDB. Solo cliente: nunca viaja al servidor. */
  local_blob_key: string | null;
  upload_status: UploadStatus;
  sort_order: number;
}

/** Binario diferido. CLIENT-ONLY: la foto se ve al instante, sube después. */
export interface AttachmentBlob {
  readonly key: string;
  attachment_id: Uuid;
  blob: Blob;
  created_at: IsoDateTime;
}
