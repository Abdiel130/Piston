/**
 * Enums del dominio. Son exactamente los de `docs/schema.dbml`: los valores
 * viajan tal cual al backend, así que cambiar una cadena aquí rompe el sync.
 */

export type VehicleType = 'car' | 'motorcycle' | 'pickup' | 'truck' | 'van';
export type VehicleStatus = 'active' | 'archived' | 'sold';
export type Transmission = 'manual' | 'automatic' | 'cvt' | 'dsg';
export type FuelGrade = 'regular' | 'premium' | 'diesel';
export type StickerColor = 'yellow' | 'pink' | 'red' | 'green' | 'blue' | 'none';

export type GaugePointSource = 'default_linear' | 'user_measured' | 'manual';

export type OdometerSource = 'manual' | 'fuel' | 'service' | 'trip' | 'expense' | 'document';

export type FuelInputMode = 'by_amount' | 'by_liters' | 'by_segments';
export type FuelEfficiencyMethod = 'full_to_full' | 'gauge_estimate' | 'none';

export type PriceSource = 'self_reported' | 'from_fuel_entry' | 'imported';

export type ServiceCategory =
  | 'oil_filters'
  | 'brakes'
  | 'suspension'
  | 'tires'
  | 'engine'
  | 'transmission'
  | 'electrical'
  | 'body'
  | 'general';

export type ScheduleStatus = 'optimal' | 'warning' | 'urgent' | 'unknown';

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueStatus = 'open' | 'monitoring' | 'resolved' | 'dismissed';

export type ReminderKind = 'service' | 'document' | 'custom';
export type ReminderStatus = 'pending' | 'notified' | 'done' | 'dismissed';

export type Periodicity = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom_days';

export type DocumentType =
  | 'insurance'
  | 'emissions_check'
  | 'ownership_tax'
  | 'circulation_card'
  | 'driver_license'
  | 'warranty'
  | 'other';

export type TripPurpose = 'personal' | 'work' | 'mixed' | 'other';

export type AttachmentOwner =
  | 'vehicle'
  | 'fuel_entry'
  | 'service_record'
  | 'service_part'
  | 'expense'
  | 'document'
  | 'issue'
  | 'trip';
export type AttachmentKind = 'photo' | 'invoice' | 'document_scan' | 'receipt' | 'other';
export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export type OutboxOp = 'insert' | 'update' | 'delete';
export type OutboxStatus = 'pending' | 'in_flight' | 'failed';
