<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Cuelga piston_set_rev() en cada tabla de dominio.
 *
 * Va al final a propósito: todas las tablas deben existir ya. Si añades una
 * tabla de dominio nueva, agrégala a esta lista en una migración posterior o
 * su `rev` se quedará en 0 y el sync delta nunca la enviará.
 */
return new class extends Migration
{
    /** @var list<string> */
    private array $tables = [
        'vehicles',
        'gauge_calibration_points',
        'odometer_readings',
        'fuel_stations',
        'fuel_entries',
        'fuel_station_prices',
        'service_types',
        'service_records',
        'service_record_items',
        'service_parts',
        'maintenance_schedules',
        'issues',
        'issue_service_links',
        'reminders',
        'expense_categories',
        'recurring_expenses',
        'expenses',
        'documents',
        'trips',
        'attachments',
    ];

    public function up(): void
    {
        foreach ($this->tables as $table) {
            DB::unprepared(
                "CREATE TRIGGER {$table}_set_rev
                 BEFORE INSERT OR UPDATE ON {$table}
                 FOR EACH ROW EXECUTE FUNCTION piston_set_rev();"
            );
        }
    }

    public function down(): void
    {
        foreach ($this->tables as $table) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$table}_set_rev ON {$table};");
        }
    }
};
