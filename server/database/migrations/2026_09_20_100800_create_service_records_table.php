<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Un EVENTO pasado: una visita al taller. Es el histórico del auto.
 *
 * Deliberadamente separado de maintenance_schedules, que es la REGLA vigente
 * ("cada 10,000 km"). Mezclar ambos en una fila, como hacía el demo, impide
 * representar que una sola visita cubrió varios servicios.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_records', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();

            $table->date('performed_at');
            $table->integer('odometer_km');
            $table->string('shop_name', 120)->nullable();
            $table->string('shop_phone', 40)->nullable();
            $table->boolean('is_diy')->default(false);

            $table->decimal('labor_cost', 10, 2)->default(0);
            // Espejo de SUM(service_parts.quantity * unit_cost).
            $table->decimal('parts_cost', 10, 2)->default(0);
            $table->decimal('total_cost', 10, 2)->default(0);
            $table->string('currency', 3)->default('MXN');
            $table->text('notes')->nullable();

            $table->pistonSync();

            $table->index(['vehicle_id', 'performed_at']);
            $table->index(['vehicle_id', 'odometer_km']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_records');
    }
};
