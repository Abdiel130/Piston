<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * La REGLA vigente por vehículo y tipo de servicio: cada X km o cada Y meses,
 * lo que ocurra primero. Es la que produce el semáforo.
 *
 * `status` se guarda cacheado porque depende del odómetro actual, que cambia
 * constantemente; recalcularlo en cada consulta impediría ordenar y filtrar
 * por él.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('maintenance_schedules', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('service_type_id')->constrained()->restrictOnDelete();

            $table->integer('interval_km')->nullable();
            $table->smallInteger('interval_months')->nullable();

            $table->foreignUuid('last_service_record_id')->nullable()
                ->constrained('service_records')->nullOnDelete();
            $table->date('last_done_at')->nullable();
            $table->integer('last_done_km')->nullable();

            $table->integer('next_due_km')->nullable();
            $table->date('next_due_date')->nullable();
            $table->enum('status', ['optimal', 'warning', 'urgent', 'unknown'])->default('unknown');
            $table->boolean('is_active')->default(true);

            $table->pistonSync();

            $table->unique(['vehicle_id', 'service_type_id']);
            $table->index(['vehicle_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('maintenance_schedules');
    }
};
