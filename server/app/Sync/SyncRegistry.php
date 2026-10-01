<?php

namespace App\Sync;

use App\Models\Domain;
use App\Sync\Field as F;

/**
 * Las 20 tablas que viajan por `/api/sync`, en orden de dependencia.
 *
 * Es la única fuente de verdad del sync en el servidor: qué columnas acepta el
 * push y con qué reglas, de quién es cada fila y cómo se castea al jalar. Las
 * columnas reflejan las migraciones de 2026_09_20_*; si una migración agrega o
 * cambia una columna del dominio, se refleja aquí.
 *
 * Lo que NO está en `fields` no lo puede escribir el cliente: `user_id` (lo
 * pone el servidor), las columnas de sync (`rev`, timestamps) y lo que el
 * servidor administra, como `storage_path` y `upload_status` de un adjunto.
 * `local_blob_key` tampoco: es la llave del binario en el IndexedDB de UN
 * dispositivo y en cualquier otro no significa nada.
 */
final class SyncRegistry
{
    private const VEHICLE_TYPES = ['car', 'motorcycle', 'pickup', 'truck', 'van'];

    private const FUEL_GRADES = ['regular', 'premium', 'diesel'];

    /** @var array<string, SyncTable>|null */
    private static ?array $tables = null;

    /** @return array<string, SyncTable> nombre → tabla, padres antes que hijos */
    public static function all(): array
    {
        return self::$tables ??= self::build();
    }

    public static function find(string $name): ?SyncTable
    {
        return self::all()[$name] ?? null;
    }

    /** @return array<string, SyncTable> */
    private static function build(): array
    {
        $tables = [
            new SyncTable('vehicles', Domain\Vehicle::class, Ownership::User, [
                'nickname' => F::string(60)->nullable(),
                'make' => F::string(60),
                'model' => F::string(80),
                'year' => F::smallInteger(),
                'trim' => F::string(80)->nullable(),
                'vehicle_type' => F::enum(self::VEHICLE_TYPES)->withDefault(),
                'transmission' => F::enum(['manual', 'automatic', 'cvt', 'dsg'])->nullable(),
                'engine_displacement_l' => F::decimal(4, 1)->nullable(),
                'color' => F::string(40)->nullable(),
                'vin' => F::string(17)->nullable(),
                'license_plate' => F::string(15)->nullable(),
                'plate_last_digit' => F::smallInteger()->nullable(),
                'emissions_sticker' => F::enum(['yellow', 'pink', 'red', 'green', 'blue', 'none'])->withDefault(),
                'default_fuel_grade' => F::enum(self::FUEL_GRADES)->withDefault(),
                'tank_capacity_l' => F::decimal(6, 2),
                'gauge_total_segments' => F::smallInteger()->withDefault(),
                'factory_km_per_liter' => F::decimal(5, 2)->nullable(),
                'oil_capacity_l' => F::decimal(4, 2)->nullable(),
                'oil_spec' => F::string(40)->nullable(),
                'tire_pressure_front_psi' => F::smallInteger()->nullable(),
                'tire_pressure_rear_psi' => F::smallInteger()->nullable(),
                'current_odometer_km' => F::integer()->withDefault(),
                'purchase_date' => F::date()->nullable(),
                'purchase_price' => F::decimal(12, 2)->nullable(),
                'purchase_odometer_km' => F::integer()->nullable(),
                'sale_date' => F::date()->nullable(),
                'sale_price' => F::decimal(12, 2)->nullable(),
                'sale_odometer_km' => F::integer()->nullable(),
                'status' => F::enum(['active', 'archived', 'sold'])->withDefault(),
                'is_primary' => F::boolean()->withDefault(),
                'notes' => F::text()->nullable(),
            ]),

            new SyncTable('gauge_calibration_points', Domain\GaugeCalibrationPoint::class, Ownership::Parent, [
                'vehicle_id' => F::ref('vehicles'),
                'segment' => F::decimal(5, 2),
                'liters' => F::decimal(6, 2),
                'source' => F::enum(['default_linear', 'user_measured', 'manual'])->withDefault(),
                'measured_at' => F::dateTime()->nullable(),
                'sample_count' => F::smallInteger()->withDefault(),
            ], parentColumn: 'vehicle_id'),

            new SyncTable('odometer_readings', Domain\OdometerReading::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'read_at' => F::dateTime(),
                'km' => F::integer(),
                'source' => F::enum(['manual', 'fuel', 'service', 'trip', 'expense', 'document']),
                'source_id' => F::uuid()->nullable(),
                'is_suspect' => F::boolean()->withDefault(),
            ]),

            new SyncTable('fuel_stations', Domain\FuelStation::class, Ownership::UserOrSystem, [
                'brand' => F::string(60)->nullable(),
                'name' => F::string(120),
                'address' => F::string(200)->nullable(),
                'city' => F::string(80)->nullable(),
                'state' => F::string(80)->nullable(),
                'latitude' => F::decimal(9, 6)->nullable(),
                'longitude' => F::decimal(9, 6)->nullable(),
                'external_ref' => F::string(60)->nullable(),
                'notes' => F::text()->nullable(),
            ]),

            new SyncTable('service_types', Domain\ServiceType::class, Ownership::UserOrSystem, [
                'name' => F::string(120),
                'category' => F::enum([
                    'oil_filters', 'brakes', 'suspension', 'tires',
                    'engine', 'transmission', 'electrical', 'body', 'general',
                ])->withDefault(),
                'applies_to' => F::enum(self::VEHICLE_TYPES)->nullable(),
                'default_interval_km' => F::integer()->nullable(),
                'default_interval_months' => F::smallInteger()->nullable(),
                'icon' => F::string(40)->nullable(),
                'is_system' => F::boolean()->withDefault(),
            ]),

            new SyncTable('expense_categories', Domain\ExpenseCategory::class, Ownership::UserOrSystem, [
                'name' => F::string(80),
                'icon' => F::string(40)->nullable(),
                'is_system' => F::boolean()->withDefault(),
            ]),

            new SyncTable('fuel_entries', Domain\FuelEntry::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'station_id' => F::ref('fuel_stations')->nullable(),
                'filled_at' => F::dateTime(),
                'odometer_km' => F::integer(),
                'fuel_grade' => F::enum(self::FUEL_GRADES),
                'input_mode' => F::enum(['by_amount', 'by_liters', 'by_segments']),
                'amount_paid' => F::decimal(10, 2)->nullable(),
                'price_per_liter' => F::decimal(8, 3)->nullable(),
                'liters' => F::decimal(8, 3)->nullable(),
                'gauge_before' => F::decimal(5, 2)->nullable(),
                'gauge_after' => F::decimal(5, 2)->nullable(),
                'gauge_total_segments' => F::smallInteger()->nullable(),
                'is_full_tank' => F::boolean()->withDefault(),
                'is_partial' => F::boolean()->withDefault(),
                'missed_previous' => F::boolean()->withDefault(),
                'liters_before_est' => F::decimal(8, 3)->nullable(),
                'liters_after_est' => F::decimal(8, 3)->nullable(),
                'distance_km' => F::integer()->nullable(),
                'km_per_liter' => F::decimal(6, 2)->nullable(),
                'cost_per_km' => F::decimal(8, 3)->nullable(),
                'efficiency_method' => F::enum(['full_to_full', 'gauge_estimate', 'none'])->withDefault(),
                'is_efficiency_outlier' => F::boolean()->withDefault(),
                'recomputed_at' => F::dateTime()->nullable(),
                'notes' => F::text()->nullable(),
            ]),

            new SyncTable('fuel_station_prices', Domain\FuelStationPrice::class, Ownership::UserOrSystem, [
                'station_id' => F::ref('fuel_stations'),
                'fuel_grade' => F::enum(self::FUEL_GRADES),
                'price' => F::decimal(8, 3),
                'observed_at' => F::dateTime(),
                'source' => F::enum(['self_reported', 'from_fuel_entry', 'imported'])->withDefault(),
                'fuel_entry_id' => F::ref('fuel_entries')->nullable(),
            ]),

            new SyncTable('service_records', Domain\ServiceRecord::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'performed_at' => F::date(),
                'odometer_km' => F::integer(),
                'shop_name' => F::string(120)->nullable(),
                'shop_phone' => F::string(40)->nullable(),
                'is_diy' => F::boolean()->withDefault(),
                'labor_cost' => F::decimal(10, 2)->withDefault(),
                'parts_cost' => F::decimal(10, 2)->withDefault(),
                'total_cost' => F::decimal(10, 2)->withDefault(),
                'currency' => F::string(3)->withDefault(),
                'notes' => F::text()->nullable(),
            ]),

            new SyncTable('service_record_items', Domain\ServiceRecordItem::class, Ownership::Parent, [
                'service_record_id' => F::ref('service_records'),
                'service_type_id' => F::ref('service_types'),
                'description' => F::string(200)->nullable(),
                'cost' => F::decimal(10, 2)->nullable(),
            ], parentColumn: 'service_record_id'),

            new SyncTable('service_parts', Domain\ServicePart::class, Ownership::Parent, [
                'service_record_id' => F::ref('service_records'),
                'name' => F::string(140),
                'brand' => F::string(80)->nullable(),
                'part_number' => F::string(80)->nullable(),
                'quantity' => F::decimal(8, 2)->withDefault(),
                'unit' => F::string(20)->withDefault(),
                'unit_cost' => F::decimal(10, 2)->withDefault(),
                'warranty_months' => F::smallInteger()->nullable(),
                'warranty_km' => F::integer()->nullable(),
            ], parentColumn: 'service_record_id'),

            new SyncTable('maintenance_schedules', Domain\MaintenanceSchedule::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'service_type_id' => F::ref('service_types'),
                'interval_km' => F::integer()->nullable(),
                'interval_months' => F::smallInteger()->nullable(),
                'last_service_record_id' => F::ref('service_records')->nullable(),
                'last_done_at' => F::date()->nullable(),
                'last_done_km' => F::integer()->nullable(),
                'next_due_km' => F::integer()->nullable(),
                'next_due_date' => F::date()->nullable(),
                'status' => F::enum(['optimal', 'warning', 'urgent', 'unknown'])->withDefault(),
                'is_active' => F::boolean()->withDefault(),
            ]),

            new SyncTable('issues', Domain\Issue::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'title' => F::string(160),
                'description' => F::text()->nullable(),
                'severity' => F::enum(['low', 'medium', 'high', 'critical'])->withDefault(),
                'status' => F::enum(['open', 'monitoring', 'resolved', 'dismissed'])->withDefault(),
                'noticed_at' => F::date(),
                'noticed_odometer_km' => F::integer()->nullable(),
                'resolved_at' => F::date()->nullable(),
                'resolved_odometer_km' => F::integer()->nullable(),
            ]),

            new SyncTable('issue_service_links', Domain\IssueServiceLink::class, Ownership::Parent, [
                'issue_id' => F::ref('issues'),
                'service_record_id' => F::ref('service_records'),
                'resolved_it' => F::boolean()->withDefault(),
            ], parentColumn: 'issue_id'),

            new SyncTable('recurring_expenses', Domain\RecurringExpense::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'category_id' => F::ref('expense_categories'),
                'name' => F::string(120),
                'amount_estimate' => F::decimal(10, 2)->nullable(),
                'periodicity' => F::enum(['monthly', 'quarterly', 'semiannual', 'annual', 'custom_days']),
                'interval_days' => F::smallInteger()->nullable(),
                'next_due_date' => F::date(),
                'auto_create' => F::boolean()->withDefault(),
                'is_active' => F::boolean()->withDefault(),
            ]),

            new SyncTable('expenses', Domain\Expense::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'category_id' => F::ref('expense_categories'),
                'recurring_expense_id' => F::ref('recurring_expenses')->nullable(),
                'spent_at' => F::date(),
                'odometer_km' => F::integer()->nullable(),
                'amount' => F::decimal(10, 2),
                'currency' => F::string(3)->withDefault(),
                'description' => F::string(200)->nullable(),
                'notes' => F::text()->nullable(),
            ]),

            new SyncTable('documents', Domain\Document::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'type' => F::enum([
                    'insurance', 'emissions_check', 'ownership_tax',
                    'circulation_card', 'driver_license', 'warranty', 'other',
                ]),
                'title' => F::string(160)->nullable(),
                'issuer' => F::string(120)->nullable(),
                'reference' => F::string(80)->nullable(),
                'coverage' => F::string(120)->nullable(),
                'issued_at' => F::date()->nullable(),
                'expires_at' => F::date()->nullable(),
                'cost' => F::decimal(10, 2)->nullable(),
                'notes' => F::text()->nullable(),
            ]),

            new SyncTable('trips', Domain\Trip::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'started_at' => F::dateTime(),
                'ended_at' => F::dateTime()->nullable(),
                'start_odometer_km' => F::integer()->nullable(),
                'end_odometer_km' => F::integer()->nullable(),
                'distance_km' => F::integer()->nullable(),
                'origin' => F::string(160)->nullable(),
                'destination' => F::string(160)->nullable(),
                'purpose' => F::enum(['personal', 'work', 'mixed', 'other'])->withDefault(),
                'notes' => F::text()->nullable(),
            ]),

            new SyncTable('reminders', Domain\Reminder::class, Ownership::User, [
                'vehicle_id' => F::ref('vehicles'),
                'kind' => F::enum(['service', 'document', 'custom']),
                'source_id' => F::uuid()->nullable(),
                'title' => F::string(160),
                'due_date' => F::date()->nullable(),
                'due_odometer_km' => F::integer()->nullable(),
                'notify_days_before' => F::smallInteger()->withDefault(),
                'notify_km_before' => F::integer()->withDefault(),
                'status' => F::enum(['pending', 'notified', 'done', 'dismissed'])->withDefault(),
                'last_notified_at' => F::dateTime()->nullable(),
            ]),

            new SyncTable('attachments', Domain\Attachment::class, Ownership::User, [
                'owner_type' => F::enum([
                    'vehicle', 'fuel_entry', 'service_record', 'service_part',
                    'expense', 'document', 'issue', 'trip',
                ]),
                'owner_id' => F::uuid(),
                'kind' => F::enum(['photo', 'invoice', 'document_scan', 'receipt', 'other'])->withDefault(),
                'file_name' => F::string(200),
                'mime_type' => F::string(100)->nullable(),
                'size_bytes' => F::integer()->nullable(),
                'width' => F::smallInteger()->nullable(),
                'height' => F::smallInteger()->nullable(),
                'checksum' => F::string(64)->nullable(),
                'sort_order' => F::smallInteger()->withDefault(),
            ], polymorphicOwner: [
                'vehicle' => 'vehicles',
                'fuel_entry' => 'fuel_entries',
                'service_record' => 'service_records',
                'service_part' => 'service_parts',
                'expense' => 'expenses',
                'document' => 'documents',
                'issue' => 'issues',
                'trip' => 'trips',
            ]),
        ];

        return array_column(array_map(fn (SyncTable $table) => [$table->name, $table], $tables), 1, 0);
    }
}
