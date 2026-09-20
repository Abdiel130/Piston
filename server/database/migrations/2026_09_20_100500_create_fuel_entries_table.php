<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * El corazón de la app: rendimiento sin exigir tanque lleno.
 *
 * Dos decisiones importan más que el resto:
 *
 * - `input_mode` guarda QUÉ escribió el usuario (monto, litros o rayitas). Sin
 *   eso no se puede recalcular la fila cuando la curva de calibración mejora,
 *   porque no se sabe cuál de los tres números era la fuente de verdad.
 *
 * - `efficiency_method` distingue un rendimiento exacto (tanque lleno a tanque
 *   lleno) de uno estimado por rayitas. Mezclarlos sin distinguir es lo que
 *   hace desconfiar de los números.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_entries', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('station_id')->nullable()->constrained('fuel_stations')->nullOnDelete();

            $table->timestampTz('filled_at');
            $table->integer('odometer_km');
            $table->enum('fuel_grade', ['regular', 'premium', 'diesel']);

            // --- Captura ---
            $table->enum('input_mode', ['by_amount', 'by_liters', 'by_segments']);
            $table->decimal('amount_paid', 10, 2)->nullable();
            $table->decimal('price_per_liter', 8, 3)->nullable();
            $table->decimal('liters', 8, 3)->nullable();
            $table->decimal('gauge_before', 5, 2)->nullable();
            $table->decimal('gauge_after', 5, 2)->nullable();
            // Snapshot: si mañana corriges las specs del vehículo, esta carga
            // debe seguir interpretándose con las rayitas que tenía entonces.
            $table->smallInteger('gauge_total_segments')->nullable();

            // --- Banderas que gobiernan el cálculo ---
            $table->boolean('is_full_tank')->default(false);
            $table->boolean('is_partial')->default(true);
            // Rompe la cadena en vez de producir un km/L absurdo.
            $table->boolean('missed_previous')->default(false);

            // --- Derivados, persistidos para poder pintar el historial
            //     offline sin recorrer toda la cadena de cargas ---
            $table->decimal('liters_before_est', 8, 3)->nullable();
            $table->decimal('liters_after_est', 8, 3)->nullable();
            $table->integer('distance_km')->nullable();
            $table->decimal('km_per_liter', 6, 2)->nullable();
            $table->decimal('cost_per_km', 8, 3)->nullable();
            $table->enum('efficiency_method', ['full_to_full', 'gauge_estimate', 'none'])->default('none');
            $table->boolean('is_efficiency_outlier')->default(false);
            $table->timestampTz('recomputed_at')->nullable();

            $table->text('notes')->nullable();

            $table->pistonSync();

            $table->index(['vehicle_id', 'filled_at']);
            $table->index(['vehicle_id', 'odometer_km']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_entries');
    }
};
